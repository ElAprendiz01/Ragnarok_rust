use std::collections::HashSet;
use std::path::{Path, PathBuf};
use anyhow::Result;
use regex::Regex;

pub struct GestorExtraccion {
    pub ruta_fuentes: PathBuf,
    pub ruta_pendientes: PathBuf,
    pub ruta_completados: PathBuf,
    pub ruta_historial: PathBuf,
    pub ruta_errores: PathBuf,
    pub ruta_cookies_json: PathBuf,
    pub ruta_cookies_netscape: PathBuf,
}

impl GestorExtraccion {
    pub fn new(ruta_base: &Path) -> Self {
        let (dp, cfg) = (ruta_base.join("datos_persistencia"), ruta_base.join("config"));
        Self {
            ruta_fuentes: dp.join("fuentes_url.txt"),
            ruta_pendientes: dp.join("cola_pendientes.txt"),
            ruta_completados: dp.join("enlaces_completados.txt"),
            ruta_historial: dp.join("historial_global_enlaces.txt"),
            ruta_errores: dp.join("registro_errores.txt"),
            ruta_cookies_json: cfg.join("cookies_facebook.json"),
            ruta_cookies_netscape: cfg.join("cookies_facebook_netscape.txt"),
        }
    }

    /// Inicializa todos los archivos de memoria y persistencia si no existen en disco.
    pub fn inicializar_archivos_si_no_existen(&self) -> Result<()> {
        for f in [&self.ruta_fuentes, &self.ruta_pendientes, &self.ruta_completados, &self.ruta_historial, &self.ruta_errores] {
            if let Some(parent) = f.parent() { std::fs::create_dir_all(parent)?; }
            if !f.exists() { std::fs::write(f, "")?; }
        }
        Ok(())
    }

