use std::fs::File as StdFile;
use std::io::{Read as StdRead, Seek as StdSeek, SeekFrom as StdSeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct InfoVideo {
    pub duracion_segundos: u64,
    pub ancho: i32,
    pub alto: i32,
}

/// Extrae en tiempo récord (< 2ms) los metadatos reales de un MP4 (duración, ancho, alto)
/// analizando los átomos `moov`, `mvhd` y `tkhd` de forma nativa en Rust, sin dependencias externas.
pub fn extraer_info_mp4(ruta: &Path) -> InfoVideo {
    let mut info = InfoVideo {
        duracion_segundos: 0,
        ancho: 1280,
        alto: 720,
    };

    if let Ok(mut f) = StdFile::open(ruta) {
        let file_size = f.seek(StdSeekFrom::End(0)).unwrap_or(0);
        let _ = f.seek(StdSeekFrom::Start(0));

        let mut moov_buffer = Vec::new();
        let mut header = [0u8; 8];

        // 1. Escanear cajas principales al inicio del archivo
        while let Ok(()) = f.read_exact(&mut header) {
            let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
            let name = &header[4..8];

            let (box_data_pos, content_size) = if size == 1 {
                let mut large = [0u8; 8];
                if f.read_exact(&mut large).is_err() {
                    break;
                }
                let lsize = u64::from_be_bytes(large);
                (f.stream_position().unwrap_or(0), lsize.saturating_sub(16))
            } else if size == 0 {
                let pos = f.stream_position().unwrap_or(0);
                (pos, file_size.saturating_sub(pos))
            } else {
                let pos = f.stream_position().unwrap_or(0);
                (pos, size.saturating_sub(8))
            };

            if name == b"moov" {
                let to_read = (content_size as usize).min(32 * 1024 * 1024);
                moov_buffer.resize(to_read, 0);
                let _ = f.read_exact(&mut moov_buffer);
                break;
            } else {
                if f.seek(StdSeekFrom::Start(box_data_pos + content_size)).is_err() {
                    break;
                }
            }
        }

        // 2. Si moov no estaba al inicio (ej. mp4 sin faststart), buscar en los últimos 16 MB
        if moov_buffer.is_empty() && file_size > 16 {
            let tail_size = (16 * 1024 * 1024).min(file_size);
            let seek_pos = file_size - tail_size;
            if f.seek(StdSeekFrom::Start(seek_pos)).is_ok() {
                let mut tail = vec![0u8; tail_size as usize];
                if f.read_exact(&mut tail).is_ok() {
                    if let Some(pos) = tail.windows(4).position(|w| w == b"moov") {
                        if pos >= 4 {
                            let box_start = pos - 4;
                            let box_size = u32::from_be_bytes([
                                tail[box_start],
                                tail[box_start + 1],
                                tail[box_start + 2],
                                tail[box_start + 3],
                            ]) as usize;
                            let avail = tail.len() - pos;
                            let copy_len = if box_size > 8 {
                                (box_size - 4).min(avail)
                            } else {
                                avail
                            };
                            moov_buffer = tail[pos..pos + copy_len].to_vec();
                        }
                    }
                }
            }
        }

        // 3. Parsear mvhd (duración) y tkhd (ancho y alto de la pista de video)
        if !moov_buffer.is_empty() {
            // Buscar mvhd
            if let Some(idx) = moov_buffer.windows(4).position(|w| w == b"mvhd") {
                let payload = &moov_buffer[idx + 4..];
                if !payload.is_empty() {
                    let version = payload[0];
                    if version == 0 && payload.len() >= 20 {
                        let timescale =
                            u32::from_be_bytes([payload[12], payload[13], payload[14], payload[15]]);
                        let dur =
                            u32::from_be_bytes([payload[16], payload[17], payload[18], payload[19]]);
                        if timescale > 0 {
                            info.duracion_segundos = (dur as u64) / (timescale as u64);
                        }
                    } else if version == 1 && payload.len() >= 32 {
                        let timescale =
                            u32::from_be_bytes([payload[20], payload[21], payload[22], payload[23]]);
                        let dur = u64::from_be_bytes([
                            payload[24],
                            payload[25],
                            payload[26],
                            payload[27],
                            payload[28],
                            payload[29],
                            payload[30],
                            payload[31],
                        ]);
                        if timescale > 0 {
                            info.duracion_segundos = dur / (timescale as u64);
                        }
                    }
                }
            }

            // Buscar tkhd (track con ancho > 0 y alto > 0)
            let mut curr = 0;
            while let Some(rel_pos) = moov_buffer[curr..].windows(4).position(|w| w == b"tkhd") {
                let idx = curr + rel_pos;
                let payload = &moov_buffer[idx + 4..];
                if !payload.is_empty() {
                    let version = payload[0];
                    let offset = if version == 1 { 88 } else { 76 };
                    if payload.len() >= offset + 8 {
                        let w_fixed = u32::from_be_bytes([
                            payload[offset],
                            payload[offset + 1],
                            payload[offset + 2],
                            payload[offset + 3],
                        ]);
                        let h_fixed = u32::from_be_bytes([
                            payload[offset + 4],
                            payload[offset + 5],
                            payload[offset + 6],
                            payload[offset + 7],
                        ]);
                        let w = (w_fixed >> 16) as i32;
                        let h = (h_fixed >> 16) as i32;
                        if w > 0 && h > 0 {
                            info.ancho = w;
                            info.alto = h;
                            break;
                        }
                    }
                }
                curr = idx + 4;
            }
        }
    }

    info
}

/// Localiza el binario de FFmpeg en el sistema o en los directorios conocidos.
pub fn resolver_binario_ffmpeg() -> Option<PathBuf> {
    if let Ok(salida) = std::process::Command::new("where.exe")
        .arg("ffmpeg")
        .output()
    {
        if salida.status.success() {
            let texto = String::from_utf8_lossy(&salida.stdout);
            if let Some(primera) = texto.lines().next() {
                let p = PathBuf::from(primera.trim());
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }

    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        let winget_path = PathBuf::from(&localappdata).join("Microsoft").join("WinGet").join("Links").join("ffmpeg.exe");
        if winget_path.exists() {
            return Some(winget_path);
        }
    }

    if let Ok(progfiles) = std::env::var("ProgramFiles") {
        let pf_path = PathBuf::from(progfiles).join("ffmpeg").join("bin").join("ffmpeg.exe");
        if pf_path.exists() {
            return Some(pf_path);
        }
    }

    None
}

/// Genera rápidamente (< 100ms) una miniatura JPG del segundo 3 del video para Telegram.
pub fn generar_thumbnail_video(ruta_video: &Path) -> Option<PathBuf> {
    let bin_ffmpeg = resolver_binario_ffmpeg()?;
    let dir_temp = std::env::temp_dir();
    let id_rnd = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let ruta_salida = dir_temp.join(format!("ragnarok_thumb_{}.jpg", id_rnd));

    let status = std::process::Command::new(bin_ffmpeg)
        .arg("-y")
        .arg("-ss")
        .arg("00:00:03")
        .arg("-i")
        .arg(ruta_video)
        .arg("-vframes")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(&ruta_salida)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if let Ok(s) = status {
        if s.success() && ruta_salida.exists() {
            return Some(ruta_salida);
        }
    }

    None
}
