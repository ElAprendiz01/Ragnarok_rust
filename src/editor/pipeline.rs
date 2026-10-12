use std::path::Path;
use std::sync::Arc;
use anyhow::Result;
use tracing::error;

use crate::state::AppState;
use super::EditorVideo;

/// Orquestador completo de la Fase 2: recorre descargas y procesa cada video pendiente.
pub async fn ejecutar_fase_2_completa(
    dir_descargas: &Path,
    dir_procesados: &Path,
    duracion_bloque: u32,
    duracion_minima: u32,
    app_state: Arc<AppState>,
) -> Result<()> {
    app_state.emitir_log("INFO", "Iniciando orquestador Fase 2 (Edición & Partición)...").await;

    let editor = EditorVideo::new(duracion_minima, duracion_bloque);
    let mut entries = match tokio::fs::read_dir(dir_descargas).await {
        Ok(e) => e,
        Err(e) => {
            app_state.emitir_log("WARN", &format!("No se pudo leer directorio de descargas: {}", e)).await;
            return Ok(());
        }
    };

    let mut procesados_count = 0;
    let mut omitidos_count = 0;

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.is_dir() {
            let id_video = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let v_orig = path.join("video_original.mp4");
            if v_orig.exists() {
                match editor.procesar_video_individual(&id_video, dir_descargas, dir_procesados, Some(&app_state)).await {
                    Ok(num_clips) => {
                        if num_clips > 0 {
                            procesados_count += 1;
                        } else {
                            omitidos_count += 1;
                        }
                    }
                    Err(e) => {
                        error!("Error procesando video {}: {:?}", id_video, e);
                        app_state.emitir_log("ERROR", &format!("Fallo al editar '{}': {}", id_video, e)).await;
                    }
                }
            }
        }
    }

    app_state.emitir_log(
        "OK",
        &format!("Fase 2 finalizada: {} video(s) procesados, {} omitidos.", procesados_count, omitidos_count),
    ).await;

    // Actualizar estado del pipeline a idle
    {
        let mut pipeline = app_state.estado_pipeline.write().await;
        pipeline.fase_2 = "idle".to_string();
    }

    Ok(())
}