    /// Convierte las cookies JSON a Netscape format o utiliza el archivo de cookies existente.
    pub fn asegurar_cookies_netscape(&self) -> Result<Option<PathBuf>> {
        if self.ruta_cookies_json.exists() {
            if let Ok(c) = std::fs::read_to_string(&self.ruta_cookies_json) {
                if let Ok(cookies) = serde_json::from_str::<Vec<serde_json::Value>>(&c) {
                    let (salida, _) = super::scripts::convertir_cookies_a_netscape(&cookies);
                    let _ = std::fs::write(&self.ruta_cookies_netscape, salida);
                    return Ok(Some(self.ruta_cookies_netscape.clone()));
                }
            }
        }
        if self.ruta_cookies_netscape.exists() && std::fs::metadata(&self.ruta_cookies_netscape).map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(Some(self.ruta_cookies_netscape.clone()));
        }
        Ok(None)
    }

    pub fn generar_id_video(url: &str) -> String {
        let limpia = Self::normalizar_url_facebook(url);
        let digest = md5::compute(limpia.as_bytes());
        format!("{:x}", digest)[..16].to_string()
    }

    /// Extrae el ID numérico único de un video de Facebook desde cualquier formato de URL.
    pub fn extraer_id_numerico_facebook(url: &str) -> Option<String> {
        let limpia = url.trim();
        for patron in [r"[?&]v=(\d+)", r"/reels?/(\d+)", r"/videos?/(\d+)"] {
            if let Ok(re) = Regex::new(patron) {
                if let Some(c) = re.captures(limpia) {
                    return Some(c[1].to_string());
                }
            }
        }
        None
    }

    /// Normaliza URLs de Facebook unificándolas al formato canónico estándar.
    pub fn normalizar_url_facebook(url: &str) -> String {
        let limpia = url.trim();
        if limpia.is_empty() { return String::new(); }
        if let Some(id_num) = Self::extraer_id_numerico_facebook(limpia) {
            return format!("https://www.facebook.com/watch/?v={}", id_num);
        }
        if let Ok(re_share) = Regex::new(r"/share/[vr]/([A-Za-z0-9_-]+)") {
            if let Some(caps) = re_share.captures(limpia) {
                return format!("https://www.facebook.com/share/v/{}/", &caps[1]);
            }
        }
        if let Ok(re_fbwatch) = Regex::new(r"fb\.watch/([A-Za-z0-9_-]+)") {
            if let Some(caps) = re_fbwatch.captures(limpia) {
                return format!("https://fb.watch/{}/", &caps[1]);
            }
        }
        limpia.split('?').next().unwrap_or(limpia).to_string()
    }

    pub fn cargar_fuentes(&self) -> Result<Vec<String>> {
        if !self.ruta_fuentes.exists() { return Ok(Vec::new()); }
        let urls = std::fs::read_to_string(&self.ruta_fuentes)?
            .lines()
            .map(|l| l.split(" ||| ").next().unwrap_or(l).trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect();
        Ok(urls)
    }

    pub fn cargar_pendientes(&self) -> Result<Vec<String>> {
        if !self.ruta_pendientes.exists() { return Ok(Vec::new()); }
        let (mut vistas, mut urls) = (HashSet::new(), Vec::new());
        for l in std::fs::read_to_string(&self.ruta_pendientes)?.lines() {
            let t = l.trim();
            if t.is_empty() || t.starts_with('#') { continue; }
            let norm = Self::normalizar_url_facebook(t);
            let clave = Self::extraer_id_numerico_facebook(&norm).unwrap_or_else(|| norm.clone());
            if vistas.insert(clave) { urls.push(norm); }
        }
        Ok(urls)
    }

    pub fn cargar_completados(&self) -> Result<HashSet<String>> {
        if !self.ruta_completados.exists() { return Ok(HashSet::new()); }
        let mut set = HashSet::new();
        for l in std::fs::read_to_string(&self.ruta_completados)?.lines() {
            let t = l.trim();
            if t.is_empty() { continue; }
            let partes: Vec<&str> = t.split(" | ").collect();
            let (id, url) = if partes.len() >= 2 { (Some(partes[0].trim()), partes[1].trim()) } else { (None, t) };
            if let Some(i) = id { set.insert(i.to_string()); }
            set.insert(url.to_string());
            let norm = Self::normalizar_url_facebook(url);
            if !norm.is_empty() { set.insert(norm); }
            if let Some(num) = Self::extraer_id_numerico_facebook(url) { set.insert(num); }
        }
        Ok(set)
    }

    pub fn cargar_historial(&self) -> Result<HashSet<String>> {
        if !self.ruta_historial.exists() { return Ok(HashSet::new()); }
        let mut set = HashSet::new();
        for l in std::fs::read_to_string(&self.ruta_historial)?.lines() {
            let t = l.trim();
            if t.is_empty() { continue; }
            set.insert(t.to_string());
            let norm = Self::normalizar_url_facebook(t);
            if !norm.is_empty() { set.insert(norm); }
            if let Some(num) = Self::extraer_id_numerico_facebook(t) { set.insert(num); }
        }
        Ok(set)
    }

    pub fn existe_en_historial(&self, url: &str) -> bool {
        let norm = Self::normalizar_url_facebook(url);
        let id_hash = Self::generar_id_video(url);
        let num_id = Self::extraer_id_numerico_facebook(url);
        if let Ok(hist) = self.cargar_historial() {
            hist.contains(url) || hist.contains(&norm) || hist.contains(&id_hash)
                || num_id.map(|id| hist.contains(&id)).unwrap_or(false)
        } else { false }
    }

    pub fn existe_en_completados(&self, url: &str) -> bool {
        let norm = Self::normalizar_url_facebook(url);
        let id_hash = Self::generar_id_video(url);
        let num_id = Self::extraer_id_numerico_facebook(url);
        if let Ok(comp) = self.cargar_completados() {
            comp.contains(url) || comp.contains(&norm) || comp.contains(&id_hash)
                || num_id.map(|id| comp.contains(&id)).unwrap_or(false)
        } else { false }
    }

    pub fn existe_en_disco(&self, dir_descargas: &Path, url: &str) -> bool {
        let norm = Self::normalizar_url_facebook(url);
        let id_hash = Self::generar_id_video(&norm);
        let p_mp4 = dir_descargas.join(&id_hash).join("video_original.mp4");
        if p_mp4.exists() && std::fs::metadata(&p_mp4).map(|m| m.len() > 1024).unwrap_or(false) {
            return true;
        }
        if let Some(num_id) = Self::extraer_id_numerico_facebook(&norm) {
            if dir_descargas.join(&num_id).join("video_original.mp4").exists() { return true; }
            if let Ok(entries) = std::fs::read_dir(dir_descargas) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.is_dir() && p.join("video_original.mp4").exists() {
                        if let Ok(c) = std::fs::read_to_string(p.join("metadata.json")) {
                            if c.contains(&num_id) { return true; }
                        }
                    }
                }
            }
        }
        false
    }

    pub fn registrar_completado(&self, id_video: &str, url: &str) -> Result<()> {
        use std::io::Write;
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.ruta_completados)?;
        writeln!(f, "{} | {} | {}", id_video, url, ts)?;
        Ok(())
    }

    pub fn registrar_en_historial(&self, url: &str) -> Result<()> {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.ruta_historial)?;
        writeln!(f, "{}", Self::normalizar_url_facebook(url))?;
        Ok(())
    }

    pub fn registrar_error(&self, url: &str, mod_: &str, cod: &str, det: &str) -> Result<()> {
        use std::io::Write;
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.ruta_errores)?;
        writeln!(f, "[{}] | {} | {} | {} | {}", ts, mod_, url, cod, det)?;
        Ok(())
    }

    pub fn encolar_pendiente(&self, url: &str) -> Result<bool> {
        let norm = Self::normalizar_url_facebook(url);
        if norm.is_empty() || self.existe_en_historial(&norm) || self.existe_en_completados(&norm) {
            return Ok(false);
        }
        let dir_desc = self.ruta_pendientes.parent().and_then(|p| p.parent()).unwrap_or(Path::new(".")).join("descargas");
        if self.existe_en_disco(&dir_desc, &norm) { return Ok(false); }

        let pendientes = self.cargar_pendientes().unwrap_or_default();
        let num_id = Self::extraer_id_numerico_facebook(&norm);
        for p in &pendientes {
            if p == &norm || (num_id.is_some() && num_id == Self::extraer_id_numerico_facebook(p)) {
                return Ok(false);
            }
        }
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.ruta_pendientes)?;
        writeln!(f, "{}", norm)?;
        Ok(true)
    }

    pub fn remover_de_pendientes(&self, url: &str) -> Result<()> {
        let norm = Self::normalizar_url_facebook(url);
        let num_id = Self::extraer_id_numerico_facebook(url);
        let pendientes = self.cargar_pendientes()?;
        let filtrados: Vec<String> = pendientes.into_iter()
            .filter(|u| u != url && u != &norm && !(num_id.is_some() && num_id == Self::extraer_id_numerico_facebook(u)))
            .collect();
        std::fs::write(&self.ruta_pendientes, filtrados.join("\n") + if filtrados.is_empty() { "" } else { "\n" })?;
        Ok(())
    }
}
