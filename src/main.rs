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
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
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

    // Construir Router Modular con todas las rutas y servicios
    let api_router = api::crear_router(state.clone());
    let app = Router::new()
        .route("/", get(servir_index))
        .route("/estilos_panel.css", get(servir_css))
        .route("/logica_panel.js", get(servir_js))
        .route("/favicon.ico", get(|| async { axum::http::StatusCode::NO_CONTENT }))
        .nest_service("/iconos", ServeDir::new(ui_path.join("iconos")))
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

async fn servir_index() -> impl IntoResponse {
    let ruta_actual = std::env::current_dir().unwrap_or_default();
    let ui_path = resolver_ui_path(&ruta_actual);
    let ruta_html = ui_path.join("panel_control.html");

    if let Ok(contenido) = tokio::fs::read_to_string(&ruta_html).await {
        (
            [
                (axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (axum::http::header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
            ],
            contenido,
        ).into_response()
    } else {
        Html(format!("<h1>Error: panel_control.html no encontrado en {:?}</h1>", ruta_html)).into_response()
    }
}

async fn servir_css() -> impl IntoResponse {
    let ruta_actual = std::env::current_dir().unwrap_or_default();
    let ui_path = resolver_ui_path(&ruta_actual);
    let archivo = ui_path.join("estilos_panel.css");
    if let Ok(c) = tokio::fs::read_to_string(archivo).await {
        (
            [
                (axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8"),
                (axum::http::header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
            ],
            c,
        ).into_response()
    } else {
        axum::http::StatusCode::NOT_FOUND.into_response()
    }
}

async fn servir_js() -> impl IntoResponse {
    let ruta_actual = std::env::current_dir().unwrap_or_default();
    let ui_path = resolver_ui_path(&ruta_actual);
    let archivo = ui_path.join("logica_panel.js");
    if let Ok(c) = tokio::fs::read_to_string(archivo).await {
        (
            [
                (axum::http::header::CONTENT_TYPE, "application/javascript; charset=utf-8"),
                (axum::http::header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
            ],
            c,
        ).into_response()
    } else {
        axum::http::StatusCode::NOT_FOUND.into_response()
    }
}
