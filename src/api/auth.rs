use std::sync::Arc;
use axum::{
    extract::State,
    response::Json,
};
use serde_json::{json, Value};

use crate::state::AppState;

/// Devuelve el estado de cookies y autenticación de todas las plataformas,
/// con compatibilidad directa para la UI de Ragnarok (`data.ok && data.cookies`).
pub async fn estado_cookies(State(state): State<Arc<AppState>>) -> Json<Value> {
    let dir_config = state.ruta_base.join("config");
    let dir_persist = state.ruta_base.join("datos_persistencia");
    let tg_session = dir_persist.join("telegram.session");
    let dir_fb_perfil = dir_persist.join("perfil_facebook_chromium");
    let fb_cookies_path = dir_config.join("cookies_facebook.json");

    let tg_ok = tg_session.exists() || state.telegram_autorizado.load(std::sync::atomic::Ordering::Relaxed);

    let (fb_ok, fb_user) = if fb_cookies_path.exists() {
        if let Ok(contenido) = tokio::fs::read_to_string(&fb_cookies_path).await {
            if let Ok(cookies) = serde_json::from_str::<Vec<serde_json::Value>>(&contenido) {
                let user_cookie = cookies.iter().find(|c| c.get("name").and_then(|n| n.as_str()) == Some("c_user"));
                if let Some(c) = user_cookie {
                    let uid = c.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    (true, uid)
                } else {
                    (cookies.len() > 0, String::new())
                }
            } else {
                (false, String::new())
            }
        } else {
            (false, String::new())
        }
    } else if dir_fb_perfil.exists() {
        (true, String::new())
    } else {
        (false, String::new())
    };

    let yt_ok = dir_config.join("cookies_youtube.json").exists();
    let tt_ok = dir_config.join("cookies_tiktok.json").exists();
    let ig_ok = dir_config.join("cookies_instagram.json").exists();

    let fb_msg = if fb_ok && !fb_user.is_empty() {
        format!("Sesión Activa (ID: {})", fb_user)
    } else if fb_ok {
        "Sesión Guardada".to_string()
    } else {
        "Sin sesión iniciada".to_string()
    };

    Json(json!({
        "ok": true,
        "cookies": {
            "telegram": {
                "conectado": tg_ok,
                "estado": if tg_ok { "ACTIVO" } else { "PENDIENTE" },
                "mensaje": if tg_ok { "Sesión MTProto Nativa Activa" } else { "Sin sesión vinculada" }
            },
            "facebook": {
                "conectado": fb_ok,
                "estado": if fb_ok { "ACTIVO" } else { "PENDIENTE" },
                "mensaje": fb_msg,
                "usuario_id": fb_user
            },
            "youtube": {
                "conectado": yt_ok,
                "estado": if yt_ok { "ACTIVO" } else { "PENDIENTE" },
                "mensaje": if yt_ok { "Cookies cargadas" } else { "Sin cookies" }
            },
            "tiktok": {
                "conectado": tt_ok,
                "estado": if tt_ok { "ACTIVO" } else { "PENDIENTE" },
                "mensaje": if tt_ok { "Cookies cargadas" } else { "Sin cookies" }
            },
            "instagram": {
                "conectado": ig_ok,
                "estado": if ig_ok { "ACTIVO" } else { "PENDIENTE" },
                "mensaje": if ig_ok { "Cookies cargadas" } else { "Sin cookies" }
            }
        }
    }))
}

/// Consulta si la ventana de inicio de sesión de Facebook está actualmente abierta
pub async fn estado_navegador_facebook(State(state): State<Arc<AppState>>) -> Json<Value> {
    let guard = state.auth_facebook_driver.lock().await;
    Json(json!({
        "ok": true,
        "abierto": guard.is_some()
    }))
}

/// Abre una ventana de Chrome con perfil persistente y anti-detección en modo visible
/// para que el usuario pueda escribir sus credenciales humanamente sin ningún bot ni sondeo invasivo.
pub async fn iniciar_sesion_facebook(State(state): State<Arc<AppState>>) -> Json<Value> {
    state.emitir_log("INFO", "[FACEBOOK] Abriendo navegador seguro con perfil persistente para inicio de sesión humano...").await;

    // 1. Si había un navegador previo abierto en memoria, cerrarlo suavemente
    {
        let mut guard = state.auth_facebook_driver.lock().await;
        if let Some(driver) = guard.take() {
            driver.cerrar_suave().await;
        }
    }

    // 2. Lanzar navegador Chromium en modo visible en puerto 9335
    let puerto = 9335;
    match crate::crawler::chrome_driver::ChromeDriver::lanzar_y_conectar(
        &state.ruta_base,
        "https://www.facebook.com",
        false, // Visible para que el usuario interactúe humanamente
        puerto,
    ).await {
        Ok(driver) => {
            let mut guard = state.auth_facebook_driver.lock().await;
            *guard = Some(driver);
            state.emitir_log("OK", "[FACEBOOK] Ventana de Facebook abierta en pantalla. Inicia sesión normalmente con tus datos y luego pulsa 'Ya entré a mi cuenta'.").await;
            Json(json!({
                "ok": true,
                "mensaje": "Navegador abierto en pantalla. Inicia sesión en Facebook normalmente y luego pulsa 'Ya entré a mi cuenta'."
            }))
        }
        Err(e) => {
            let err_msg = format!("No se pudo abrir el navegador seguro: {}", e);
            state.emitir_log("ERROR", &format!("[FACEBOOK] {}", err_msg)).await;
            Json(json!({
                "ok": false,
                "error": err_msg
            }))
        }
    }
}

