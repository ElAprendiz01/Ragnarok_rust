use std::sync::Arc;
use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::crawler::GestorExtraccion;
use crate::state::AppState;

fn decodificar_url(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.bytes().peekable();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                if let (Some(d1), Some(d2)) = (to_hex_digit(c1), to_hex_digit(c2)) {
                    bytes.push((d1 << 4) | d2);
                    continue;
                }
            }
        } else if b == b'+' {
            bytes.push(b' ');
            continue;
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn to_hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
pub struct AgregarPendientePayload {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct EliminarPendientePayload {
    pub url: Option<String>,
}

pub async fn listar_pendientes(State(state): State<Arc<AppState>>) -> Json<Value> {
    let gestor = GestorExtraccion::new(&state.ruta_base);
    let pendientes = gestor.cargar_pendientes().unwrap_or_default();

    Json(json!({
        "ok": true,
        "pendientes": pendientes,
        "total": pendientes.len()
    }))
}

pub async fn agregar_pendiente(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AgregarPendientePayload>,
) -> Json<Value> {
    let mut url = payload.url.trim().to_string();

    if url.is_empty() {
        return Json(json!({"ok": false, "error": "URL vacía."}));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{}", url);
    }

    let gestor = GestorExtraccion::new(&state.ruta_base);
    let _ = gestor.inicializar_archivos_si_no_existen();

    let norm = GestorExtraccion::normalizar_url_facebook(&url);
    let final_url = if norm.is_empty() { url } else { norm };

    if gestor.existe_en_completados(&final_url) {
        return Json(json!({
            "ok": false,
            "error": "Este enlace ya fue descargado previamente (registrado en completados).",
            "url": final_url
        }));
    }

    if gestor.existe_en_disco(&state.ruta_base.join("descargas"), &final_url) {
        return Json(json!({
            "ok": false,
            "error": "Este video ya existe físicamente en el disco local.",
            "url": final_url
        }));
    }

    match gestor.encolar_pendiente(&final_url) {
        Ok(true) => {
            state.emitir_log("OK", &format!("Enlace agregado a cola de pendientes: {}", final_url)).await;
            Json(json!({
                "ok": true,
                "mensaje": "Enlace agregado a la cola de pendientes.",
                "url": final_url
            }))
        }
        Ok(false) => {
            Json(json!({
                "ok": false,
                "error": "El enlace ya se encuentra en la cola de pendientes o en el historial.",
                "url": final_url
            }))
        }
        Err(e) => {
            Json(json!({"ok": false, "error": format!("Error al escribir en cola: {}", e)}))
        }
    }
}

pub async fn eliminar_pendiente_path(
    Path(url_enc): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let url = decodificar_url(&url_enc);
    eliminar_pendiente_interno(state, &url).await
}

pub async fn eliminar_pendiente_json(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<EliminarPendientePayload>,
) -> Json<Value> {
    if let Some(url) = payload.url {
        eliminar_pendiente_interno(state, &url).await
    } else {
        Json(json!({"ok": false, "error": "URL no proporcionada."}))
    }
}

async fn eliminar_pendiente_interno(state: Arc<AppState>, url_target: &str) -> Json<Value> {
    let gestor = GestorExtraccion::new(&state.ruta_base);
    let url_limpia = url_target.trim();

    match gestor.remover_de_pendientes(url_limpia) {
        Ok(_) => {
            state.emitir_log("WARN", &format!("Enlace removido de cola: {}", url_limpia)).await;
            Json(json!({"ok": true, "mensaje": "Enlace eliminado de la cola."}))
        }
        Err(e) => {
            Json(json!({"ok": false, "error": format!("Error al remover de la cola: {}", e)}))
        }
    }
}
