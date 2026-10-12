pub mod chrome_driver;
pub mod gestor_archivos;
pub mod proceso_limpieza;
pub mod scripts;

pub use gestor_archivos::GestorExtraccion;

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use anyhow::{Context, Result};

use crate::state::AppState;
use chrome_driver::ChromeDriver;

impl GestorExtraccion {
    /// Extrae las URLs de video de una fuente de Facebook navegando directamente con Chrome CDP en 100% Rust.
    pub async fn extraer_enlaces_de_fuente(
        &self,
        ruta_base: &Path,
        url_fuente: &str,
        headless: bool,
        max_scrolls: usize,
        app_state: Option<&Arc<AppState>>,
    ) -> Result<Vec<String>> {
        if let Some(state) = app_state {
            state.emitir_log("INFO", &format!("[CRAWLER] Navegando fuente: {}", url_fuente)).await;
        }

        let mut driver = match ChromeDriver::lanzar_y_conectar(ruta_base, url_fuente, headless, 9333).await {
            Ok(d) => d,
            Err(e) => {
                ChromeDriver::lanzar_y_conectar(ruta_base, url_fuente, headless, 9334).await
                    .context(format!("No se pudo inicializar Chrome CDP: {}", e))?
            }
        };

        // Guardar/sincronizar cookies que Chrome tenga
        let _ = driver.guardar_cookies(&self.ruta_cookies_json, &self.ruta_cookies_netscape).await;

        let mut todos_los_enlaces: HashSet<String> = HashSet::new();
        let mut claves_vistas: HashSet<String> = HashSet::new();
        let mut sin_nuevos = 0;
        let dir_descargas = ruta_base.join("descargas");

        for i in 1..=max_scrolls {
            let urls = driver.extraer_enlaces_facebook().await.unwrap_or_default();
            let prev_count = todos_los_enlaces.len();

            for u in urls {
                let norm = Self::normalizar_url_facebook(&u);
                if norm.is_empty() {
                    continue;
                }
                if self.existe_en_completados(&norm)
                    || self.existe_en_historial(&norm)
                    || self.existe_en_disco(&dir_descargas, &norm) {
                    continue;
                }
                let clave = Self::extraer_id_numerico_facebook(&norm).unwrap_or_else(|| norm.clone());
                if claves_vistas.insert(clave) {
                    todos_los_enlaces.insert(norm);
                }
            }

            let nuevos = todos_los_enlaces.len() - prev_count;
            if nuevos > 0 {
                sin_nuevos = 0;
                if let Some(state) = app_state {
                    state.emitir_log("INFO", &format!("[SCROLL {}/{}] +{} URLs detectadas (Total: {})", i, max_scrolls, nuevos, todos_los_enlaces.len())).await;
                }
            } else {
                sin_nuevos += 1;
                if sin_nuevos >= 2 {
                    if let Some(state) = app_state {
                        state.emitir_log("INFO", "[SCROLL] Fin de contenido o sin nuevos videos detectados.").await;
                    }
                    break;
                }
            }

            // Simular scroll humano con distancia variable
            let distancia = 400 + (i as i32 % 3) * 150;
            let _ = driver.simular_scroll_humano(distancia).await;
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }

        // Guardar cookies finales tras la navegación
        let _ = driver.guardar_cookies(&self.ruta_cookies_json, &self.ruta_cookies_netscape).await;

        driver.cerrar_suave().await;
        proceso_limpieza::liberar_bloqueos_perfil(ruta_base).await;

        let resultado: Vec<String> = todos_los_enlaces.into_iter().collect();
        if let Some(state) = app_state {
            state.emitir_log("OK", &format!("[CRAWLER] Capturadas {} URLs canónicas únicas de {}", resultado.len(), url_fuente)).await;
        }

        Ok(resultado)
    }

    /// Orquestador completo de la Fase 1: Extracción de Fuentes y Descarga de Pendientes.
    pub async fn ejecutar_fase_1_completa(
        ruta_base: &Path,
        app_state: Arc<AppState>,
    ) -> Result<()> {
        app_state.emitir_log("INFO", "Iniciando Fase 1: Extracción & Descarga...").await;

        let gestor = GestorExtraccion::new(ruta_base);
        gestor.inicializar_archivos_si_no_existen()?;

        let dir_descargas = ruta_base.join("descargas");

        let (headless, max_scrolls) = {
            let cfg = app_state.config.read().await;
            (
                cfg.extraccion.headless.unwrap_or(false),
                cfg.extraccion.max_scrolls_por_sesion.unwrap_or(30) as usize,
            )
        };

        // Paso 1: Explorar fuentes activas si existen (deduplicando parámetros idénticos)
        let fuentes = gestor.cargar_fuentes()?;
        let mut fuentes_vistas = HashSet::new();
        let mut fuentes_unicas = Vec::new();
        for f in fuentes {
            let clave = if let Some(idx) = f.find("&referrer=") { f[..idx].to_string() } else { f.clone() };
            if fuentes_vistas.insert(clave) {
                fuentes_unicas.push(f);
            }
        }

        if !fuentes_unicas.is_empty() {
            app_state.emitir_log("INFO", &format!("Explorando {} fuente(s) única(s) con Chrome CDP nativo...", fuentes_unicas.len())).await;

            for f in fuentes_unicas {
                {
                    let pipeline = app_state.estado_pipeline.read().await;
                    if pipeline.fase_1 == "idle" {
                        app_state.emitir_log("WARN", "Extracción cancelada por el usuario.").await;
                        break;
                    }
                }

                match gestor.extraer_enlaces_de_fuente(ruta_base, &f, headless, max_scrolls, Some(&app_state)).await {
                    Ok(enlaces) => {
                        let mut nuevos = 0;
                        for e in enlaces {
                            if let Ok(true) = gestor.encolar_pendiente(&e) {
                                nuevos += 1;
                            }
                        }
                        app_state.emitir_log("OK", &format!("Encolados {} videos nuevos de {}", nuevos, f)).await;
                    }
                    Err(e) => {
                        app_state.emitir_log("WARN", &format!("Error extrayendo fuente {}: {}", f, e)).await;
                    }
                }
            }
        } else {
            app_state.emitir_log("INFO", "No hay fuentes configuradas en fuentes_url.txt. Pasando a cola de descargas...").await;
        }

        // Paso 2: Procesar la cola de pendientes mediante el motor de descargas si no fue detenida
        let debe_descargar = {
            let pipeline = app_state.estado_pipeline.read().await;
            pipeline.fase_1 == "running"
        };

        let exitosos = if debe_descargar {
            crate::downloader::GestorDescargas::procesar_cola_pendientes(
                &dir_descargas,
                app_state.clone(),
            ).await.unwrap_or(0)
        } else {
            0
        };

        // Finalizar estado de Fase 1
        {
            let mut pipeline = app_state.estado_pipeline.write().await;
            pipeline.fase_1 = "idle".to_string();
        }

        app_state.emitir_log("OK", &format!("Fase 1 completada exitosamente. {} video(s) procesados.", exitosos)).await;
        Ok(())
    }
}
