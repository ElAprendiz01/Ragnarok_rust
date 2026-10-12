use std::io::{self, Write};
use std::path::PathBuf;
use anyhow::{Context, Result};
use grammers_client::{Client, Config};
use grammers_session::Session;

#[tokio::main]
async fn main() -> Result<()> {
    println!("============================================================");
    println!("  Ragnarok - Vinculador de Sesión Oficial de Telegram (MTProto)");
    println!("  Cero Navegadores | Máxima Velocidad | Sesión Permanente");
    println!("============================================================\n");

    // 1. Cargar credenciales desde config/parametros_globales.json (detectando directorio actual)
    let (ruta_config, ruta_session) = if std::path::Path::new("config/parametros_globales.json").exists() {
        (PathBuf::from("config/parametros_globales.json"), PathBuf::from("datos_persistencia/telegram.session"))
    } else if std::path::Path::new("../config/parametros_globales.json").exists() {
        (PathBuf::from("../config/parametros_globales.json"), PathBuf::from("../datos_persistencia/telegram.session"))
    } else {
        (PathBuf::from("config/parametros_globales.json"), PathBuf::from("datos_persistencia/telegram.session"))
    };

    let mut api_id: i32 = 0;
    let mut api_hash = String::new();

    if ruta_config.exists() {
        if let Ok(contenido) = std::fs::read_to_string(&ruta_config) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&contenido) {
                if let Some(id) = v.get("publicacion").and_then(|p| p.get("telegram_api_id")).and_then(|id| id.as_i64()) {
                    api_id = id as i32;
                }
                if let Some(h) = v.get("publicacion").and_then(|p| p.get("telegram_api_hash")).and_then(|h| h.as_str()) {
                    api_hash = h.trim().to_string();
                }
            }
        }
    }

    if api_id == 0 || api_hash.is_empty() {
        println!("[!] No se encontraron credenciales en config/parametros_globales.json.");
        print!("Ingresa tu Telegram App api_id: ");
        io::stdout().flush()?;
        let mut id_str = String::new();
        io::stdin().read_line(&mut id_str)?;
        api_id = id_str.trim().parse().unwrap_or(0);

        print!("Ingresa tu Telegram App api_hash: ");
        io::stdout().flush()?;
        let mut hash_str = String::new();
        io::stdin().read_line(&mut hash_str)?;
        api_hash = hash_str.trim().to_string();

        if api_id == 0 || api_hash.is_empty() {
            anyhow::bail!("api_id y api_hash son requeridos para continuar.");
        }
    }

    println!("[1/3] Conectando a los servidores de Telegram (api_id={})...", api_id);
    let session = Session::load_file_or_create(&ruta_session)?;

    let client = Client::connect(Config {
        session,
        api_id,
        api_hash,
        params: Default::default(),
    }).await.context("Error conectando a los servidores de Telegram")?;

    if client.is_authorized().await? {
        println!("\n[OK] ¡Tu sesión ya está autorizada y activa en 'datos_persistencia/telegram.session'!");
        println!("No necesitas hacer nada más. El servidor subirá los videos automáticamente.");
        return Ok(());
    }

    println!("[2/3] Tu sesión requiere autorización inicial (solo una única vez).\n");
    print!("Ingresa tu número de teléfono con código de país (ej: +521234567890) o Bot Token: ");
    io::stdout().flush()?;

    let mut entrada = String::new();
    io::stdin().read_line(&mut entrada)?;
    let entrada = entrada.trim();

    if entrada.contains(':') {
        // Es un Bot Token
        println!("Iniciando sesión como Bot...");
        client.bot_sign_in(entrada).await.context("Error autenticando con Bot Token")?;
    } else {
        // Es un número telefónico de usuario
        println!("Solicitando código de inicio de sesión a Telegram...");
        let token_login = client.request_login_code(entrada).await.context("Error solicitando código a Telegram")?;

        print!("\nIngresa el código de 5 dígitos recibido en tu app de Telegram: ");
        io::stdout().flush()?;

        let mut codigo = String::new();
        io::stdin().read_line(&mut codigo)?;
        let codigo = codigo.trim();

        client.sign_in(&token_login, codigo).await.context("Código incorrecto o expirado")?;
    }

    client.session().save_to_file(&ruta_session)?;
    println!("\n============================================================");
    println!("  [OK] ¡Sesión vinculada y guardada permanentemente!");
    println!("  Archivo creado: datos_persistencia/telegram.session");
    println!("  Ahora puedes iniciar el sistema con 'iniciar_rust.bat'");
    println!("============================================================");

    Ok(())
}
