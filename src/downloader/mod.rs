use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use anyhow::Result;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::crawler::GestorExtraccion;
use crate::state::AppState;

const USER_AGENT_REAL: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/// Motor de descarga optimizado con salida de progreso en tiempo real y protección anti-bloqueos.
pub struct GestorDescargas;

impl GestorDescargas {
    /// Descarga un video individual transmitiendo su progreso línea a línea en tiempo real a la consola y panel.
    pub async fn descargar_video_con_reintentos(
        gestor: &GestorExtraccion,
        url: &str,
        dir_descargas: &Path,
        app_state: &Arc<AppState>,
    ) -> Result<String> {
        let norm_url = GestorExtraccion::normalizar_url_facebook(url);
        let id_video = GestorExtraccion::generar_id_video(&norm_url);
        let dir_video = dir_descargas.join(&id_video);
        tokio::fs::create_dir_all(&dir_video).await?;

        let video_salida = dir_video.join("video_original.mp4");

        // Candado Anti-Duplicados: Verificar si ya existe en disco o en memoria
        let existe_en_disco = gestor.existe_en_disco(dir_descargas, &norm_url);
        let existe_en_completados = gestor.existe_en_completados(&norm_url);

        if existe_en_disco || existe_en_completados {
            app_state.emitir_log("INFO", &format!("Video [{}] ya existe en disco o completados. Omitiendo descarga duplicada.", id_video)).await;
            let _ = gestor.remover_de_pendientes(&norm_url);
            let _ = gestor.registrar_completado(&id_video, &norm_url);
            let _ = gestor.registrar_en_historial(&norm_url);
            return Ok(id_video);
        }

        let (max_reintentos, limite_velocidad) = {
            let cfg = app_state.config.read().await;
            (
                cfg.extraccion.max_reintentos_descarga.unwrap_or(3),
                cfg.extraccion.limite_velocidad_descarga.clone(),
            )
        };

        let pausas_reintento = [5u64, 15u64, 30u64];
        let cookies_opt = gestor.asegurar_cookies_netscape().ok().flatten();

        app_state.emitir_log("INFO", &format!("Iniciando descarga de [{}]...", id_video)).await;

        let mut ultimo_error = String::new();
        let mut descarga_exitosa = false;

        for intento in 1..=max_reintentos {
            if intento > 1 {
                let pausa_idx = (intento as usize - 2).min(pausas_reintento.len() - 1);
                let seg = pausas_reintento[pausa_idx];
                app_state.emitir_log("WARN", &format!("Reintento {}/{} para [{}] tras {}s de enfriamiento...", intento, max_reintentos, id_video, seg)).await;
                tokio::time::sleep(Duration::from_secs(seg)).await;
            }

            let plantilla = dir_video.join("video_original.%(ext)s");
            let mut cmd = tokio::process::Command::new("yt-dlp");
            cmd.kill_on_drop(true);

            cmd.arg("-f")
                .arg("bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[ext=mp4]/best")
                .arg("--merge-output-format").arg("mp4")
                .arg("--write-info-json")
                .arg("--no-playlist")
                .arg("--no-warnings")
                .arg("--progress")
                .arg("--newline")
                .arg("--retries").arg("5")
                .arg("--fragment-retries").arg("5")
                .arg("--socket-timeout").arg("30")
                .arg("--user-agent").arg(USER_AGENT_REAL)
                .arg("--add-header").arg("Accept-Language: es-ES,es;q=0.9,en;q=0.8")
                .arg("--add-header").arg("Sec-Fetch-Mode: navigate")
                .arg("-o").arg(plantilla.to_string_lossy().to_string())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            if let Some(ref cookies_path) = cookies_opt {
                cmd.arg("--cookies").arg(cookies_path);
            }

            if let Some(ref limite) = limite_velocidad {
                if !limite.trim().is_empty() {
                    cmd.arg("--limit-rate").arg(limite.trim());
                }
            }

            cmd.arg(&norm_url);

            match cmd.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take();
                    let stderr = child.stderr.take();

                    let (tx, mut rx) = tokio::sync::mpsc::channel::<(bool, String)>(100);

                    if let Some(out) = stdout {
                        let tx_out = tx.clone();
                        tokio::spawn(async move {
                            let mut lines = BufReader::new(out).lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                let _ = tx_out.send((false, line)).await;
                            }
                        });
                    }

                    if let Some(err) = stderr {
                        let tx_err = tx.clone();
                        tokio::spawn(async move {
                            let mut lines = BufReader::new(err).lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                let _ = tx_err.send((true, line)).await;
                            }
                        });
                    }
                    drop(tx);

