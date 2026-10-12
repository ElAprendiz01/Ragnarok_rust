use std::collections::HashSet;
use std::path::{Path, PathBuf};
use anyhow::Result;

#[allow(dead_code)]
pub struct GestorAuditoriaPublicaciones {
    ruta_estado_txt: PathBuf,
    ruta_cola_tg: PathBuf,
}

#[allow(dead_code)]
impl GestorAuditoriaPublicaciones {
    pub fn new(ruta_persistencia: &Path) -> Self {
        Self {
            ruta_estado_txt: ruta_persistencia.join("estado_publicaciones.txt"),
            ruta_cola_tg: ruta_persistencia.join("cola_publicacion_telegram.json"),
        }
    }

    /// Retorna el conjunto consolidado de IDs publicados en la plataforma especificada.
    pub fn obtener_ids_publicados(&self, plataforma: &str) -> HashSet<String> {
        let mut completados = HashSet::new();
        let plat_clean = plataforma.trim().to_lowercase();

        // 1. Consultar estado_publicaciones.txt
        if self.ruta_estado_txt.exists() {
            if let Ok(contenido) = std::fs::read_to_string(&self.ruta_estado_txt) {
                for linea in contenido.lines() {
                    let partes: Vec<&str> = linea.split('|').map(|s| s.trim()).collect();
                    if partes.len() >= 3 {
                        let clip_id = partes[0];
                        let plat = partes[1].to_lowercase();
                        let estado = partes[2].to_uppercase();

                        if plat == plat_clean && estado == "OK" {
                            let id_raiz = clip_id.split('_').next().unwrap_or(clip_id);
                            if !id_raiz.is_empty() {
                                completados.insert(id_raiz.to_string());
                            }
                        }
                    }
                }
            }
        }

        completados
    }

    /// Registra en disco la publicación confirmada: CLIP_ID | PLATAFORMA | OK | YYYY-MM-DD HH:MM:SS
    pub fn marcar_plataforma_completada(&self, clip_id: &str, plataforma: &str) -> Result<()> {
        use std::io::Write;
        let estampa = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let linea = format!("{} | {} | OK | {}\n", clip_id, plataforma, estampa);

        if let Some(parent) = self.ruta_estado_txt.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.ruta_estado_txt)?;
        file.write_all(linea.as_bytes())?;
        Ok(())
    }
}
