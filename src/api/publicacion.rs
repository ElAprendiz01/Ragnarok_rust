use std::sync::Arc;
use axum::{
    extract::State,
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;
use crate::publisher::GestorAuditoriaPublicaciones;
use crate::api::publicacion_lote::ejecutar_tarea_lote_telegram;
use crate::api::publicacion_individual::ejecutar_tarea_individual_telegram;

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct PublicarLotePayload {
    pub canal: Option<String>,
    pub modo_browser: Option<String>,
    pub modo_video: Option<String>,
    pub forzar: Option<bool>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct PublicarIndividualPayload {
    pub id_video: String,
    pub plataforma: Option<String>,
    pub canal: Option<String>,
    pub modo: Option<String>,
}

pub async fn estado_lote_telegram(State(state): State<Arc<AppState>>) -> Json<Value> {
    let ruta_cola = state.ruta_base.join("datos_persistencia").join("cola_publicacion_telegram.json");
    let en_ejecucion = {
        let pipeline = state.estado_pipeline.read().await;
        pipeline.fase_4 == "running"
    };

    if ruta_cola.exists() {
        if let Ok(contenido) = tokio::fs::read_to_string(&ruta_cola).await {
            if let Ok(mut data) = serde_json::from_str::<Value>(&contenido) {
                if let Some(obj) = data.as_object_mut() {
                    obj.insert("activo".to_string(), json!(en_ejecucion));
                    obj.insert("ok".to_string(), json!(true));
                }
                return Json(data);
            }
        }
    }

    let auditor = GestorAuditoriaPublicaciones::new(&state.ruta_base.join("datos_persistencia"));
    let ya_publicados = auditor.obtener_ids_publicados("telegram");
    let dir_descargas = state.ruta_base.join("descargas");
    let mut total_en_disco = 0;
    if let Ok(entries) = std::fs::read_dir(dir_descargas) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                total_en_disco += 1;
            }
        }
    }
    let completados = ya_publicados.len();

    Json(json!({
        "ok": true,
        "activo": en_ejecucion,
        "total": total_en_disco,
        "completados": completados,
        "fallidos": 0,
        "elementos": []
    }))
}

pub async fn ejecutar_lote_telegram(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<PublicarLotePayload>,
) -> Json<Value> {
    let ya_activo = {
        let pipeline = state.estado_pipeline.read().await;
        pipeline.fase_4 == "running"
    };
    if ya_activo {
        return Json(json!({
            "ok": false,
            "error": "Ya hay un lote de Telegram ejecutándose activamente. Espera a que termine o detenlo para no saturar la conexión."
        }));
    }

    let (api_id, api_hash, telefono, canal_config) = {
        let cfg = state.config.read().await;
        (
            cfg.publicacion.telegram_api_id,
            cfg.publicacion.telegram_api_hash.clone(),
            cfg.publicacion.telegram_telefono.clone(),
            cfg.publicacion.canal_telegram.clone().unwrap_or_default(),
        )
    };

    let canal = payload.canal.filter(|c| !c.trim().is_empty()).unwrap_or(canal_config);
    if canal.trim().is_empty() {
        return Json(json!({"ok": false, "error": "No hay ningún canal de Telegram configurado."}));
    }
    let forzar = payload.forzar.unwrap_or(false);
    let modo_video = payload.modo_video.unwrap_or_else(|| "completo".to_string());

    state.emitir_log(
        "INFO",
        &format!(
            "Iniciando lote de Telegram MTProto hacia {} (Modo: {}, Forzar: {}) [0% Chromium, <15 MB RAM]...",
            canal,
            modo_video,
            if forzar { "SÍ" } else { "NO" }
        ),
    ).await;

    {
        let mut pipeline = state.estado_pipeline.write().await;
        pipeline.fase_4 = "running".to_string();
    }

    let state_clon = state.clone();
    tokio::spawn(async move {
        ejecutar_tarea_lote_telegram(
            state_clon,
            canal,
            modo_video,
            forzar,
            api_id,
            api_hash,
            telefono,
        ).await;
    });

    Json(json!({"ok": true, "mensaje": "Lote de Telegram iniciado en segundo plano."}))
}

pub async fn detener_lote_telegram(
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    state.cancelar_publicacion.store(true, std::sync::atomic::Ordering::SeqCst);
    {
        let mut pipeline = state.estado_pipeline.write().await;
        pipeline.fase_4 = "idle".to_string();
        pipeline.fase_3 = "idle".to_string();
    }
    state.emitir_log("WARN", "[TELEGRAM] Señal de detención de lote enviada por el usuario.").await;
    Json(json!({"ok": true, "mensaje": "Señal de detención de lote enviada con éxito."}))
}

pub async fn publicar_individual(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<PublicarIndividualPayload>,
) -> Json<Value> {
    let ya_activo = {
        let pipeline = state.estado_pipeline.read().await;
        pipeline.fase_4 == "running" || pipeline.fase_3 == "running"
    };
    if ya_activo {
        return Json(json!({
            "ok": false,
            "error": "Ya hay una publicación de Telegram en curso en este momento. Espera a que finalice para evitar colisiones."
        }));
    }

    let plataforma = payload.plataforma.unwrap_or_else(|| "telegram".to_string()).to_lowercase();
    let id_video = payload.id_video;
    let modo = payload.modo.unwrap_or_else(|| "completo".to_string());

    if plataforma != "telegram" {
        return Json(json!({
            "ok": false,
            "error": format!("La plataforma '{}' aún no está soportada para subida directa nativa.", plataforma)
        }));
    }

    let (api_id, api_hash, telefono, canal_config) = {
        let cfg = state.config.read().await;
        (
            cfg.publicacion.telegram_api_id,
            cfg.publicacion.telegram_api_hash.clone(),
            cfg.publicacion.telegram_telefono.clone(),
            cfg.publicacion.canal_telegram.clone().unwrap_or_default(),
        )
    };

    let canal = payload.canal.filter(|c| !c.trim().is_empty()).unwrap_or(canal_config);
    if canal.trim().is_empty() {
        return Json(json!({"ok": false, "error": "No hay ningún canal de Telegram configurado."}));
    }

    let dir_descargas = state.ruta_base.join("descargas").join(&id_video);
    let dir_procesados = state.ruta_base.join("procesados").join(&id_video);

    if !dir_descargas.exists() && !dir_procesados.exists() {
        return Json(json!({"ok": false, "error": format!("No se encontraron archivos en disco para el video '{}'", id_video)}));
    }

    let state_clon = state.clone();
    let id_clon = id_video.clone();
    tokio::spawn(async move {
        ejecutar_tarea_individual_telegram(
            state_clon,
            id_clon,
            canal,
            modo,
            api_id,
            api_hash,
            telefono,
        ).await;
    });

    Json(json!({"ok": true, "mensaje": format!("Publicación individual de '{}' en Telegram iniciada exitosamente.", id_video)}))
}
