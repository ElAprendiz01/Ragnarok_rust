use std::sync::Arc;
use axum::{
    extract::{Path, State},
    response::Json,
};
use serde_json::{json, Value};

use crate::crawler::GestorExtraccion;
use crate::editor::EditorVideo;
use crate::state::AppState;
use crate::storage::GestorAlmacenamiento;

pub async fn obtener_estado(State(state): State<Arc<AppState>>) -> Json<Value> {
    let pipeline = state.estado_pipeline.read().await;

    let dir_persist = state.ruta_base.join("datos_persistencia");
    let cant_fuentes = GestorAlmacenamiento::contar_lineas(&dir_persist.join("fuentes_url.txt"));
    let cant_completados = GestorAlmacenamiento::contar_lineas(&dir_persist.join("enlaces_completados.txt"));
    let cant_pendientes = GestorAlmacenamiento::contar_lineas(&dir_persist.join("cola_pendientes.txt"));
    let cant_historial = GestorAlmacenamiento::contar_lineas(&dir_persist.join("historial_global_enlaces.txt"));

    Json(json!({
        "fases": {
            "1": pipeline.fase_1,
            "2": pipeline.fase_2,
            "3": pipeline.fase_3,
            "4": pipeline.fase_4
        },
        "estadisticas": {
            "fuentes": cant_fuentes,
            "completados": cant_completados,
            "pendientes": cant_pendientes,
            "historial": cant_historial
        },
        "timestamp": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    }))
}

pub async fn ejecutar_fase(
    Path(fase): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let mut pipeline = state.estado_pipeline.write().await;
    match fase.as_str() {
        "1" => {
            if pipeline.fase_1 == "running" {
                return Json(json!({"ok": false, "error": "La Fase 1 ya se encuentra en ejecución."}));
            }
            pipeline.fase_1 = "running".to_string();
            state.emitir_log("INFO", "Disparando Fase 1 (Extracción & Descarga) en segundo plano...").await;

            let state_clone = Arc::clone(&state);
            let base = state.ruta_base.clone();
            tokio::spawn(async move {
                if let Err(e) = GestorExtraccion::ejecutar_fase_1_completa(&base, state_clone).await {
                    tracing::error!("Error en Fase 1: {:?}", e);
                }
            });
        }
        "2" => {
            if pipeline.fase_2 == "running" {
                return Json(json!({"ok": false, "error": "La Fase 2 ya se encuentra en ejecución."}));
            }
            pipeline.fase_2 = "running".to_string();
            state.emitir_log("INFO", "Disparando Fase 2 (Edición & Partición) en segundo plano...").await;

            let (dur_bloque, dur_min) = {
                let cfg = state.config.read().await;
                (
                    cfg.edicion.duracion_bloque_segundos.unwrap_or(480),
                    cfg.edicion.duracion_minima_remanente_segundos.unwrap_or(60),
                )
            };

            let state_clone = Arc::clone(&state);
            let dir_descargas = state.ruta_base.join("descargas");
            let dir_procesados = state.ruta_base.join("procesados");

            tokio::spawn(async move {
                if let Err(e) = EditorVideo::ejecutar_fase_2_completa(
                    &dir_descargas,
                    &dir_procesados,
                    dur_bloque,
                    dur_min,
                    state_clone,
                ).await {
                    tracing::error!("Error en Fase 2: {:?}", e);
                }
            });
        }
        "3" => {
            pipeline.fase_3 = "running".to_string();
            state.emitir_log("INFO", "Fase 3 (Publicación Multiplex) iniciada.").await;
        }
        "4" => {
            pipeline.fase_4 = "running".to_string();
            state.emitir_log("INFO", "Fase 4 (Lote Telegram MTProto) iniciada.").await;
        }
        "descargar" => {
            if pipeline.fase_1 == "running" {
                return Json(json!({"ok": false, "error": "La descarga o Fase 1 ya se encuentra en ejecución."}));
            }
            pipeline.fase_1 = "running".to_string();
            state.emitir_log("INFO", "Iniciando descarga de cola de pendientes con yt-dlp nativo...").await;

            let state_clone = Arc::clone(&state);
            let base = state.ruta_base.clone();
            tokio::spawn(async move {
                let dir_descargas = base.join("descargas");
                if let Err(e) = crate::downloader::GestorDescargas::procesar_cola_pendientes(&dir_descargas, state_clone.clone()).await {
                    tracing::error!("Error descargando pendientes: {:?}", e);
                }
                let mut p = state_clone.estado_pipeline.write().await;
                p.fase_1 = "idle".to_string();
            });
        }
        _ => return Json(json!({"ok": false, "error": "Fase no válida"})),
    }

    Json(json!({"ok": true, "mensaje": format!("Fase {} iniciada con éxito.", fase)}))
}

pub async fn ejecutar_descarga_solo(State(state): State<Arc<AppState>>) -> Json<Value> {
    ejecutar_fase(axum::extract::Path("descargar".to_string()), State(state)).await
}

pub async fn detener_fase(
    Path(fase): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let mut pipeline = state.estado_pipeline.write().await;
    match fase.as_str() {
        "1" => pipeline.fase_1 = "idle".to_string(),
        "2" => pipeline.fase_2 = "idle".to_string(),
        "3" => {
            pipeline.fase_3 = "idle".to_string();
            state.cancelar_publicacion.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        "4" => {
            pipeline.fase_4 = "idle".to_string();
            state.cancelar_publicacion.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        _ => return Json(json!({"ok": false, "error": "Fase no válida"})),
    }

    state.emitir_log("WARN", &format!("Fase {} detenida desde el panel.", fase)).await;
    Json(json!({"ok": true, "mensaje": format!("Fase {} detenida.", fase)}))
}
