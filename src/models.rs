use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParametrosGlobales {
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub extraccion: ExtraccionConfig,
    #[serde(default)]
    pub edicion: EdicionConfig,
    #[serde(default)]
    pub publicacion: PublicacionConfig,
    #[serde(default)]
    pub rutas: RutasConfig,
    #[serde(default)]
    pub canal_telegram: Option<String>,
    #[serde(default)]
    pub canales_telegram: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeneralConfig {
    pub nombre_proyecto: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtraccionConfig {
    pub max_videos_por_sesion: Option<u32>,
    pub formato_descarga: Option<String>,
    pub headless: Option<bool>,
    pub max_scrolls_por_sesion: Option<u32>,
    pub pausa_entre_descargas_seg: Option<u64>,
    pub max_reintentos_descarga: Option<u32>,
    pub limite_velocidad_descarga: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EdicionConfig {
    #[serde(alias = "duracion_maxima_clip_seg")]
    pub duracion_bloque_segundos: Option<u32>,
    #[serde(alias = "duracion_minima_clip_seg")]
    pub duracion_minima_remanente_segundos: Option<u32>,
    pub factor_velocidad: Option<f32>,
    pub threads_ffmpeg: Option<u32>,
    pub encoder_preferido: Option<String>,
    pub stream_copy: Option<bool>,
    pub corte_exacto: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PublicacionConfig {
    pub canal_telegram: Option<String>,
    pub canales_telegram: Option<Vec<String>>,
    pub plataformas_activas: Option<Vec<String>>,
    pub pausa_segundos_entre_videos: Option<u32>,
    pub telegram_api_id: Option<i64>,
    pub telegram_api_hash: Option<String>,
    pub telegram_telefono: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RutasConfig {
    pub directorio_descargas: Option<String>,
    pub directorio_procesados: Option<String>,
    pub log_tiempo_real: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoItem {
    pub id_video: String,
    pub titulo: String,
    pub descripcion: String,
    pub ruta_video: String,
    pub tamano_mb: f64,
    pub clips: Vec<String>,
    pub completado_telegram: bool,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColaTelegramItem {
    pub indice: usize,
    pub id_video: String,
    pub ruta_video: String,
    pub nombre_archivo: String,
    pub titulo: String,
    pub descripcion: String,
    pub numero_parte: u32,
    pub tamano_mb: f64,
    pub estado: String, // "PENDIENTE", "COMPLETADO", "ERROR"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoPipeline {
    pub fase_1: String, // "idle", "running", "done", "error"
    pub fase_2: String,
    pub fase_3: String,
    pub fase_4: String, // Lote Telegram
}

impl Default for EstadoPipeline {
    fn default() -> Self {
        Self {
            fase_1: "idle".to_string(),
            fase_2: "idle".to_string(),
            fase_3: "idle".to_string(),
            fase_4: "idle".to_string(),
        }
    }
}