                    let mut ultimo_log_time = std::time::Instant::now();

                    while let Some((es_error, linea)) = rx.recv().await {
                        let limpia = linea.trim();
                        if limpia.is_empty() {
                            continue;
                        }

                        if es_error {
                            eprintln!("[yt-dlp stderr] {}", limpia);
                            if limpia.contains("ERROR") || limpia.contains("error") {
                                ultimo_error = limpia.to_string();
                                app_state.emitir_log("WARN", &format!("[yt-dlp] {}", limpia)).await;
                            }
                        } else {
                            println!("[yt-dlp] {}", limpia);
                            if limpia.starts_with("[download]") {
                                if limpia.contains('%') {
                                    if ultimo_log_time.elapsed().as_millis() >= 1200 || limpia.contains("100%") {
                                        ultimo_log_time = std::time::Instant::now();
                                        app_state.emitir_log("INFO", &format!("[yt-dlp] {}", limpia)).await;
                                    }
                                } else if limpia.contains("Destination") {
                                    app_state.emitir_log("INFO", "[yt-dlp] Conexión establecida. Iniciando descarga...").await;
                                }
                            } else if limpia.starts_with("[Merger]") {
                                app_state.emitir_log("INFO", "[yt-dlp] Uniendo pistas de video y audio en MP4 final...").await;
                            } else if limpia.contains("Downloading webpage") || limpia.contains("Extracting URL") {
                                if ultimo_log_time.elapsed().as_millis() >= 1000 {
                                    ultimo_log_time = std::time::Instant::now();
                                    app_state.emitir_log("INFO", "[yt-dlp] Consultando video en los servidores de Facebook...").await;
                                }
                            }
                        }
                    }

