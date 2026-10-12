use std::sync::Arc;
use axum::{extract::State, response::Json};
use grammers_client::{Client, Config};
use grammers_client::client::auth::SignInError;
use grammers_session::Session;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::{AppState, TelegramAuthStage};

#[derive(Deserialize)]
pub struct SolicitarCodigoPayload {
    pub telefono: String,
    pub api_id: Option<i64>,
    pub api_hash: Option<String>,
}

#[derive(Deserialize)]
pub struct ConfirmarCodigoPayload {
    pub codigo: String,
}

#[derive(Deserialize)]
pub struct ConfirmarPasswordPayload {
    pub password: String,
}

/// Consulta si existe una sesión válida de Telegram guardada en disco.
pub async fn estado_sesion(State(state): State<Arc<AppState>>) -> Json<Value> {
    let ruta_sesion = state.ruta_base.join("datos_persistencia").join("telegram.session");
    let existe = ruta_sesion.exists();
    let mut activo = false;

    if existe {
        if let Ok(session) = Session::load_file_or_create(&ruta_sesion) {
            let (api_id, api_hash) = {
                let cfg = state.config.read().await;
                (cfg.publicacion.telegram_api_id, cfg.publicacion.telegram_api_hash.clone())
            };
            if let (Some(id), Some(hash)) = (api_id, api_hash) {
                if let Ok(client) = Client::connect(Config {
                    session,
                    api_id: id as i32,
                    api_hash: hash,
                    params: Default::default(),
                }).await {
                    activo = client.is_authorized().await.unwrap_or(false);
                }
            }
        }
    }

    Json(json!({
        "ok": true,
        "sesion_guardada": existe,
        "vinculado": activo,
        "mensaje": if activo { "Sesión autorizada y activa" } else if existe { "Archivo de sesión presente pero no autorizado" } else { "Sin sesión vinculada" }
    }))
}

/// Solicita a Telegram el código oficial de inicio de sesión vía SMS o App.
pub async fn solicitar_codigo(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SolicitarCodigoPayload>,
) -> Json<Value> {
    let telefono = payload.telefono.trim().to_string();
    if telefono.is_empty() {
        return Json(json!({"ok": false, "error": "El número de teléfono es obligatorio."}));
    }

    // 1. Obtener o actualizar credenciales api_id / api_hash
    let (api_id, api_hash) = {
        let mut cfg = state.config.write().await;
        if let Some(id) = payload.api_id {
            cfg.publicacion.telegram_api_id = Some(id);
        }
        if let Some(ref hash) = payload.api_hash {
            if !hash.trim().is_empty() {
                cfg.publicacion.telegram_api_hash = Some(hash.trim().to_string());
            }
        }
        cfg.publicacion.telegram_telefono = Some(telefono.clone());

        // Guardar configuración actualizada en disco
        let mgr = crate::config::ConfigManager::new(&state.ruta_base);
        let _ = mgr.guardar_raw(&serde_json::to_value(&*cfg).unwrap_or_default());

        (cfg.publicacion.telegram_api_id, cfg.publicacion.telegram_api_hash.clone())
    };

    let (Some(api_id), Some(api_hash)) = (api_id, api_hash) else {
        return Json(json!({
            "ok": false,
            "error": "api_id y api_hash de Telegram son requeridos para conectar."
        }));
    };

    let ruta_sesion = state.ruta_base.join("datos_persistencia").join("telegram.session");
    if let Some(parent) = ruta_sesion.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    let session = match Session::load_file_or_create(&ruta_sesion) {
        Ok(s) => s,
        Err(e) => return Json(json!({"ok": false, "error": format!("Error creando sesión: {}", e)})),
    };

    let client = match Client::connect(Config {
        session,
        api_id: api_id as i32,
        api_hash,
        params: Default::default(),
    }).await {
        Ok(c) => c,
        Err(e) => return Json(json!({"ok": false, "error": format!("Error conectando con Telegram: {}", e)})),
    };

    // Si ya está autorizada
    if client.is_authorized().await.unwrap_or(false) {
        state.emitir_log("OK", "La sesión de Telegram ya se encuentra activa y autorizada.").await;
        return Json(json!({
            "ok": true,
            "ya_autorizado": true,
            "mensaje": "¡Tu sesión ya está autorizada! No necesitas código."
        }));
    }

    state.emitir_log("INFO", &format!("Solicitando código de Telegram para {}...", telefono)).await;

    let token = match client.request_login_code(&telefono).await {
        Ok(t) => t,
        Err(e) => {
            let err_msg = format!("Telegram rechazó la solicitud de código: {}", e);
            state.emitir_log("ERROR", &err_msg).await;
            return Json(json!({"ok": false, "error": err_msg}));
        }
    };

    {
        let mut auth = state.auth_telegram.lock().await;
        *auth = Some(TelegramAuthStage::AwaitingCode { client, token, telefono: telefono.clone() });
    }

    state.emitir_log("OK", &format!("Código de verificación enviado por Telegram a {}. Ingrésalo en la interfaz.", telefono)).await;

    Json(json!({
        "ok": true,
        "mensaje": format!("Código oficial enviado a tu aplicación de Telegram ({})", telefono)
    }))
}

