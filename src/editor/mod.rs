pub mod pipeline;
#[allow(unused_imports)]
pub use pipeline::ejecutar_fase_2_completa;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use anyhow::{Context, Result};
use regex::Regex;
use serde_json::json;

use crate::state::AppState;

pub struct EditorVideo {
    pub duracion_min_seg: u32,
    pub duracion_max_seg: u32,
    pub bin_ffmpeg: PathBuf,
}

#[derive(Debug, Clone)]
pub struct Segmento {
    pub numero_parte: u32,
    pub inicio_seg: f64,
    pub duracion_seg: f64,
}

impl EditorVideo {
    pub fn new(duracion_min_seg: u32, duracion_max_seg: u32) -> Self {
        let bin_ffmpeg = Self::resolver_binario_ffmpeg();
        Self {
            duracion_min_seg,
            duracion_max_seg,
            bin_ffmpeg,
        }
    }

    /// Resuelve la ruta al ejecutable FFmpeg en el sistema o en los directorios conocidos.
    pub fn resolver_binario_ffmpeg() -> PathBuf {
        crate::publisher::media_meta::resolver_binario_ffmpeg()
            .unwrap_or_else(|| PathBuf::from("ffmpeg"))
    }

    /// Obtiene la duración total en segundos de un archivo de video.
    /// Lee metadata.json o ejecuta ffmpeg -i para capturar el header.
    pub async fn obtener_duracion(&self, ruta_video: &Path, ruta_dir_video: &Path) -> Result<f64> {
        // Intentar leer de metadata.json
        let ruta_meta = ruta_dir_video.join("metadata.json");
        if ruta_meta.exists() {
            if let Ok(contenido) = tokio::fs::read_to_string(&ruta_meta).await {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&contenido) {
                    if let Some(dur) = v.get("duracion_segundos").and_then(|d| d.as_f64()) {
                        if dur > 0.0 {
                            return Ok(dur);
                        }
                    }
                    if let Some(dur) = v.get("duration").and_then(|d| d.as_f64()) {
                        if dur > 0.0 {
                            return Ok(dur);
                        }
                    }
                }
            }
        }

        // Si no está en metadata, sondear con FFmpeg
        let output = tokio::process::Command::new(&self.bin_ffmpeg)
            .arg("-i")
            .arg(ruta_video)
            .output()
            .await
            .context("Error ejecutando FFmpeg para consultar duración")?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let re = Regex::new(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)")?;
        if let Some(caps) = re.captures(&stderr) {
            let h: f64 = caps[1].parse().unwrap_or(0.0);
            let m: f64 = caps[2].parse().unwrap_or(0.0);
            let s: f64 = caps[3].parse().unwrap_or(0.0);
            return Ok(h * 3600.0 + m * 60.0 + s);
        }

