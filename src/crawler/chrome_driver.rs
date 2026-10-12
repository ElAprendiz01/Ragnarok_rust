use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use anyhow::{anyhow, Context, Result};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tokio_tungstenite::tungstenite::Message;

#[allow(dead_code)]
pub struct ChromeDriver {
    pub proceso_chrome: Option<tokio::process::Child>,
    pub ws_stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
    msg_id: AtomicU64,
    pub puerto: u16,
}

impl ChromeDriver {
    /// Detecta el ejecutable de Google Chrome o Microsoft Edge en Windows.
    pub fn detectar_navegador() -> Result<PathBuf> {
        super::proceso_limpieza::detectar_navegador()
    }

    /// Lanza Chrome con puerto de depuración CDP y conecta el WebSocket nativo en Rust.
    pub async fn lanzar_y_conectar(
        ruta_base: &Path,
        url_inicial: &str,
        headless: bool,
        puerto: u16,
    ) -> Result<Self> {
        // Garantizar que no haya procesos zombis de ejecuciones previas ni archivos lockfile
        super::proceso_limpieza::liberar_bloqueos_perfil(ruta_base).await;

        let ejecutable = Self::detectar_navegador()?;
        let perfil_dir = ruta_base.join("datos_persistencia").join("perfil_facebook_chromium");
        tokio::fs::create_dir_all(&perfil_dir).await?;

        let mut cmd = tokio::process::Command::new(&ejecutable);
        cmd.arg(format!("--remote-debugging-port={}", puerto))
            .arg(format!("--user-data-dir={}", perfil_dir.to_string_lossy()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-blink-features=AutomationControlled")
            .arg("--disable-infobars")
            .arg("--disable-features=IsolateOrigins,site-per-process")
            .arg("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
            .arg("--window-size=1366,768");

        if headless {
            cmd.arg("--headless=new");
        } else {
            cmd.arg("--start-maximized");
        }

        cmd.arg(url_inicial);

        // Desacoplar salida para no bloquear el proceso
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());

        let child = cmd.spawn().context("Error al iniciar proceso de Chromium")?;

        // Esperar a que el servidor CDP de Chrome esté escuchando en el puerto
        let cliente_http = reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()?;

        let mut ws_url_opt: Option<String> = None;
        for _ in 0..25 {
            tokio::time::sleep(Duration::from_millis(400)).await;
            let url_check = format!("http://127.0.0.1:{}/json", puerto);
            if let Ok(resp) = cliente_http.get(&url_check).send().await {
                if let Ok(tabs) = resp.json::<Vec<Value>>().await {
                    for tab in tabs {
                        if tab.get("type").and_then(|t| t.as_str()) == Some("page") {
                            if let Some(ws) = tab.get("webSocketDebuggerUrl").and_then(|w| w.as_str()) {
                                ws_url_opt = Some(ws.to_string());
                                break;
                            }
                        }
                    }
                    if ws_url_opt.is_some() {
                        break;
                    }
                }
            }
        }

        let ws_url = ws_url_opt.ok_or_else(|| anyhow!("Timeout esperando que Chrome habilite el puerto CDP {}", puerto))?;
        let (ws_stream, _) = connect_async(&ws_url).await
            .context("Error conectando WebSocket a Chrome CDP")?;

        let mut driver = Self {
            proceso_chrome: Some(child),
            ws_stream,
            msg_id: AtomicU64::new(1),
            puerto,
        };

        // Habilitar dominios principales de CDP
        let _ = driver.enviar_comando("Runtime.enable", json!({})).await;
        let _ = driver.enviar_comando("Network.enable", json!({})).await;
        let _ = driver.enviar_comando("Page.enable", json!({})).await;

        // Inyectar script anti-detección (Stealth) en cada frame/documento nuevo
        let _ = driver.enviar_comando("Page.addScriptToEvaluateOnNewDocument", json!({
            "source": super::scripts::SCRIPT_STEALTH
        })).await;

        Ok(driver)
    }

    /// Envía un comando JSON por WebSocket a Chrome DevTools Protocol y espera la respuesta.
    pub async fn enviar_comando(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.msg_id.fetch_add(1, Ordering::SeqCst);
        let solicitud = json!({
            "id": id,
            "method": method,
            "params": params
        });

        self.ws_stream.send(Message::Text(solicitud.to_string())).await?;

        // Leer mensajes hasta encontrar la respuesta con nuestro ID
        let mut timeout = tokio::time::interval(Duration::from_millis(50));
        let mut intentos = 0;

        while intentos < 200 {
            tokio::select! {
                Some(msg_res) = self.ws_stream.next() => {
                    if let Ok(Message::Text(texto)) = msg_res {
                        if let Ok(val) = serde_json::from_str::<Value>(&texto) {
                            if val.get("id").and_then(|i| i.as_u64()) == Some(id) {
                                if let Some(err) = val.get("error") {
                                    return Err(anyhow!("CDP Error: {:?}", err));
                                }
                                return Ok(val.get("result").cloned().unwrap_or(json!({})));
                            }
                        }
                    }
                }
                _ = timeout.tick() => {
                    intentos += 1;
                }
            }
        }

        Err(anyhow!("Timeout esperando respuesta CDP para id {}", id))
    }

    /// Evalúa una expresión de JavaScript en el contexto de la página activa.
    pub async fn evaluar_js(&mut self, expresion: &str) -> Result<Value> {
        let res = self.enviar_comando("Runtime.evaluate", json!({
            "expression": expresion,
            "returnByValue": true,
            "awaitPromise": true
        })).await?;

        if let Some(resultado) = res.get("result") {
            if let Some(val) = resultado.get("value") {
                return Ok(val.clone());
            }
        }
        Ok(json!(null))
    }

    /// Navega la pestaña actual a una URL específica y espera la carga.
    #[allow(dead_code)]
    pub async fn navegar(&mut self, url: &str) -> Result<()> {
        let _ = self.enviar_comando("Page.navigate", json!({ "url": url })).await?;
        tokio::time::sleep(Duration::from_millis(3000)).await;
        Ok(())
    }

    /// Simula scroll humano enviando eventos nativos de rueda del ratón (WheelEvent) y scrollBy suave.
    pub async fn simular_scroll_humano(&mut self, distancia: i32) -> Result<()> {
        // 1. Evento nativo de rueda del ratón (dispara oyentes pasivos de React en Facebook)
        let _ = self.enviar_comando("Input.dispatchMouseEvent", json!({
            "type": "mouseWheel",
            "x": 600,
            "y": 400,
            "deltaX": 0,
            "deltaY": distancia
        })).await;

        // 2. Scroll JS suave complementario
        let js = format!("window.scrollBy({{top: {}, behavior: 'smooth'}})", distancia);
        let _ = self.evaluar_js(&js).await;

        Ok(())
    }

    /// Extrae enlaces de video del DOM de Facebook limpiando parámetros de rastreo y normalizando URLs.
    pub async fn extraer_enlaces_facebook(&mut self) -> Result<Vec<String>> {
        let val = self.evaluar_js(super::scripts::SCRIPT_EXTRACCION_DOM).await?;
        if let Some(arr) = val.as_array() {
            let urls: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            return Ok(urls);
        }

        Ok(Vec::new())
    }

    /// Obtiene todas las cookies de sesión de Facebook mediante el protocolo CDP nativo.
    pub async fn obtener_cookies_facebook(&mut self) -> Result<Vec<Value>> {
        let res = self.enviar_comando("Network.getCookies", json!({
            "urls": ["https://www.facebook.com", "https://web.facebook.com"]
        })).await?;

        if let Some(cookies) = res.get("cookies").and_then(|c| c.as_array()) {
            return Ok(cookies.clone());
        }

        Ok(Vec::new())
    }

    /// Guarda las cookies capturadas en formato JSON y Netscape cookies.txt para yt-dlp.
    pub async fn guardar_cookies(
        &mut self,
        ruta_json: &Path,
        ruta_netscape: &Path,
    ) -> Result<Option<String>> {
        let cookies = self.obtener_cookies_facebook().await?;
        super::proceso_limpieza::guardar_cookies_archivos(&cookies, ruta_json, ruta_netscape).await
    }

    /// Cierra el navegador de forma suave enviando Browser.close a través de CDP,
    /// permitiendo que Chromium guarde cookies, SQLite y perfiles ordenadamente sin cierres bruscos.
    pub async fn cerrar_suave(mut self) {
        let pid = self.proceso_chrome.as_ref().and_then(|c| c.id());
        let _ = self.enviar_comando("Browser.close", json!({})).await;
        let _ = self.ws_stream.close(None).await;
        if let Some(mut child) = self.proceso_chrome.take() {
            let wait_res = tokio::time::timeout(Duration::from_millis(2500), child.wait()).await;
            if wait_res.is_err() {
                if let Some(p) = pid {
                    super::proceso_limpieza::matar_arbol_proceso(p);
                } else {
                    let _ = child.kill().await;
                }
            }
        }
        if let Some(p) = pid {
            super::proceso_limpieza::matar_arbol_proceso(p);
        }
    }

    /// Cierra el WebSocket y finaliza el navegador y todos sus subprocesos ordenadamente.
    pub async fn cerrar(mut self) {
        let pid = self.proceso_chrome.as_ref().and_then(|c| c.id());
        let _ = self.ws_stream.close(None).await;
        if let Some(mut child) = self.proceso_chrome.take() {
            if let Some(p) = pid {
                super::proceso_limpieza::matar_arbol_proceso(p);
            } else {
                let _ = child.kill().await;
            }
        }
    }
}

