use std::sync::Arc;
use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[allow(unused_imports)]
pub use super::fuentes_clasificador::{clasificar_url_facebook, decodificar_url, InfoFuente, SEPARADOR};

#[derive(Debug, Deserialize)]
pub struct AgregarFuentePayload {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct ToggleFuentePayload {
    pub url: String,
    pub activa: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct EliminarFuentePayload {
    pub url: Option<String>,
}

pub async fn listar_fuentes(State(state): State<Arc<AppState>>) -> Json<Value> {
    let ruta_fuentes = state.ruta_base.join("datos_persistencia").join("fuentes_url.txt");
    let mut fuentes = Vec::new();

    if ruta_fuentes.exists() {
        if let Ok(contenido) = tokio::fs::read_to_string(&ruta_fuentes).await {
            for (idx, linea) in contenido.lines().enumerate() {
                let limpia = linea.trim();
                if limpia.is_empty() {
                    continue;
                }
                let activa_linea = !limpia.starts_with('#');
                let contenido_linea = if activa_linea { limpia } else { limpia.trim_start_matches('#').trim() };

                let partes: Vec<&str> = contenido_linea.split(SEPARADOR).collect();
                if partes.len() >= 3 {
                    let url_orig = partes[0].trim();
                    let tipo = partes[1].trim();
                    let url_scroll = partes[2].trim();
                    let activa = if activa_linea {
                        partes.get(3).map(|s| s.trim().eq_ignore_ascii_case("true")).unwrap_or(true)
                    } else {
                        false
                    };
                    let agregada = partes.get(4).map(|s| s.trim()).unwrap_or("");
                    let desc = clasificar_url_facebook(url_orig).descripcion;

                    fuentes.push(json!({
                        "id": idx,
                        "url_original": url_orig,
                        "tipo": tipo,
                        "descripcion": desc,
                        "url_scroll": url_scroll,
                        "activa": activa,
                        "agregada": agregada
                    }));
                } else {
                    let url_orig = contenido_linea;
                    let info = clasificar_url_facebook(url_orig);
                    fuentes.push(json!({
                        "id": idx,
                        "url_original": url_orig,
                        "tipo": info.tipo,
                        "descripcion": info.descripcion,
                        "url_scroll": info.url_scroll,
                        "activa": activa_linea,
                        "agregada": ""
                    }));
                }
            }
        }
    }

    Json(json!({
        "ok": true,
        "fuentes": fuentes,
        "total": fuentes.len()
    }))
}

pub async fn agregar_fuente(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AgregarFuentePayload>,
) -> Json<Value> {
    let ruta_fuentes = state.ruta_base.join("datos_persistencia").join("fuentes_url.txt");
    let mut url = payload.url.trim().to_string();

    if url.is_empty() {
        return Json(json!({"ok": false, "error": "URL vacía."}));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{}", url);
    }

    let info = clasificar_url_facebook(&url);
    let fecha = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let linea_guardar = format!(
        "{}{}{}{}{}{}{}{}{}\n",
        url, SEPARADOR, info.tipo, SEPARADOR, info.url_scroll, SEPARADOR, "True", SEPARADOR, fecha
    );

    let _ = std::fs::create_dir_all(state.ruta_base.join("datos_persistencia"));
    use tokio::io::AsyncWriteExt;
    if let Ok(mut archivo) = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ruta_fuentes)
        .await
    {
        let _ = archivo.write_all(linea_guardar.as_bytes()).await;
        state.emitir_log("OK", &format!("Fuente agregada: {} ({})", url, info.descripcion)).await;
        Json(json!({
            "ok": true,
            "mensaje": "Fuente agregada con éxito.",
            "fuente": {
                "url_original": url,
                "tipo": info.tipo,
                "descripcion": info.descripcion,
                "url_scroll": info.url_scroll,
                "activa": true,
                "agregada": fecha
            }
        }))
    } else {
        Json(json!({"ok": false, "error": "No se pudo escribir en fuentes_url.txt."}))
    }
}

pub async fn toggle_fuente(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ToggleFuentePayload>,
) -> Json<Value> {
    let ruta_fuentes = state.ruta_base.join("datos_persistencia").join("fuentes_url.txt");
    let url_target = payload.url.trim();

    if !ruta_fuentes.exists() {
        return Json(json!({"ok": false, "error": "Archivo fuentes_url.txt no existe."}));
    }

    if let Ok(contenido) = tokio::fs::read_to_string(&ruta_fuentes).await {
        let mut nuevas_lineas = Vec::new();
        let mut modificado = false;

        for linea in contenido.lines() {
            let limpia = linea.trim();
            if limpia.is_empty() {
                continue;
            }
            if limpia.contains(url_target) {
                let nuevo_estado = payload.activa.unwrap_or(limpia.starts_with('#'));
                let mut partes: Vec<String> = limpia.trim_start_matches('#').trim().split(SEPARADOR).map(|s| s.to_string()).collect();
                if partes.len() >= 4 {
                    partes[3] = if nuevo_estado { "True".to_string() } else { "False".to_string() };
                    let l = partes.join(SEPARADOR);
                    nuevas_lineas.push(if nuevo_estado { l } else { format!("# {}", l) });
                } else {
                    let base = partes.join(SEPARADOR);
                    nuevas_lineas.push(if nuevo_estado { base } else { format!("# {}", base) });
                }
                modificado = true;
            } else {
                nuevas_lineas.push(limpia.to_string());
            }
        }

        if modificado {
            let nuevo_contenido = nuevas_lineas.join("\n") + "\n";
            let _ = tokio::fs::write(&ruta_fuentes, nuevo_contenido).await;
            state.emitir_log("OK", &format!("Fuente actualizada: {}", url_target)).await;
            return Json(json!({"ok": true, "mensaje": "Estado de fuente actualizado."}));
        }
    }

    Json(json!({"ok": false, "error": "Fuente no encontrada."}))
}

pub async fn eliminar_fuente_path(
    Path(url_enc): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let url = decodificar_url(&url_enc);
    eliminar_fuente_interno(state, &url).await
}

pub async fn eliminar_fuente_json(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<EliminarFuentePayload>,
) -> Json<Value> {
    if let Some(url) = payload.url {
        eliminar_fuente_interno(state, &url).await
    } else {
        Json(json!({"ok": false, "error": "URL no proporcionada."}))
    }
}

async fn eliminar_fuente_interno(state: Arc<AppState>, url_target: &str) -> Json<Value> {
    let ruta_fuentes = state.ruta_base.join("datos_persistencia").join("fuentes_url.txt");

    if !ruta_fuentes.exists() {
        return Json(json!({"ok": false, "error": "Archivo no existe."}));
    }

    if let Ok(contenido) = tokio::fs::read_to_string(&ruta_fuentes).await {
        let mut nuevas_lineas = Vec::new();
        let mut eliminado = false;
        let url_limpia = url_target.trim();

        for linea in contenido.lines() {
            let limpia = linea.trim();
            if limpia.is_empty() {
                continue;
            }
            if limpia.contains(url_limpia) || url_limpia.contains(limpia.split(SEPARADOR).next().unwrap_or(limpia)) {
                eliminado = true;
            } else {
                nuevas_lineas.push(limpia.to_string());
            }
        }

        if eliminado {
            let nuevo_contenido = if nuevas_lineas.is_empty() {
                String::new()
            } else {
                nuevas_lineas.join("\n") + "\n"
            };
            let _ = tokio::fs::write(&ruta_fuentes, nuevo_contenido).await;
            state.emitir_log("WARN", &format!("Fuente eliminada: {}", url_limpia)).await;
            return Json(json!({"ok": true, "mensaje": "Fuente eliminada."}));
        }
    }

    Json(json!({"ok": false, "error": "Fuente no encontrada."}))
}
