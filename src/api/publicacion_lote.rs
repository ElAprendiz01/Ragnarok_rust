use std::sync::Arc;
use serde_json::json;

use crate::state::AppState;
use crate::storage::GestorAlmacenamiento;
use crate::publisher::{TelegramPublisher, GestorAuditoriaPublicaciones};

pub async fn ejecutar_tarea_lote_telegram(
    state: Arc<AppState>,
    canal: String,
    modo_video: String,
    forzar: bool,
    api_id: Option<i64>,
    api_hash: Option<String>,
    telefono: Option<String>,
) {
    let publisher = TelegramPublisher::with_credentials(
        &canal,
        &state.ruta_base,
        api_id,
        api_hash,
        telefono,
    );

    let _guard = state.lock_publicacion_telegram.lock().await;
    state.cancelar_publicacion.store(false, std::sync::atomic::Ordering::SeqCst);

    let ruta_persistencia = state.ruta_base.join("datos_persistencia");
    let auditor = GestorAuditoriaPublicaciones::new(&ruta_persistencia);
    let ya_publicados = auditor.obtener_ids_publicados("telegram");
    let dir_objetivo = if modo_video == "clips" {
        state.ruta_base.join("procesados")
    } else {
        state.ruta_base.join("descargas")
    };

    let ruta_cola = ruta_persistencia.join("cola_publicacion_telegram.json");
    let actualizar_estado_cola = |activo: bool, total: usize, completados: usize, fallidos: usize, actual: &str| {
        let datos = json!({
            "ok": true,
            "activo": activo,
            "total": total,
            "completados": completados,
            "fallidos": fallidos,
            "video_actual": actual,
        });
        let _ = std::fs::write(&ruta_cola, datos.to_string());
    };

    let mut carpetas = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir_objetivo) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                carpetas.push(p);
            }
        }
    }
    carpetas.sort();

    let a_procesar: Vec<_> = carpetas.into_iter().filter(|p| {
        let id = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        forzar || !ya_publicados.contains(&id)
    }).collect();

    let total_lote = a_procesar.len();
    let mut subidos_count = 0;
    let mut fallidos_count = 0;

    actualizar_estado_cola(true, total_lote, subidos_count, fallidos_count, "");

    for (idx, ruta_carpeta) in a_procesar.iter().enumerate() {
        if state.cancelar_publicacion.load(std::sync::atomic::Ordering::SeqCst) {
            state.emitir_log("WARN", "[TELEGRAM] Lote cancelado por el usuario.").await;
            break;
        }

        let actual_num = idx + 1;
        let id_video = ruta_carpeta.file_name().unwrap_or_default().to_string_lossy().to_string();
        actualizar_estado_cola(true, total_lote, subidos_count, fallidos_count, &id_video);

        let meta = GestorAlmacenamiento::leer_metadata(ruta_carpeta).unwrap_or_default();
        let titulo_completo = meta.get("titulo")
            .or_else(|| meta.get("titulo_original"))
            .and_then(|v| v.as_str())
            .unwrap_or(&id_video);

        let tit_clean = if titulo_completo.chars().count() > 32 {
            let mut s: String = titulo_completo.chars().take(29).collect();
            s.push_str("...");
            s
        } else {
            titulo_completo.to_string()
        };

        if modo_video == "clips" {
            let mut clips = Vec::new();
            if let Ok(archivos) = std::fs::read_dir(ruta_carpeta) {
                for a in archivos.flatten() {
                    let p = a.path();
                    if p.is_file() && p.extension().map_or(false, |ext| ext == "mp4") {
                        clips.push(p);
                    }
                }
            }
            clips.sort();

            if clips.is_empty() {
                continue;
            }

            let total_clips = clips.len();
            state.emitir_log(
                "INFO",
                &format!("[TELEGRAM] Video [{}/{}] '{}' - Subiendo {} clips hacia {}...", actual_num, total_lote, tit_clean, total_clips, canal),
            ).await;

            let mut todo_ok = true;
            for (clip_idx, clip_path) in clips.iter().enumerate() {
                if state.cancelar_publicacion.load(std::sync::atomic::Ordering::SeqCst) {
                    todo_ok = false;
                    break;
                }

                let parte_num = clip_idx + 1;
                let titulo_clip = format!("{} (Parte {})", titulo_completo, parte_num);
                let desc_clip = format!("Parte {}/{} • Película segmentada", parte_num, total_clips);

                let st_log = state.clone();
                let tit_clon = tit_clean.clone();
                let res = publisher.subir_video_mtproto(
                    clip_path,
                    &titulo_clip,
                    &desc_clip,
                    Some(&canal),
                    move |pct| {
                        let st = st_log.clone();
                        let t = tit_clon.clone();
                        tokio::spawn(async move {
                            st.emitir_log("INFO", &format!("[TELEGRAM] [{}/{}] '{}' (Clip {}/{}) - {:.0}%", actual_num, total_lote, t, parte_num, total_clips, pct)).await;
                        });
                    },
                ).await;

                if let Err(e) = res {
                    state.emitir_log("ERROR", &format!("[TELEGRAM] [{}/{}] Fallo en clip {}: {}", actual_num, total_lote, clip_path.display(), e)).await;
                    todo_ok = false;
                    break;
                }
            }

            if todo_ok {
                let _ = auditor.marcar_plataforma_completada(&id_video, "telegram");
                subidos_count += 1;
                state.emitir_log("OK", &format!("[TELEGRAM] [{}/{}] ¡Video '{}' subido completamente a {}!", actual_num, total_lote, tit_clean, canal)).await;
            } else {
                fallidos_count += 1;
            }
        } else {
            let v_orig = ruta_carpeta.join("video_original.mp4");
            if v_orig.exists() {
                let desc = meta.get("descripcion")
                    .or_else(|| meta.get("descripcion_original"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                state.emitir_log(
                    "INFO",
                    &format!("[TELEGRAM] Video [{}/{}] '{}' - Conectando para subida hacia {}...", actual_num, total_lote, tit_clean, canal),
                ).await;

                let st_log = state.clone();
                let tit_clon = tit_clean.clone();
                let res = publisher.subir_video_mtproto(
                    &v_orig,
                    titulo_completo,
                    desc,
                    Some(&canal),
                    move |pct| {
                        let st = st_log.clone();
                        let t = tit_clon.clone();
                        tokio::spawn(async move {
                            st.emitir_log("INFO", &format!("[TELEGRAM] [{}/{}] '{}' - Subiendo: {:.0}%", actual_num, total_lote, t, pct)).await;
                        });
                    },
                ).await;

                match res {
                    Ok(_) => {
                        let _ = auditor.marcar_plataforma_completada(&id_video, "telegram");
                        subidos_count += 1;
                        state.emitir_log("OK", &format!("[TELEGRAM] [{}/{}] ¡Video '{}' entregado con éxito en {}!", actual_num, total_lote, tit_clean, canal)).await;
                    }
                    Err(e) => {
                        state.emitir_log("ERROR", &format!("[TELEGRAM] [{}/{}] Fallo al subir '{}': {}", actual_num, total_lote, tit_clean, e)).await;
                        fallidos_count += 1;
                    }
                }
            }
        }

        actualizar_estado_cola(true, total_lote, subidos_count, fallidos_count, "");
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    }

    actualizar_estado_cola(false, total_lote, subidos_count, fallidos_count, "");

    {
        let mut pipeline = state.estado_pipeline.write().await;
        pipeline.fase_4 = "idle".to_string();
    }

    state.emitir_log(
        "OK",
        &format!("Lote Telegram finalizado: {} subido(s), {} fallido(s).", subidos_count, fallidos_count),
    ).await;
}
