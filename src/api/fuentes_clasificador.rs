pub const SEPARADOR: &str = " ||| ";

pub fn decodificar_url(s: &str) -> String {
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

pub struct InfoFuente {
    pub tipo: String,
    pub descripcion: String,
    pub url_scroll: String,
}

pub fn clasificar_url_facebook(url: &str) -> InfoFuente {
    let limpia = url.trim().trim_end_matches('/');

    if limpia.ends_with("/watch") || limpia == "https://www.facebook.com/watch" {
        InfoFuente {
            tipo: "watch_global".to_string(),
            descripcion: "Facebook Watch (feed global de videos)".to_string(),
            url_scroll: "https://www.facebook.com/watch/".to_string(),
        }
    } else if limpia.contains("facebook.com/groups/") {
        let grupo = limpia.split("facebook.com/groups/").nth(1).unwrap_or("").split('/').next().unwrap_or("");
        InfoFuente {
            tipo: "grupo_videos".to_string(),
            descripcion: "Grupo de Facebook — sección Videos".to_string(),
            url_scroll: format!("https://www.facebook.com/groups/{}/videos/", grupo),
        }
    } else if limpia.contains("/reel/") || limpia.contains("/reels/") {
        InfoFuente {
            tipo: "reel".to_string(),
            descripcion: "Reel individual de Facebook".to_string(),
            url_scroll: limpia.to_string(),
        }
    } else if limpia.contains("/videos/") || limpia.contains("/watch/?v=") || limpia.contains("fb.watch/") {
        InfoFuente {
            tipo: "video_directo".to_string(),
            descripcion: "URL directa de video de Facebook".to_string(),
            url_scroll: limpia.to_string(),
        }
    } else if limpia.contains("/search/videos") {
        InfoFuente {
            tipo: "busqueda".to_string(),
            descripcion: "Búsqueda de videos en Facebook".to_string(),
            url_scroll: limpia.to_string(),
        }
    } else if limpia.contains("facebook.com/profile.php") {
        InfoFuente {
            tipo: "perfil_videos".to_string(),
            descripcion: "Perfil de usuario — sección Videos".to_string(),
            url_scroll: format!("{}/videos", limpia),
        }
    } else if limpia.contains("facebook.com/") {
        let path = limpia.split("facebook.com/").nth(1).unwrap_or("").split('/').next().unwrap_or("");
        if !path.is_empty() && path != "watch" && path != "groups" && path != "saved" {
            InfoFuente {
                tipo: "pagina_videos".to_string(),
                descripcion: "Página de Facebook — sección Videos".to_string(),
                url_scroll: format!("https://www.facebook.com/{}/videos/", path),
            }
        } else {
            InfoFuente {
                tipo: "desconocida".to_string(),
                descripcion: "URL Genérica".to_string(),
                url_scroll: limpia.to_string(),
            }
        }
    } else {
        InfoFuente {
            tipo: "desconocida".to_string(),
            descripcion: "URL Genérica".to_string(),
            url_scroll: limpia.to_string(),
        }
    }
}
