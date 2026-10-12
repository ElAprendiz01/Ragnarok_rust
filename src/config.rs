use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use crate::models::ParametrosGlobales;

pub struct ConfigManager {
    ruta_archivo: PathBuf,
}

impl ConfigManager {
    pub fn new(ruta_base: &Path) -> Self {
        Self {
            ruta_archivo: ruta_base.join("config").join("parametros_globales.json"),
        }
    }

    pub fn cargar(&self) -> Result<ParametrosGlobales> {
        if !self.ruta_archivo.exists() {
            anyhow::bail!("Archivo de configuración no encontrado en {:?}", self.ruta_archivo);
        }
        let contenido = std::fs::read_to_string(&self.ruta_archivo)
            .with_context(|| format!("Error leyendo {:?}", self.ruta_archivo))?;
        let mut config: ParametrosGlobales = serde_json::from_str(&contenido)
            .context("Error parseando JSON de configuración")?;

        if config.canales_telegram.is_none() || config.canales_telegram.as_ref().map(|v| v.is_empty()).unwrap_or(false) {
            config.canales_telegram = config.publicacion.canales_telegram.clone();
        } else if config.publicacion.canales_telegram.is_none() || config.publicacion.canales_telegram.as_ref().map(|v| v.is_empty()).unwrap_or(false) {
            config.publicacion.canales_telegram = config.canales_telegram.clone();
        }

        if config.canal_telegram.is_none() {
            config.canal_telegram = config.publicacion.canal_telegram.clone();
        } else if config.publicacion.canal_telegram.is_none() {
            config.publicacion.canal_telegram = config.canal_telegram.clone();
        }

        Ok(config)
    }

    #[allow(dead_code)]
    pub fn guardar(&self, config: &ParametrosGlobales) -> Result<()> {
        if let Some(parent) = self.ruta_archivo.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(config)?;
        std::fs::write(&self.ruta_archivo, json)?;
        Ok(())
    }

    pub fn guardar_raw(&self, valor: &serde_json::Value) -> Result<()> {
        if let Some(parent) = self.ruta_archivo.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(valor)?;
        std::fs::write(&self.ruta_archivo, json)?;
        Ok(())
    }
}
