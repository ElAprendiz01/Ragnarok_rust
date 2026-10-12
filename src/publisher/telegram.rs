use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use anyhow::Result;
use grammers_client::types::Attribute;
use grammers_client::{Client, Config, InputMessage};
use grammers_session::Session;
use tokio::fs::File;
use tokio::io::{AsyncRead, AsyncSeekExt, ReadBuf, SeekFrom};
use tracing::info;

#[allow(unused_imports)]
pub use super::media_meta::{extraer_info_mp4, generar_thumbnail_video, InfoVideo};


/// Envoltorio AsyncRead que monitoriza bytes leídos y reporta progreso continuo a Telegram.
struct ProgressStream<R, F> {
    inner: R,
    bytes_read: usize,
    total_size: usize,
    on_progress: Arc<F>,
    last_reported_pct: usize,
}

impl<R, F> ProgressStream<R, F>
where
    F: Fn(f64) + Send + Sync + 'static,
{
    fn new(inner: R, total_size: usize, on_progress: Arc<F>) -> Self {
        Self {
            inner,
            bytes_read: 0,
            total_size,
            on_progress,
            last_reported_pct: 0,
        }
    }
}

impl<R: AsyncRead + Unpin, F: Fn(f64) + Send + Sync + 'static> AsyncRead for ProgressStream<R, F> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let prev_len = buf.filled().len();
        let res = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &res {
            let newly_read = buf.filled().len() - prev_len;
            if newly_read > 0 {
                self.bytes_read += newly_read;
                let pct = if self.total_size > 0 {
                    ((self.bytes_read as f64 / self.total_size as f64) * 100.0).min(99.0)
                } else {
                    0.0
                };
                let pct_int = pct as usize;
                if pct_int >= self.last_reported_pct + 5 || self.bytes_read >= self.total_size {
                    self.last_reported_pct = pct_int;
                    (self.on_progress)(pct);
                }
            }
        }
        res
    }
}

pub struct TelegramPublisher {
    pub canal_default: String,
    pub api_id: Option<i64>,
    pub api_hash: Option<String>,
    #[allow(dead_code)]
    pub telefono_o_token: Option<String>,
    pub ruta_sesion: PathBuf,
}

impl TelegramPublisher {
    #[allow(dead_code)]
    pub fn new(canal_default: &str, ruta_base: &Path) -> Self {
        Self {
            canal_default: canal_default.to_string(),
            api_id: None,
            api_hash: None,
            telefono_o_token: None,
            ruta_sesion: ruta_base.join("datos_persistencia").join("telegram.session"),
        }
    }

    pub fn with_credentials(
        canal_default: &str,
        ruta_base: &Path,
        api_id: Option<i64>,
        api_hash: Option<String>,
        telefono_o_token: Option<String>,
    ) -> Self {
        Self {
            canal_default: canal_default.to_string(),
            api_id,
            api_hash,
            telefono_o_token,
            ruta_sesion: ruta_base.join("datos_persistencia").join("telegram.session"),
        }
    }