                    if let Ok(status) = child.wait().await {
                        if status.success() && video_salida.exists() {
                            descarga_exitosa = true;
                            break;
                        }
                    }
                }
                Err(e) => {
                    ultimo_error = format!("Error al invocar ejecutable yt-dlp: {}", e);
                }
            }
        }

        if !descarga_exitosa {
            let _ = gestor.registrar_error(&norm_url, "Downloader", "DESCARGA_FALLIDA", &ultimo_error);
            let _ = gestor.remover_de_pendientes(&norm_url);
            app_state.emitir_log("ERROR", &format!("Descarga fallida para [{}]: {}", id_video, ultimo_error)).await;
            anyhow::bail!("Fallo descarga tras {} intentos: {}", max_reintentos, ultimo_error);
        }

        // Leer el archivo .info.json para componer metadata completa
        let mut info_raw = json!({});
        if let Ok(mut entries) = tokio::fs::read_dir(&dir_video).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let p = entry.path();
                if p.to_string_lossy().ends_with(".info.json") {
                    if let Ok(contenido) = tokio::fs::read_to_string(&p).await {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contenido) {
                            info_raw = parsed;
                            let _ = tokio::fs::remove_file(&p).await;
                            break;
                        }
                    }
                }
            }
        }

        let titulo = info_raw.get("title").and_then(|t| t.as_str()).unwrap_or("Sin título");
        let duracion = info_raw.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0);
        let descripcion = info_raw.get("description").and_then(|d| d.as_str()).unwrap_or("");
        let w = info_raw.get("width").and_then(|w| w.as_i64()).unwrap_or(0);
        let h = info_raw.get("height").and_then(|h| h.as_i64()).unwrap_or(0);
        let resolucion = if w > 0 && h > 0 { format!("{}x{}", w, h) } else { "1920x1080".to_string() };
        let tamano_bytes = tokio::fs::metadata(&video_salida).await.map(|m| m.len()).unwrap_or(0);

        let metadata = json!({
            "id_video": id_video, "url_original": norm_url, "titulo": titulo, "titulo_original": titulo,
            "descripcion": descripcion, "descripcion_original": descripcion,
            "fecha_extraccion": chrono::Local::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            "duracion_segundos": duracion, "resolucion": resolucion, "formato": "mp4",
            "codec_video": "h264", "codec_audio": "aac", "tamanio_bytes": tamano_bytes
        });

        let ruta_meta = dir_video.join("metadata.json");
        tokio::fs::write(&ruta_meta, serde_json::to_string_pretty(&metadata)?).await?;

        // Sincronizar archivos de persistencia de memoria
        gestor.registrar_completado(&id_video, &norm_url)?;
        gestor.registrar_en_historial(&norm_url)?;
        gestor.remover_de_pendientes(&norm_url)?;

        app_state.emitir_log("OK", &format!("Video '{}' ({}) descargado y registrado con éxito.", titulo, id_video)).await;
        Ok(id_video)
    }

    /// Procesa secuencialmente todos los videos en la cola de pendientes con pausas humanas de enfriamiento.
    pub async fn procesar_cola_pendientes(
        dir_descargas: &Path,
        app_state: Arc<AppState>,
    ) -> Result<usize> {
        let gestor = GestorExtraccion::new(&app_state.ruta_base);
        gestor.inicializar_archivos_si_no_existen()?;

        let pendientes = gestor.cargar_pendientes()?;
        if pendientes.is_empty() {
            app_state.emitir_log("INFO", "Cola de pendientes vacía. No hay videos por descargar.").await;
            return Ok(0);
        }

        let total = pendientes.len();
        app_state.emitir_log("INFO", &format!("Procesando cola de descargas: {} video(s) pendientes...", total)).await;

        let pausa_entre_descargas = {
            let cfg = app_state.config.read().await;
            cfg.extraccion.pausa_entre_descargas_seg.unwrap_or(2)
        };

        let mut exitosos = 0;
        let mut procesados_en_lote: std::collections::HashSet<String> = std::collections::HashSet::new();

        for (idx, url) in pendientes.into_iter().enumerate() {
            let clave = GestorExtraccion::extraer_id_numerico_facebook(&url).unwrap_or_else(|| url.clone());
            if !procesados_en_lote.insert(clave) {
                let _ = gestor.remover_de_pendientes(&url);
                continue;
            }

            // Verificar si el usuario detuvo la fase desde el panel
            {
                let pipeline = app_state.estado_pipeline.read().await;
                if pipeline.fase_1 == "idle" {
                    app_state.emitir_log("WARN", "Descarga de pendientes detenida por el usuario.").await;
                    break;
                }
            }

            let num = idx + 1;
            let pct_general = (idx * 100) / total;
            app_state.emitir_log("INFO", &format!("({}/{}) [Progreso Lote: {}%] Conectando con servidor para: {}", num, total, pct_general, url)).await;

            match Self::descargar_video_con_reintentos(&gestor, &url, dir_descargas, &app_state).await {
                Ok(_) => {
                    exitosos += 1;
                }
                Err(e) => {
                    tracing::error!("Error descargando URL {}: {:?}", url, e);
                }
            }

            // Pausa de enfriamiento cautelosa entre descargas para evitar bloqueos por tasa de peticiones (429/403)
            if num < total && pausa_entre_descargas > 0 {
                tokio::time::sleep(Duration::from_secs(pausa_entre_descargas)).await;
            }
        }

        app_state.emitir_log("OK", &format!("Ciclo de descargas finalizado: {}/{} completado(s) exitosamente.", exitosos, total)).await;
        Ok(exitosos)
    }
}
