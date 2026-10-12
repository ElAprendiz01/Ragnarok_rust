mod api;
mod config;
mod crawler;
pub mod downloader;
mod editor;
mod models;
mod publisher;
mod state;
mod storage;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use axum::{
    routing::get,
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

use state::AppState;

pub fn resolver_ui_path(ruta_base: &Path) -> PathBuf {
    let candidatas = [
        PathBuf::from("ui"),
        ruta_base.join("rust_Ragnarok").join("ui"),
        ruta_base.join("ui"),
        ruta_base.join("interfaz"),
        PathBuf::from("../rust_Ragnarok/ui"),
    ];
    for c in &candidatas {
        if c.exists() && c.join("estilos_panel.css").exists() {
            return c.clone();
        }
    }
    PathBuf::from("ui")
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Configurar suscriptor de logs en consola
    tracing_subscriber::fmt()
        .with_env_filter("ragnarok=info,tower_http=info")
        .init();

    // Raíz del proyecto: Detecta si se ejecuta desde subcarpeta rust_Ragnarok o desde la raíz
    let ruta_actual = std::env::current_dir()?;
    let ruta_base = if ruta_actual.join("..").join("config").join("parametros_globales.json").exists() {
        ruta_actual.parent().unwrap_or(&ruta_actual).to_path_buf()
    } else {
        ruta_actual
    };

    let config_mgr = config::ConfigManager::new(&ruta_base);
    let cfg = config_mgr.cargar().unwrap_or_default();

    let ui_path = resolver_ui_path(&ruta_base);
    let state = AppState::new(ruta_base.clone(), cfg);

    // Inicializar verificación asíncrona de sesión Telegram (no bloqueante)
    let state_tg = state.clone();
    tokio::spawn(async move {
        api::telegram_auth::verificar_autorizacion_inicial(state_tg).await;
    });

    // Construir Router Modular con servicios de archivos estáticos de alto rendimiento (ServeFile/ServeDir)
    let api_router = api::crear_router(state.clone());
    let app = Router::new()
        .route_service("/", ServeFile::new(ui_path.join("panel_control.html")))
        .route_service("/estilos_panel.css", ServeFile::new(ui_path.join("estilos_panel.css")))
        .route_service("/logica_panel.js", ServeFile::new(ui_path.join("logica_panel.js")))
        .route("/favicon.ico", get(|| async { axum::http::StatusCode::NO_CONTENT }))
        .nest_service("/iconos", ServeDir::new(ui_path.join("iconos")))
        .nest_service("/js", ServeDir::new(ui_path.join("js")))
        .nest_service("/componentes", ServeDir::new(ui_path.join("componentes")))
        .merge(api_router)
        .fallback_service(ServeDir::new(&ui_path))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], 5757));
    info!("============================================================");
    info!("  Ragnarok — Servidor Principal");
    info!("  Panel de Control Web: http://{}", addr);
    info!("  Directorio base: {:?}", state.ruta_base);
    info!("  Directorio UI: {:?}", ui_path);
    info!("  Sistema Ultra Optimizado | Arquitectura Nativa | <30 MB RAM");
    info!("============================================================");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

