use std::path::Path;
use anyhow::Result;
use std::pin::Pin;
use std::future::Future;

/// Trait unificado para adaptadores de plataformas de publicación (Solución RIESGO-06).
/// Desacopla la orquestación de subida de las APIs específicas de cada red social.
#[allow(dead_code)]
pub trait PublicadorPlataforma: Send + Sync {
    /// Identificador canónico de la red (ej: "telegram", "facebook", "youtube", "tiktok").
    fn identificador(&self) -> &'static str;

    /// Comprueba si la plataforma posee sesión válida o token vigente.
    fn esta_autenticado(&self) -> bool;

    /// Ejecuta la publicación de un archivo de video con sus metadatos.
    fn publicar<'a>(
        &'a self,
        ruta_video: &'a Path,
        titulo: &'a str,
        descripcion: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String>> + Send + 'a>>;
}
