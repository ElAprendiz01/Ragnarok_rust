use std::sync::Arc;
use axum::{
    extract::State,
    response::Json,
};
use serde_json::{json, Value};

use crate::models::ParametrosGlobales;
use crate::state::AppState;
use crate::config::ConfigManager;

pub async fn obtener_config(State(state): State<Arc<AppState>>) -> Json<ParametrosGlobales> {
    let cfg = state.config.read().await;
    Json(cfg.clone())
}

pub async fn guardar_config(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let mgr = ConfigManager::new(&state.ruta_base);
    let ruta_json = state.ruta_base.join("config").join("parametros_globales.json");

    let mut base_val = if let Ok(contenido) = std::fs::read_to_string(&ruta_json) {
        serde_json::from_str::<Value>(&contenido).unwrap_or(json!({}))
    } else {
        json!({})
    };

    if let (Some(base_obj), Some(payload_obj)) = (base_val.as_object_mut(), payload.as_object()) {
        for (k, v) in payload_obj {
            if let (Some(sub_base), Some(sub_payload)) = (base_obj.get_mut(k).and_then(|v| v.as_object_mut()), v.as_object()) {
                for (sub_k, sub_v) in sub_payload {
                    sub_base.insert(sub_k.clone(), sub_v.clone());
                }
            } else {
                base_obj.insert(k.clone(), v.clone());
            }
        }
    }

    // Sincronizar canales entre root y publicacion
    if let Some(cs) = base_val.get("canales_telegram").cloned() {
        if let Some(pub_obj) = base_val.get_mut("publicacion").and_then(|v| v.as_object_mut()) {
            pub_obj.insert("canales_telegram".to_string(), cs.clone());
        }
    } else if let Some(cs) = base_val.get("publicacion").and_then(|p| p.get("canales_telegram")).cloned() {
        if let Some(b_obj) = base_val.as_object_mut() {
            b_obj.insert("canales_telegram".to_string(), cs);
        }
    }

    if let Some(c) = base_val.get("canal_telegram").cloned() {
        if let Some(pub_obj) = base_val.get_mut("publicacion").and_then(|v| v.as_object_mut()) {
            pub_obj.insert("canal_telegram".to_string(), c);
        }
    } else if let Some(c) = base_val.get("publicacion").and_then(|p| p.get("canal_telegram")).cloned() {
        if let Some(b_obj) = base_val.as_object_mut() {
            b_obj.insert("canal_telegram".to_string(), c);
        }
    }

    match mgr.guardar_raw(&base_val) {
        Ok(_) => {
            if let Ok(updated_cfg) = serde_json::from_value::<ParametrosGlobales>(base_val) {
                let mut cfg = state.config.write().await;
                *cfg = updated_cfg;
            }
            state.emitir_log("OK", "Configuración global actualizada en disco.").await;
            Json(json!({"ok": true, "mensaje": "Configuración guardada exitosamente."}))
        }
        Err(e) => {
            state.emitir_log("ERROR", &format!("Error guardando configuración: {}", e)).await;
            Json(json!({"ok": false, "error": e.to_string()}))
        }
    }
}