        anyhow::bail!("No se pudo determinar la duración del video {:?}", ruta_video)
    }

    /// Calcula los puntos de corte óptimos para un video según su duración total.
    pub fn calcular_segmentos(&self, duracion_total_seg: f64) -> Vec<Segmento> {
        let mut segmentos = Vec::new();
        let target = self.duracion_max_seg as f64;
        let remanente_min = self.duracion_min_seg as f64;
        let mut actual = 0.0;
        let mut parte = 1;

        while actual < duracion_total_seg {
            let restante = duracion_total_seg - actual;
            if restante <= target {
                segmentos.push(Segmento {
                    numero_parte: parte,
                    inicio_seg: actual,
                    duracion_seg: restante,
                });
                break;
            }

            // Si lo que quedaría después de este corte es menor que el remanente mínimo,
            // extendemos este corte ligeramente o lo dejamos como último.
            if (restante - target) < remanente_min {
                segmentos.push(Segmento {
                    numero_parte: parte,
                    inicio_seg: actual,
                    duracion_seg: restante,
                });
                break;
            }

            segmentos.push(Segmento {
                numero_parte: parte,
                inicio_seg: actual,
                duracion_seg: target,
            });

            actual += target;
            parte += 1;
        }

        segmentos
    }

    /// Corta un fragmento utilizando FFmpeg en modo stream-copy (-c copy) ultra rápido y Zero-RAM.
    pub async fn cortar_fragmento(
        &self,
        ruta_entrada: &Path,
        ruta_salida: &Path,
        segmento: &Segmento,
    ) -> Result<()> {
        if let Some(parent) = ruta_salida.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let output = tokio::process::Command::new(&self.bin_ffmpeg)
            .arg("-y")
            .arg("-ss")
            .arg(format!("{:.3}", segmento.inicio_seg))
            .arg("-i")
            .arg(ruta_entrada)
            .arg("-t")
            .arg(format!("{:.3}", segmento.duracion_seg))
            .arg("-c:v")
            .arg("copy")
            .arg("-c:a")
            .arg("copy")
            .arg("-avoid_negative_ts")
            .arg("make_zero")
            .arg("-fflags")
            .arg("+genpts")
            .arg("-movflags")
            .arg("+faststart")
            .arg(ruta_salida)
            .output()
            .await
            .context("Fallo ejecutando comando FFmpeg")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("FFmpeg retornó error al cortar: {}", stderr);
        }

        Ok(())
    }

    /// Procesa un video individual: calcula partes, corta los archivos y guarda metadata_segmentada.json
    pub async fn procesar_video_individual(
        &self,
        id_video: &str,
        dir_descargas: &Path,
        dir_procesados: &Path,
        app_state: Option<&Arc<AppState>>,
    ) -> Result<usize> {
        let dir_video_orig = dir_descargas.join(id_video);
        let ruta_original = dir_video_orig.join("video_original.mp4");

        if !ruta_original.exists() {
            anyhow::bail!("Video original no encontrado en {:?}", ruta_original);
        }

        let dir_destino = dir_procesados.join(id_video);
        tokio::fs::create_dir_all(&dir_destino).await?;

        // Verificar si ya tiene clips previamente generados
        let mut clips_existentes = 0;
        if let Ok(mut entries) = tokio::fs::read_dir(&dir_destino).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.path().extension().map(|e| e == "mp4").unwrap_or(false) {
                    clips_existentes += 1;
                }
            }
        }

        if clips_existentes > 0 {
            if let Some(state) = app_state {
                state.emitir_log(
                    "INFO",
                    &format!("Video {} ya posee {} clips en procesados. Omitiendo recorte.", id_video, clips_existentes),
                ).await;
            }
            return Ok(clips_existentes);
        }

        let duracion_total = self.obtener_duracion(&ruta_original, &dir_video_orig).await?;
        let segmentos = self.calcular_segmentos(duracion_total);

        if let Some(state) = app_state {
            state.emitir_log(
                "INFO",
                &format!("Procesando '{}': Duración {:.1}s -> {} partes a generar.", id_video, duracion_total, segmentos.len()),
            ).await;
        }

        let mut clips_info = Vec::new();

        for seg in &segmentos {
            let nombre_clip = format!("{}_Parte_{}.mp4", id_video, seg.numero_parte);
            let ruta_clip = dir_destino.join(&nombre_clip);

            if let Some(state) = app_state {
                state.emitir_log(
                    "INFO",
                    &format!("Generando Parte {}/{} para '{}'...", seg.numero_parte, segmentos.len(), id_video),
                ).await;
            }

            self.cortar_fragmento(&ruta_original, &ruta_clip, seg).await?;

            clips_info.push(json!({
                "parte": seg.numero_parte,
                "archivo": nombre_clip,
                "inicio_seg": seg.inicio_seg,
                "duracion_seg": seg.duracion_seg,
                "ruta_relativa": format!("procesados/{}/{}", id_video, nombre_clip)
            }));
        }

        // Guardar metadata_segmentada.json
        let metadata_segmentada = json!({
            "id_video": id_video,
            "duracion_total_seg": duracion_total,
            "total_partes": segmentos.len(),
            "clips": clips_info,
            "timestamp": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
        });

        let ruta_meta_seg = dir_destino.join("metadata_segmentada.json");
        tokio::fs::write(&ruta_meta_seg, serde_json::to_string_pretty(&metadata_segmentada)?).await?;

        if let Some(state) = app_state {
            state.emitir_log(
                "OK",
                &format!("Video '{}' segmentado con éxito ({} partes creadas).", id_video, segmentos.len()),
            ).await;
        }

        Ok(segmentos.len())
    }

    pub async fn ejecutar_fase_2_completa(
        dir_descargas: &Path,
        dir_procesados: &Path,
        duracion_bloque: u32,
        duracion_minima: u32,
        app_state: Arc<AppState>,
    ) -> Result<()> {
        pipeline::ejecutar_fase_2_completa(dir_descargas, dir_procesados, duracion_bloque, duracion_minima, app_state).await
    }
}

