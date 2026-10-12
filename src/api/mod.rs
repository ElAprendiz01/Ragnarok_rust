pub mod auth;
pub mod configuracion;
pub mod events;
pub mod fuentes;
pub mod fuentes_clasificador;
pub mod pendientes;
pub mod pipeline;
pub mod publicacion;
pub mod publicacion_individual;
pub mod publicacion_lote;
pub mod telegram_auth;
pub mod videos;

use std::sync::Arc;
use axum::{
    routing::{delete, get, post},
    Router,
};
use tower_http::services::ServeDir;

use crate::state::AppState;

pub fn crear_router(state: Arc<AppState>) -> Router {
    let ui_path = if state.ruta_base.join("rust_Ragnarok").join("ui").exists() {
        state.ruta_base.join("rust_Ragnarok").join("ui")
    } else if state.ruta_base.join("ui").exists() {
        state.ruta_base.join("ui")
    } else {
        state.ruta_base.join("interfaz")
    };
    let descargas_path = state.ruta_base.join("descargas");
    let procesados_path = state.ruta_base.join("procesados");

    Router::new()
        // 1. Pipeline y Estados
        .route("/estado", get(pipeline::obtener_estado))
        .route("/ejecutar/descargar", post(pipeline::ejecutar_descarga_solo))
        .route("/ejecutar/fase/:fase", post(pipeline::ejecutar_fase))
        .route("/ejecutar/:fase", post(pipeline::ejecutar_fase))
        .route("/detener/:fase", post(pipeline::detener_fase))
        .route("/eventos", get(events::sse_handler))

        // 2. Videos y Streaming Parcial HTTP 206
        .route("/api/videos", get(videos::listar_videos))
        .route("/api/videos/recortar", post(videos::recortar_video))
        .route("/api/videos/:id", delete(videos::eliminar_video))
        .route("/api/videos/:id/metadata", post(videos::actualizar_metadata))

        // 3. Fuentes URL (Listar, Agregar, Alternar estado, Eliminar)
        .route("/fuentes", get(fuentes::listar_fuentes).post(fuentes::agregar_fuente).delete(fuentes::eliminar_fuente_json))
        .route("/fuentes/toggle", post(fuentes::toggle_fuente))
        .route("/fuentes/:url", delete(fuentes::eliminar_fuente_path))

        // 3.1 Cola de Enlaces Pendientes (Listar, Agregar, Eliminar)
        .route("/pendientes", get(pendientes::listar_pendientes).post(pendientes::agregar_pendiente).delete(pendientes::eliminar_pendiente_json))
        .route("/pendientes/:url", delete(pendientes::eliminar_pendiente_path))

        // 4. Configuración
        .route("/config", get(configuracion::obtener_config).post(configuracion::guardar_config))
        .route("/api/configuracion", get(configuracion::obtener_config).post(configuracion::guardar_config))

        // 5. Publicación Lote y Telegram MTProto
        .route("/api/publicar/lote/estado", get(publicacion::estado_lote_telegram))
        .route("/api/publicar/lote/telegram", post(publicacion::ejecutar_lote_telegram))
        .route("/api/publicar/lote/detener", post(publicacion::detener_lote_telegram))
        .route("/api/publicar/individual", post(publicacion::publicar_individual))
        .route("/ejecutar/publicar/:plat", post(publicacion::publicar_individual))

        // 5.1 Autenticación Telegram MTProto en Vivo desde la Interfaz Web
        .route("/api/telegram/estado_sesion", get(telegram_auth::estado_sesion))
        .route("/api/telegram/solicitar_codigo", post(telegram_auth::solicitar_codigo))
        .route("/api/telegram/confirmar_codigo", post(telegram_auth::confirmar_codigo))
        .route("/api/telegram/confirmar_password", post(telegram_auth::confirmar_password))
        .route("/api/telegram/desvincular", post(telegram_auth::desvincular_sesion))
        .route("/auth/telegram", post(telegram_auth::solicitar_codigo))

        // 5.2 Autenticación Facebook Asistida
        .route("/api/facebook/login", post(auth::iniciar_sesion_facebook))
        .route("/api/facebook/iniciar_sesion", post(auth::iniciar_sesion_facebook))
        .route("/api/facebook/capturar_sesion", post(auth::capturar_sesion_facebook))
        .route("/api/facebook/cerrar_navegador", post(auth::cerrar_navegador_facebook))
        .route("/api/facebook/estado_navegador", get(auth::estado_navegador_facebook))
        .route("/api/facebook/guardar_cookies", post(auth::guardar_cookies_facebook))
        .route("/auth/facebook", post(auth::iniciar_sesion_facebook))

        // 6. Autenticación y Cookies
        .route("/api/cookies", get(auth::estado_cookies))

        // 7. Servicios de Archivos (UI estática y Streaming de Videos con HTTP 206 nativo)
        .nest_service("/media/descargas", ServeDir::new(descargas_path))
        .nest_service("/media/procesados", ServeDir::new(procesados_path))
        .nest_service("/interfaz", ServeDir::new(&ui_path))
        .nest_service("/ui", ServeDir::new(&ui_path))
        .with_state(state)
}
