use std::path::Path;
use anyhow::Result;
use serde_json::Value;

pub struct GestorAlmacenamiento;

impl GestorAlmacenamiento {
    pub fn contar_lineas(ruta: &Path) -> usize {
        if !ruta.exists() {
            return 0;
        }
        if let Ok(contenido) = std::fs::read_to_string(ruta) {
            contenido.lines().filter(|l| !l.trim().is_empty()).count()
        } else {
            0
        }
    }

    pub fn leer_metadata(ruta_carpeta: &Path) -> Option<Value> {
        let ruta_meta = ruta_carpeta.join("metadata.json");
        if ruta_meta.exists() {
            if let Ok(contenido) = std::fs::read_to_string(ruta_meta) {
                return serde_json::from_str(&contenido).ok();
            }
        }
        None
    }

    pub fn listar_videos_disco(dir_descargas: &Path, dir_procesados: &Path, dir_persistencia: &Path) -> Vec<Value> {
        let mut videos = Vec::new();
        if !dir_descargas.exists() {
            return videos;
        }

        let auditor = crate::publisher::GestorAuditoriaPublicaciones::new(dir_persistencia);
        let publicados_tg = auditor.obtener_ids_publicados("telegram");

        if let Ok(entries) = std::fs::read_dir(dir_descargas) {
            for entry in entries.flatten() {
                let ruta_carpeta = entry.path();
                if ruta_carpeta.is_dir() {
                    let id_video = ruta_carpeta.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let v_orig = ruta_carpeta.join("video_original.mp4");
                    if v_orig.exists() {
                        let meta = Self::leer_metadata(&ruta_carpeta).unwrap_or_default();
                        let tamano_bytes = v_orig.metadata().map(|m| m.len()).unwrap_or(0);
                        let tamano_mb = format!("{:.1} MB", tamano_bytes as f64 / (1024.0 * 1024.0));
                        let dur_seg = meta.get("duracion_segundos").and_then(|v| v.as_f64()).unwrap_or(0.0);

                        // Buscar clips en procesados/<id>/
                        let mut clips = Vec::new();
                        let dir_clips = dir_procesados.join(&id_video);
                        if dir_clips.exists() {
                            if let Ok(c_entries) = std::fs::read_dir(&dir_clips) {
                                for (idx, c) in c_entries.flatten().enumerate() {
                                    let p = c.path();
                                    if p.extension().map(|e| e == "mp4").unwrap_or(false) {
                                        clips.push(serde_json::json!({
                                            "nombre": p.file_name().unwrap_or_default().to_string_lossy(),
                                            "parte": idx + 1,
                                            "tamano": format!("{:.1} MB", p.metadata().map(|m| m.len()).unwrap_or(0) as f64 / (1024.0 * 1024.0)),
                                            "url_stream": format!("/media/procesados/{}/{}", id_video, p.file_name().unwrap_or_default().to_string_lossy())
                                        }));
                                    }
                                }
                            }
                        }

                        let ya_en_telegram = publicados_tg.contains(&id_video);
                        let estado = if ya_en_telegram {
                            "publicado"
                        } else if !clips.is_empty() {
                            "editado"
                        } else {
                            "descargado"
                        };

                        let ts_mod = v_orig.metadata()
                            .and_then(|m| m.modified())
                            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
                            .unwrap_or(0);

                        let fecha_descarga = meta.get("fecha_extraccion")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| {
                                chrono::DateTime::from_timestamp(ts_mod, 0)
                                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                                    .unwrap_or_default()
                            });

                        videos.push(serde_json::json!({
                            "id": id_video,
                            "id_video": id_video,
                            "titulo": meta.get("titulo").and_then(|v| v.as_str()).unwrap_or(&id_video),
                            "descripcion": meta.get("descripcion").and_then(|v| v.as_str()).unwrap_or(""),
                            "url_stream": format!("/media/descargas/{}/video_original.mp4", id_video),
                            "tamano": tamano_mb,
                            "duracion_segundos": dur_seg,
                            "estado": estado,
                            "clips": clips,
                            "publicado_telegram": ya_en_telegram,
                            "fecha_descarga": fecha_descarga,
                            "timestamp": ts_mod
                        }));
                    }
                }
            }
        }

        videos
    }

    pub fn eliminar_video(dir_descargas: &Path, dir_procesados: &Path, id: &str) -> Result<()> {
        let d_desc = dir_descargas.join(id);
        if d_desc.exists() {
            std::fs::remove_dir_all(d_desc)?;
        }
        let d_proc = dir_procesados.join(id);
        if d_proc.exists() {
            std::fs::remove_dir_all(d_proc)?;
        }
        Ok(())
    }
}
