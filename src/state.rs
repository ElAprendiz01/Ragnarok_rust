use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use serde::{Deserialize, Serialize};

use grammers_client::{Client, types::{LoginToken, PasswordToken}};

use crate::models::{EstadoPipeline, ParametrosGlobales};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub t: String,
    pub nivel: String,
    pub msg: String,    
}

pub enum TelegramAuthStage {
    AwaitingCode {
        client: Client,
        token: LoginToken,
        telefono: String,
    },
    AwaitingPassword {
        client: Client,
        token: PasswordToken,
        telefono: String,
    },
}

pub struct AppState {
    pub ruta_base: PathBuf,
    pub config: RwLock<ParametrosGlobales>,
    pub estado_pipeline: RwLock<EstadoPipeline>,
    pub tx_logs: broadcast::Sender<LogEvent>,
    pub auth_telegram: tokio::sync::Mutex<Option<TelegramAuthStage>>,
    pub auth_facebook_driver: tokio::sync::Mutex<Option<crate::crawler::chrome_driver::ChromeDriver>>,
    pub lock_publicacion_telegram: tokio::sync::Mutex<()>,
    pub cancelar_publicacion: std::sync::atomic::AtomicBool,
    pub telegram_autorizado: std::sync::atomic::AtomicBool,
}

impl AppState {
    pub fn new(ruta_base: PathBuf, config: ParametrosGlobales) -> Arc<Self> {
        let (tx, _rx) = broadcast::channel(500);
        Arc::new(Self {
            ruta_base,
            config: RwLock::new(config),
            estado_pipeline: RwLock::new(EstadoPipeline::default()),
            tx_logs: tx,
            auth_telegram: tokio::sync::Mutex::new(None),
            auth_facebook_driver: tokio::sync::Mutex::new(None),
            lock_publicacion_telegram: tokio::sync::Mutex::new(()),
            cancelar_publicacion: std::sync::atomic::AtomicBool::new(false),
            telegram_autorizado: std::sync::atomic::AtomicBool::new(false),
        })
    }

    /// Emite un log en tiempo real tanto al canal SSE como al archivo en disco.
    pub async fn emitir_log(&self, nivel: &str, mensaje: &str) {
        let ahora = chrono::Local::now();
        let estampa = ahora.format("%Y-%m-%d %H:%M:%S").to_string();
        let tiempo_corto = ahora.format("%H:%M:%S").to_string();

        let evento = LogEvent {
            t: tiempo_corto.clone(),
            nivel: nivel.to_uppercase(),
            msg: mensaje.to_string(),
        };

        // 0. Visualización inmediata en consola de terminal
        println!("[{}] [{}] {}", tiempo_corto, nivel.to_uppercase(), mensaje);

        // 1. Transmisión reactiva en memoria (SSE)
        let _ = self.tx_logs.send(evento);

        // 2. Persistencia en disco
        let ruta_log = self.ruta_base.join("datos_persistencia").join("log_tiempo_real.txt");
        if let Some(parent) = ruta_log.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }

        let linea = format!("{} ||| {} ||| {}\n", estampa, nivel.to_uppercase(), mensaje);
        use tokio::io::AsyncWriteExt;
        if let Ok(mut archivo) = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&ruta_log)
            .await
        {
            let _ = archivo.write_all(linea.as_bytes()).await;
        }
    }
}

/// Guardián RAII para garantizar la liberación segura de fases de pipeline (Solución RIESGO-01).
pub struct FaseGuard {
    fase_num: u8,
    state: Arc<AppState>,
    completado: bool,
}

impl FaseGuard {
    pub fn nuevo(fase_num: u8, state: Arc<AppState>) -> Self {
        Self {
            fase_num,
            state,
            completado: false,
        }
    }

    pub fn finalizar_con_exito(&mut self) {
        self.completado = true;
    }
}

impl Drop for FaseGuard {
    fn drop(&mut self) {
        let state = Arc::clone(&self.state);
        let fase = self.fase_num;
        let ok = self.completado;
        tokio::spawn(async move {
            let mut p = state.estado_pipeline.write().await;
            match fase {
                1 => p.fase_1 = "idle".to_string(),
                2 => p.fase_2 = "idle".to_string(),
                3 => p.fase_3 = "idle".to_string(),
                4 => p.fase_4 = "idle".to_string(),
                _ => {}
            }
            if !ok {
                state.emitir_log("WARN", &format!("Guardián RAII: Fase {} liberada automáticamente tras salida de contexto.", fase)).await;
            }
        });
    }
}