/// Confirma el código de 5 dígitos ingresado por el usuario.
pub async fn confirmar_codigo(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ConfirmarCodigoPayload>,
) -> Json<Value> {
    let codigo = payload.codigo.trim().to_string();
    if codigo.is_empty() {
        return Json(json!({"ok": false, "error": "Debes ingresar el código recibido en Telegram."}));
    }

    let mut auth_guard = state.auth_telegram.lock().await;
    let auth_stage = auth_guard.take();

    let (client, token, telefono) = match auth_stage {
        Some(TelegramAuthStage::AwaitingCode { client, token, telefono }) => (client, token, telefono),
        Some(TelegramAuthStage::AwaitingPassword { client, token, telefono }) => {
            *auth_guard = Some(TelegramAuthStage::AwaitingPassword { client, token, telefono });
            return Json(json!({
                "ok": false,
                "requiere_2fa": true,
                "error": "Esta cuenta requiere ingresar su contraseña de 2 pasos (2FA)."
            }));
        }
        None => {
            return Json(json!({
                "ok": false,
                "error": "No hay ninguna solicitud de código activa. Haz clic en 'Solicitar Código' primero."
            }));
        }
    };

    state.emitir_log("INFO", "Validando código recibido con los servidores de Telegram...").await;

    match client.sign_in(&token, &codigo).await {
        Ok(_) => {
            let ruta_sesion = state.ruta_base.join("datos_persistencia").join("telegram.session");
            if let Err(e) = client.session().save_to_file(&ruta_sesion) {
                let err_msg = format!("Código correcto pero falló al guardar sesión en disco: {}", e);
                state.emitir_log("ERROR", &err_msg).await;
                return Json(json!({"ok": false, "error": err_msg}));
            }

            state.emitir_log("OK", "¡Sesión de Telegram MTProto vinculada con éxito y guardada permanentemente!").await;
            Json(json!({
                "ok": true,
                "vinculado": true,
                "mensaje": "¡Sesión MTProto vinculada exitosamente! Ya puedes subir videos directamente."
            }))
        }
        Err(SignInError::PasswordRequired(pt)) => {
            *auth_guard = Some(TelegramAuthStage::AwaitingPassword { client, token: pt, telefono });
            state.emitir_log("WARN", "La cuenta de Telegram tiene autenticación en 2 pasos (2FA). Ingresa tu contraseña.").await;
            Json(json!({
                "ok": false,
                "requiere_2fa": true,
                "mensaje": "Tu cuenta tiene protección 2FA activa. Por favor escribe tu contraseña de Telegram."
            }))
        }
        Err(e) => {
            let err_msg = format!("Código incorrecto o expirado: {}", e);
            state.emitir_log("ERROR", &err_msg).await;
            // Restaurar para que el usuario pueda corregir el código sin re-pedir si aún es válido
            *auth_guard = Some(TelegramAuthStage::AwaitingCode { client, token, telefono });
            Json(json!({"ok": false, "error": err_msg}))
        }
    }
}

/// Confirma la contraseña 2FA si la cuenta la tiene habilitada.
pub async fn confirmar_password(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ConfirmarPasswordPayload>,
) -> Json<Value> {
    let password = payload.password;
    if password.trim().is_empty() {
        return Json(json!({"ok": false, "error": "Debes ingresar tu contraseña 2FA."}));
    }

    let mut auth_guard = state.auth_telegram.lock().await;
    let auth_stage = auth_guard.take();

    let (client, token, _telefono) = match auth_stage {
        Some(TelegramAuthStage::AwaitingPassword { client, token, telefono }) => (client, token, telefono),
        _ => {
            return Json(json!({
                "ok": false,
                "error": "No hay ningún desafío de contraseña 2FA pendiente. Puedes solicitar un nuevo código."
            }));
        }
    };

    state.emitir_log("INFO", "Verificando contraseña 2FA con Telegram...").await;

    let token_reintento = token.clone();
    let client_reintento = client.clone();
    let telefono_reintento = _telefono.clone();

    match client.check_password(token, &password).await {
        Ok(_) => {
            let ruta_sesion = state.ruta_base.join("datos_persistencia").join("telegram.session");
            if let Err(e) = client.session().save_to_file(&ruta_sesion) {
                let err_msg = format!("Contraseña correcta pero falló al guardar sesión en disco: {}", e);
                state.emitir_log("ERROR", &err_msg).await;
                return Json(json!({"ok": false, "error": err_msg}));
            }

            state.emitir_log("OK", "¡Sesión 2FA de Telegram autorizada y guardada exitosamente!").await;
            Json(json!({
                "ok": true,
                "vinculado": true,
                "mensaje": "¡Sesión 2FA vinculada exitosamente!"
            }))
        }
        Err(e) => {
            // Restaurar para que el usuario pueda volver a intentar escribir la contraseña correcta sin reiniciar todo el proceso
            *auth_guard = Some(TelegramAuthStage::AwaitingPassword {
                client: client_reintento,
                token: token_reintento,
                telefono: telefono_reintento,
            });
            let err_msg = format!("Contraseña 2FA incorrecta: {}. Por favor verifica tu contraseña e intenta de nuevo.", e);
            state.emitir_log("ERROR", &err_msg).await;
            Json(json!({"ok": false, "error": err_msg}))
        }
    }
}

/// Desvincula y elimina la sesión activa de Telegram del disco.
pub async fn desvincular_sesion(State(state): State<Arc<AppState>>) -> Json<Value> {
    let ruta_sesion = state.ruta_base.join("datos_persistencia").join("telegram.session");
    if ruta_sesion.exists() {
        let _ = tokio::fs::remove_file(&ruta_sesion).await;
    }
    {
        let mut auth = state.auth_telegram.lock().await;
        *auth = None;
    }
    state.emitir_log("INFO", "Sesión de Telegram eliminada del sistema.").await;
    Json(json!({
        "ok": true,
        "mensaje": "Sesión de Telegram desvinculada exitosamente."
    }))
}
