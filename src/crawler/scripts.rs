use serde_json::Value;

pub const SCRIPT_STEALTH: &str = r#"
    // Ocultar navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
    });
    // Emular objeto chrome estándar
    window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
    };
    // Plugins y lenguajes realistas
    Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
        configurable: true
    });
    Object.defineProperty(navigator, 'languages', {
        get: () => ['es-ES', 'es', 'en-US', 'en'],
        configurable: true
    });
"#;

pub const SCRIPT_EXTRACCION_DOM: &str = r#"
(() => {
    const urls = new Set();
    const limpiarUrl = (raw) => {
        if (!raw) return null;
        try {
            let u = new URL(raw, 'https://www.facebook.com');
            let path = u.pathname;
            if (path.includes('/watch')) {
                let vid = u.searchParams.get('v');
                if (vid) return 'https://www.facebook.com/watch/?v=' + vid;
                return u.origin + path;
            }
            if (path.includes('/reel/') || path.includes('/reels/')) {
                let m = path.match(/\/reel(?:s)?\/([^\/?#]+)/);
                if (m) {
                    if (/^\d+$/.test(m[1])) return 'https://www.facebook.com/watch/?v=' + m[1];
                    return 'https://www.facebook.com/reel/' + m[1];
                }
                return u.origin + path;
            }
            if (path.includes('/videos/')) {
                let m = path.match(/\/(?:[^\/?#]+)\/videos\/(\d+)/);
                if (m) return 'https://www.facebook.com/watch/?v=' + m[1];
                return u.origin + path;
            }
            if (u.hostname.includes('fb.watch') || path.includes('/share/v/') || path.includes('/share/r/')) {
                return u.origin + path;
            }
            let vid = u.searchParams.get('v');
            if (vid && u.hostname.includes('facebook.com')) {
                return 'https://www.facebook.com/watch/?v=' + vid;
            }
        } catch(e) {}
        return null;
    };

    document.querySelectorAll('a[href], a[role="link"]').forEach(a => {
        const h = a.getAttribute('href') || a.href || '';
        if (h.includes('/watch') || h.includes('/reel') || h.includes('/videos/') || h.includes('fb.watch') || h.includes('/share/v/') || (h.includes('v=') && h.includes('facebook'))) {
            const limpia = limpiarUrl(h);
            if (limpia) urls.add(limpia);
        }
    });

    document.querySelectorAll('[data-video-id]').forEach(el => {
        const vid = el.getAttribute('data-video-id');
        if (vid && /^\d+$/.test(vid)) urls.add('https://www.facebook.com/watch/?v=' + vid);
    });

    document.querySelectorAll('div[role="article"] a[href], div[role="feed"] a[href], div[data-pagelet*="FeedUnit"] a[href]').forEach(a => {
        const h = a.getAttribute('href') || '';
        const limpia = limpiarUrl(h);
        if (limpia) urls.add(limpia);
    });

    return Array.from(urls);
})()
"#;

/// Convierte un arreglo de cookies CDP a formato Netscape HTTP Cookie File
pub fn convertir_cookies_a_netscape(cookies: &[Value]) -> (String, Option<String>) {
    let mut salida = String::from("# Netscape HTTP Cookie File\n# Generado por Ragnarok\n\n");
    let mut c_user_encontrado: Option<String> = None;

    for c in cookies {
        let domain = c.get("domain").and_then(|v| v.as_str()).unwrap_or(".facebook.com");
        let flag = if domain.starts_with('.') { "TRUE" } else { "FALSE" };
        let path = c.get("path").and_then(|v| v.as_str()).unwrap_or("/");
        let secure = if c.get("secure").and_then(|v| v.as_bool()).unwrap_or(false) { "TRUE" } else { "FALSE" };
        let expires = c.get("expires").and_then(|v| v.as_f64()).map(|v| v as u64).unwrap_or(2147483647);
        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let value = c.get("value").and_then(|v| v.as_str()).unwrap_or("");

        if name == "c_user" && !value.is_empty() {
            c_user_encontrado = Some(value.to_string());
        }

        if !name.is_empty() {
            salida.push_str(&format!("{}\t{}\t{}\t{}\t{}\t{}\t{}\n", domain, flag, path, secure, expires, name, value));
        }
    }

    (salida, c_user_encontrado)
}
