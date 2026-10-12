use std::path::{Path, PathBuf};
use anyhow::{anyhow, Result};

/// Detecta el ejecutable de Google Chrome o Microsoft Edge en Windows.
pub fn detectar_navegador() -> Result<PathBuf> {
    let posibles = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];

    for p in &posibles {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(anyhow!("No se encontró Google Chrome ni Microsoft Edge instalado en el sistema."))
}

/// Mata por completo el árbol de procesos en Windows (incluyendo crashpad, gpu y renderers).
/// En Windows, child.kill() solo mata el proceso raíz, dejando procesos hijos zombis.
/// Con `taskkill /F /T /PID`, Windows garantiza la eliminación recursiva total de todo el sub-árbol.
pub fn matar_arbol_proceso(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

/// Libera la carpeta de perfil de Chromium cerrando posibles instancias huérfanas
/// y eliminando los archivos residuales de bloqueo (lockfile y SingletonLock).
pub async fn liberar_bloqueos_perfil(ruta_base: &Path) {
    let perfil_dir = ruta_base.join("datos_persistencia").join("perfil_facebook_chromium");
    if !perfil_dir.exists() {
        return;
    }

    let lockfiles = [
        "lockfile",
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
    ];

    // 1. Verificación rápida sin costo de proceso: intentar eliminar lockfiles directamente
    let mut bloqueo_retenido = false;
    for lock_name in &lockfiles {
        let ruta_lock = perfil_dir.join(lock_name);
        if ruta_lock.exists() {
            if let Err(_) = tokio::fs::remove_file(&ruta_lock).await {
                // El archivo está retenido activamente por un proceso huérfano
                bloqueo_retenido = true;
            }
        }
    }

    // 2. Únicamente si los archivos estaban retenidos por un proceso zombi, invocar limpieza
    if bloqueo_retenido {
        #[cfg(windows)]
        {
            let script_check = format!(
                "Get-CimInstance Win32_Process | Where-Object {{ ($_.Name -match 'chrome|edge') -and ($_.CommandLine -like '*perfil_facebook_chromium*') }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
            );
            let _ = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script_check])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }

        // Reintentar remoción limpia tras terminar el proceso
        for lock_name in &lockfiles {
            let ruta_lock = perfil_dir.join(lock_name);
            if ruta_lock.exists() {
                let _ = tokio::fs::remove_file(&ruta_lock).await;
            }
        }
    }
}

/// Guarda las cookies capturadas en formato JSON y Netscape cookies.txt para yt-dlp.
pub async fn guardar_cookies_archivos(
    cookies: &[serde_json::Value],
    ruta_json: &Path,
    ruta_netscape: &Path,
) -> Result<Option<String>> {
    if cookies.is_empty() {
        return Ok(None);
    }

    if let Some(parent) = ruta_json.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json_str = serde_json::to_string_pretty(&cookies)?;
    tokio::fs::write(ruta_json, json_str).await?;

    let (salida_netscape, c_user_encontrado) = super::scripts::convertir_cookies_a_netscape(cookies);
    if let Some(parent) = ruta_netscape.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(ruta_netscape, salida_netscape).await?;

    Ok(c_user_encontrado)
}