/// Captura de forma segura y en un solo disparo (sin sondeo continuo) las cookies de sesión activa.
pub async fn capturar_sesion_facebook(State(state): State<Arc<AppState>>) -> Json<Value> {
    let mut guard = state.auth_facebook_driver.lock().await;
    let driver = match guard.as_mut() {
        Some(d) => d,
        None => {
            return Json(json!({
                "ok": false,
                "error": "No hay ninguna ventana de navegador abierta. Haz clic en 'Abrir Navegador' primero."
            }));
        }
    };

    state.emitir_log("INFO", "[FACEBOOK] Verificando sesión en el navegador...").await;

    let dir_config = state.ruta_base.join("config");
    let ruta_json = dir_config.join("cookies_facebook.json");
    let ruta_netscape = dir_config.join("cookies_facebook_netscape.txt");

    match driver.guardar_cookies(&ruta_json, &ruta_netscape).await {
        Ok(Some(uid)) => {
            let msg = format!("¡Sesión de Facebook vinculada exitosamente! Usuario ID: {}", uid);
            state.emitir_log("OK", &format!("[FACEBOOK] {}", msg)).await;

            // Cerrar el navegador de forma suave y limpia (guarda caches y SQLite)
            if let Some(driver_a_cerrar) = guard.take() {
                driver_a_cerrar.cerrar_suave().await;
            }

            Json(json!({
                "ok": true,
                "logueado": true,
                "usuario_id": uid,
                "mensaje": msg
            }))
        }
        Ok(None) => {
            let aviso = "Aún no has completado el inicio de sesión en Facebook. Ingresa con tu cuenta en la ventana abierta y luego vuelve a presionar este botón.";
            state.emitir_log("WARN", &format!("[FACEBOOK] {}", aviso)).await;
            Json(json!({
                "ok": false,
                "logueado": false,
                "mensaje": aviso
            }))
        }
        Err(e) => {
            let err_msg = format!("Error al capturar sesión del navegador: {}", e);
            state.emitir_log("ERROR", &format!("[FACEBOOK] {}", err_msg)).await;
            Json(json!({
                "ok": false,
                "error": err_msg
            }))
        }
    }
}

/// Cierra manualmente la ventana de autenticación de Facebook si el usuario decide cancelar
pub async fn cerrar_navegador_facebook(State(state): State<Arc<AppState>>) -> Json<Value> {
    let mut guard = state.auth_facebook_driver.lock().await;
    if let Some(driver) = guard.take() {
        driver.cerrar_suave().await;
        state.emitir_log("INFO", "[FACEBOOK] Ventana de inicio de sesión cerrada por el usuario.").await;
    }
    Json(json!({
        "ok": true,
        "mensaje": "Navegador cerrado correctamente."
    }))
}

/// Guarda cookies recibidas directamente desde la interfaz web (pegar JSON)
pub async fn guardar_cookies_facebook(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let cookies_arr = if let Some(arr) = payload.as_array() {
        arr.clone()
    } else if let Some(arr) = payload.get("cookies").and_then(|c| c.as_array()) {
        arr.clone()
    } else {
        return Json(json!({"ok": false, "error": "El formato debe ser un arreglo de cookies en JSON."}));
    };

    let dir_config = state.ruta_base.join("config");
    let ruta_json = dir_config.join("cookies_facebook.json");
    let ruta_netscape = dir_config.join("cookies_facebook_netscape.txt");

    if let Err(e) = tokio::fs::create_dir_all(&dir_config).await {
        return Json(json!({"ok": false, "error": format!("Error creando directorio config: {}", e)}));
    }

    // 1. Guardar JSON
    if let Err(e) = tokio::fs::write(&ruta_json, serde_json::to_string_pretty(&cookies_arr).unwrap_or_default()).await {
        return Json(json!({"ok": false, "error": format!("Error escribiendo cookies_facebook.json: {}", e)}));
    }

    // 2. Convertir a Netscape
    let mut salida = String::from("# Netscape HTTP Cookie File\n# Guardado desde la Interfaz Web de Ragnarok\n\n");
    let mut c_user_encontrado: Option<String> = None;

    for c in &cookies_arr {
        let domain = c.get("domain").and_then(|v| v.as_str()).unwrap_or(".facebook.com");
        let flag = if domain.starts_with('.') { "TRUE" } else { "FALSE" };
        let path = c.get("path").and_then(|v| v.as_str()).unwrap_or("/");
        let secure = if c.get("secure").and_then(|v| v.as_bool()).unwrap_or(false) { "TRUE" } else { "FALSE" };
        let expires = c.get("expirationDate")
            .or_else(|| c.get("expires"))
            .and_then(|v| v.as_f64()).map(|v| v as u64).unwrap_or(2147483647);
        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let value = c.get("value").and_then(|v| v.as_str()).unwrap_or("");

        if name == "c_user" && !value.is_empty() {
            c_user_encontrado = Some(value.to_string());
        }

        if !name.is_empty() {
            salida.push_str(&format!("{}\t{}\t{}\t{}\t{}\t{}\t{}\n", domain, flag, path, secure, expires, name, value));
        }
    }

    let _ = tokio::fs::write(&ruta_netscape, salida).await;

    let msg = match &c_user_encontrado {
        Some(uid) => format!("[FACEBOOK] Cookies guardadas y sincronizadas. Usuario ID: {}", uid),
        None => "[FACEBOOK] Cookies guardadas y sincronizadas.".to_string(),
    };
    state.emitir_log("OK", &msg).await;

    Json(json!({
        "ok": true,
        "mensaje": "Cookies de Facebook guardadas correctamente.",
        "usuario_id": c_user_encontrado
    }))
}
