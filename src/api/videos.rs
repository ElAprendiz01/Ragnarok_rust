use std::sync::Arc;
use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;
use crate::storage::GestorAlmacenamiento;

#[derive(Debug, Deserialize)]
pub struct EditarMetaPayload {
    pub titulo: Option<String>,
    pub descripcion: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct RecortarPayload {
    pub id_video: String,
    pub duracion_bloque: Option<u32>,
    pub factor_velocidad: Option<f32>,
    pub purgar_original: Option<bool>,
}

pub async fn listar_videos(State(state): State<Arc<AppState>>) -> Json<Value> {
    let dir_descargas = state.ruta_base.join("descargas");
    let dir_procesados = state.ruta_base.join("procesados");
    let dir_persistencia = state.ruta_base.join("datos_persistencia");

    let videos = tokio::task::spawn_blocking(move || {
        GestorAlmacenamiento::listar_videos_disco(&dir_descargas, &dir_procesados, &dir_persistencia)
    }).await.unwrap_or_default();

    Json(json!({
        "videos": videos,
        "total": videos.len()
    }))
}

pub async fn eliminar_video(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let dir_descargas = state.ruta_base.join("descargas");
    let dir_procesados = state.ruta_base.join("procesados");
    let id_clone = id.clone();

    let resultado = tokio::task::spawn_blocking(move || {
        GestorAlmacenamiento::eliminar_video(&dir_descargas, &dir_procesados, &id_clone)
    }).await;

    match resultado {
        Ok(Ok(_)) => {
            state.emitir_log("OK", &format!("Video '{}' eliminado de disco.", id)).await;
            Json(json!({"ok": true, "mensaje": format!("Video {} eliminado.", id)}))
        }
        Ok(Err(e)) => {
            state.emitir_log("ERROR", &format!("Error al eliminar video '{}': {}", id, e)).await;
            Json(json!({"ok": false, "error": e.to_string()}))
        }
        Err(e) => {
            state.emitir_log("ERROR", &format!("Error de concurrencia al eliminar video '{}': {}", id, e)).await;
            Json(json!({"ok": false, "error": e.to_string()}))
        }
    }
}

pub async fn actualizar_metadata(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<EditarMetaPayload>,
) -> Json<Value> {
    let dir_video = state.ruta_base.join("descargas").join(&id);
    let ruta_meta = dir_video.join("metadata.json");

    if !dir_video.exists() {
        return Json(json!({"ok": false, "error": "Video no encontrado."}));
    }

    let mut meta = GestorAlmacenamiento::leer_metadata(&dir_video).unwrap_or(json!({}));
    if let Some(t) = payload.titulo {
        meta["titulo"] = json!(t);
    }
    if let Some(d) = payload.descripcion {
        meta["descripcion"] = json!(d);
    }

    if let Ok(contenido) = serde_json::to_string_pretty(&meta) {
        let _ = tokio::fs::write(ruta_meta, contenido).await;
        state.emitir_log("OK", &format!("Metadatos actualizados para video '{}'.", id)).await;
        Json(json!({"ok": true, "mensaje": "Metadatos actualizados con éxito."}))
    } else {
        Json(json!({"ok": false, "error": "Fallo serializando metadatos."}))
    }
}

pub async fn recortar_video(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RecortarPayload>,
) -> Json<Value> {
    let id_video = payload.id_video;
    let dur_bloque = payload.duracion_bloque.unwrap_or(480);
    let dur_min = 60;

    let dir_descargas = state.ruta_base.join("descargas");
    let dir_procesados = state.ruta_base.join("procesados");

    let editor = crate::editor::EditorVideo::new(dur_min, dur_bloque);
    match editor.procesar_video_individual(&id_video, &dir_descargas, &dir_procesados, Some(&state)).await {
        Ok(total_clips) => {
            let dir_clips = dir_procesados.join(&id_video);
            let mut clips = Vec::new();
            if let Ok(archivos) = std::fs::read_dir(&dir_clips) {
                for a in archivos.flatten() {
                    let p = a.path();
                    if p.is_file() && p.extension().map_or(false, |ext| ext == "mp4") {
                        if let Some(nombre) = p.file_name() {
                            clips.push(format!("/media/procesados/{}/{}", id_video, nombre.to_string_lossy()));
                        }
                    }
                }
            }
            clips.sort();

            Json(json!({
                "ok": true,
                "mensaje": format!("Video recortado en {} partes.", total_clips),
                "total_clips": total_clips,
                "clips": clips
            }))
        }
        Err(e) => {
            Json(json!({"ok": false, "error": format!("Error al recortar video: {}", e)}))
        }
    }
}