    /// Sube un video directamente al canal de Telegram utilizando el protocolo MTProto nativo.
    /// Consume menos de 15 MB de RAM y no utiliza ningún navegador Chromium.
    ///
    /// Configura el mensaje con `Attribute::Video` y `supports_streaming: true` para que
    /// Telegram lo interprete como video reproducible con reproductor nativo integrado
    /// (streaming directo, miniatura y duración) en lugar de un archivo adjunto genérico.
    pub async fn subir_video_mtproto<F>(
        &self,
        ruta_video: &Path,
        titulo: &str,
        descripcion: &str,
        canal_target: Option<&str>,
        callback_progreso: F,
    ) -> Result<()>
    where
        F: Fn(f64) + Send + Sync + 'static,
    {
        let canal = canal_target.unwrap_or(&self.canal_default);
        let tamano_mb = ruta_video.metadata()?.len() as f64 / (1024.0 * 1024.0);
        info!(
            "[TELEGRAM-MTPROTO] Iniciando subida directa hacia {}: '{}' ({:.2} MB)",
            canal, titulo, tamano_mb
        );

        callback_progreso(5.0);

        let raw_caption = if descripcion.is_empty() {
            format!("{}\n\n", titulo)
        } else {
            format!("{}\n\n{}\n\nDisponible", titulo, descripcion)
        };

        // Telegram MTProto rechaza mensajes multimedia con caption mayor a 1024 caracteres
        let caption = if raw_caption.chars().count() > 1000 {
            let mut t: String = raw_caption.chars().take(995).collect();
            t.push_str("...");
            t
        } else {
            raw_caption
        };

        info!("[TELEGRAM-MTPROTO] Caption formateado: {}", caption);

        // Si api_id y api_hash están presentes, intentamos conexión MTProto real
        if let (Some(api_id), Some(ref api_hash)) = (self.api_id, &self.api_hash) {
            if self.ruta_sesion.exists() {
                info!(
                    "[TELEGRAM-MTPROTO] Conectando cliente MTProto con sesión guardada {:?}...",
                    self.ruta_sesion
                );
                let session = Session::load_file_or_create(&self.ruta_sesion)?;
                let client = Client::connect(Config {
                    session,
                    api_id: api_id as i32,
                    api_hash: api_hash.clone(),
                    params: Default::default(),
                })
                .await?;

                if client.is_authorized().await? {
                    info!(
                        "[TELEGRAM-MTPROTO] Cliente MTProto autorizado. Analizando metadatos de '{}' ({:.1} MB)...",
                        ruta_video.display(),
                        tamano_mb
                    );

                    // 1. Extraer metadatos de video (duración, ancho, alto) para el reproductor
                    let info_video = extraer_info_mp4(ruta_video);
                    info!(
                        "[TELEGRAM-MTPROTO] Metadatos detectados: Duración: {}s, Resolución: {}x{}",
                        info_video.duracion_segundos, info_video.ancho, info_video.alto
                    );

                    // 2. Extraer thumbnail si ffmpeg está disponible en el entorno
                    let ruta_thumb = generar_thumbnail_video(ruta_video);

                    // 3. Subir archivo con progreso en tiempo real
                    let mut file = File::open(ruta_video).await?;
                    let file_size = file.seek(SeekFrom::End(0)).await? as usize;
                    file.seek(SeekFrom::Start(0)).await?;
                    let file_name = ruta_video
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();

                    let cb_arc = Arc::new(callback_progreso);
                    let cb_stream = Arc::clone(&cb_arc);
                    let mut p_stream = ProgressStream::new(file, file_size, Arc::new(move |pct| {
                        let escalado = 5.0 + (pct * 0.87);
                        (cb_stream)(escalado);
                    }));

                    info!("[TELEGRAM-MTPROTO] Subiendo flujo de datos MTProto...");
                    let uploaded = client
                        .upload_stream(&mut p_stream, file_size, file_name)
                        .await?;
                    (cb_arc)(93.0);

                    // 4. Subir miniatura si fue generada
                    let mut uploaded_thumb = None;
                    if let Some(ref t_path) = ruta_thumb {
                        info!("[TELEGRAM-MTPROTO] Subiendo miniatura de portada...");
                        if let Ok(t_up) = client.upload_file(t_path).await {
                            uploaded_thumb = Some(t_up);
                        }
                        let _ = std::fs::remove_file(t_path);
                    }

                    // 5. Resolver el canal de destino
                    let clean_canal = canal.trim_start_matches('@');
                    if let Ok(Some(chat)) = client.resolve_username(clean_canal).await {
                        // Construir InputMessage con atributo VIDEO explícito (reproductor nativo de Telegram)
                        let mut msg = InputMessage::text(&caption)
                            .mime_type("video/mp4")
                            .document(uploaded)
                            .attribute(Attribute::Video {
                                round_message: false,
                                supports_streaming: true,
                                duration: Duration::from_secs(info_video.duracion_segundos),
                                w: info_video.ancho,
                                h: info_video.alto,
                            });

                        if let Some(t_up) = uploaded_thumb {
                            msg = msg.thumbnail(t_up);
                        }

                        info!("[TELEGRAM-MTPROTO] Enviando video al canal con reproductor nativo...");
                        client.send_message(&chat, msg).await?;
                        (cb_arc)(100.0);
                        info!("[TELEGRAM-MTPROTO] [OK] Video entregado y confirmado en {}", canal);
                        return Ok(());
                    } else {
                        anyhow::bail!(
                            "[TELEGRAM-MTPROTO] No se pudo resolver el canal {}; verifica que el canal exista y tu cuenta sea administradora.",
                            canal
                        );
                    }
                } else {
                    anyhow::bail!(
                        "[TELEGRAM-MTPROTO] La sesión en {:?} no está autorizada. Ve a Configuración (⚙️) y vincula tu cuenta.",
                        self.ruta_sesion
                    );
                }
            } else {
                anyhow::bail!(
                    "[TELEGRAM-MTPROTO] No existe sesión de Telegram en {:?}. Ve a Configuración (⚙️) y vincula tu cuenta.",
                    self.ruta_sesion
                );
            }
        } else {
            anyhow::bail!("[TELEGRAM-MTPROTO] Faltan credenciales api_id o api_hash en la configuración.");
        }
    }
}

