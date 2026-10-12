use std::sync::Arc;

use crate::state::AppState;
use crate::storage::GestorAlmacenamiento;
use crate::publisher::{TelegramPublisher, GestorAuditoriaPublicaciones};

pub async fn ejecutar_tarea_individual_telegram(
    state: Arc<AppState>,
    id_video: String,
    canal: String,
    modo: String,
    api_id: Option<i64>,
    api_hash: Option<String>,
    telefono: Option<String>,
) {
    let dir_descargas = state.ruta_base.join("descargas").join(&id_video);
    let dir_procesados = state.ruta_base.join("procesados").join(&id_video);

    let _guard = state.lock_publicacion_telegram.lock().await;

    {
        let mut pipeline = state.estado_pipeline.write().await;
        pipeline.fase_3 = "running".to_string();
    }

    let publisher = TelegramPublisher::with_credentials(
        &canal,
        &state.ruta_base,
        api_id,
        api_hash,
        telefono,
    );
    let auditor = GestorAuditoriaPublicaciones::new(&state.ruta_base.join("datos_persistencia"));

    let meta_inicial = GestorAlmacenamiento::leer_metadata(&dir_descargas).unwrap_or_default();
    let titulo_base = meta_inicial.get("titulo")
        .or_else(|| meta_inicial.get("titulo_original"))
        .and_then(|v| v.as_str())
        .unwrap_or(&id_video);

    let tit_clean = if titulo_base.chars().count() > 32 {
        let mut s: String = titulo_base.chars().take(29).collect();
        s.push_str("...");
        s
    } else {
        titulo_base.to_string()
    };

    state.emitir_log(
        "INFO",
        &format!("[TELEGRAM] Video individual '{}' - Preparando publicación hacia {} (Modo: {})...", tit_clean, canal, modo),
    ).await;

    let mut exito = false;

    if modo == "clips" {
        let mut clips = Vec::new();
        if let Ok(mut archivos) = tokio::fs::read_dir(&dir_procesados).await {
            while let Ok(Some(a)) = archivos.next_entry().await {
                let p = a.path();
                if p.is_file() && p.extension().map_or(false, |ext| ext == "mp4") {
                    clips.push(p);
                }
            }
        }
        clips.sort();

        if !clips.is_empty() {
            let total_clips = clips.len();
            let mut todos = true;
            for (idx, clip_path) in clips.iter().enumerate() {
                let p_num = idx + 1;
                let t_clip = format!("{} (Parte {})", titulo_base, p_num);
                let d_clip = format!("Parte {}/{} • Película segmentada", p_num, total_clips);
                let st_log = state.clone();
                let tit_clon = tit_clean.clone();
                let res = publisher.subir_video_mtproto(
                    clip_path,
                    &t_clip,
                    &d_clip,
                    Some(&canal),
                    move |pct| {
                        let st = st_log.clone();
                        let t = tit_clon.clone();
                        tokio::spawn(async move {
                            st.emitir_log("INFO", &format!("[TELEGRAM] Video '{}' (Clip {}/{}) - {:.0}%", t, p_num, total_clips, pct)).await;
                        });
                    },
                ).await;
                if let Err(e) = res {
                    state.emitir_log("ERROR", &format!("[TELEGRAM] Fallo en clip {}: {}", clip_path.display(), e)).await;
                    todos = false;
                    break;
                }
            }
            if todos {
                exito = true;
            }
        } else {
            state.emitir_log("WARN", &format!("[TELEGRAM] No se encontraron clips en procesados/{}. Intentando video completo...", id_video)).await;
        }
    }

    if !exito && modo != "clips" {
        let v_orig = dir_descargas.join("video_original.mp4");
        if v_orig.exists() {
            let desc = meta_inicial.get("descripcion")
                .or_else(|| meta_inicial.get("descripcion_original"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let st_log = state.clone();
            let tit_clon = tit_clean.clone();
            let res = publisher.subir_video_mtproto(
                &v_orig,
                titulo_base,
                desc,
                Some(&canal),
                move |pct| {
                    let st = st_log.clone();
                    let t = tit_clon.clone();
                    tokio::spawn(async move {
                        st.emitir_log("INFO", &format!("[TELEGRAM] Video '{}' - Subiendo: {:.0}%", t, pct)).await;
                    });
                },
            ).await;

            match res {
                Ok(_) => { exito = true; }
                Err(e) => {
                    state.emitir_log("ERROR", &format!("[TELEGRAM] Fallo al subir video '{}': {}", tit_clean, e)).await;
                }
            }
        } else {
            state.emitir_log("ERROR", &format!("[TELEGRAM] No existe video_original.mp4 en descargas/{}", id_video)).await;
        }
    }

    if exito {
        let _ = auditor.marcar_plataforma_completada(&id_video, "telegram");
        state.emitir_log("OK", &format!("[TELEGRAM] ¡Video '{}' publicado exitosamente en {}!", tit_clean, canal)).await;
    }

    {
        let mut pipeline = state.estado_pipeline.write().await;
        pipeline.fase_3 = "idle".to_string();
    }
}
