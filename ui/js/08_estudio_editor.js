// ============================================================================
// MODULO: 08_estudio_editor.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

// ESTUDIO CINEMA DE REPRODUCCIÓN & EDITOR DE METADATOS
// ─────────────────────────────────────────────────────────

function abrirEnEstudio(idxOrId) {
  let idx = -1;
  if (typeof idxOrId === 'string') {
    idx = App.playlist.findIndex(x => x.id === idxOrId);
  } else if (typeof idxOrId === 'number') {
    idx = idxOrId;
  }
  if (idx < 0 || idx >= App.playlist.length) return;
  navTo('estudio', document.getElementById('nav-estudio'));
  cargarVideoEnEstudio(idx, true);
  // Mantener los filtros activos y sincronizados en la lista lateral
  renderEstudioPlaylist(obtenerVideosFiltrados());
}

function prepararVideoEnEstudio(idx) {
  if (idx < 0 || idx >= App.playlist.length) return;
  App.estudio.idx = idx;
  const v = App.playlist[idx];
  App.estudio.videoActivo = v;

  const video = document.getElementById('estudio-video');
  const poster = document.getElementById('estudio-poster');
  const posterTitle = document.getElementById('estudio-poster-title');
  const posterSub = document.getElementById('estudio-poster-sub');
  const posterPlayBtn = document.getElementById('estudio-poster-play-btn');
  const badgeEstado = document.getElementById('estudio-badge-estado');
  const badgeRes = document.getElementById('estudio-badge-resolucion');

  if (badgeEstado) {
    badgeEstado.textContent = (v.estado || 'descargado').toUpperCase();
    badgeEstado.style.borderColor = v.estado === 'editado' ? 'var(--purple)' : 'var(--cyan)';
    badgeEstado.style.color = v.estado === 'editado' ? 'var(--purple)' : 'var(--cyan)';
  }
  if (badgeRes) badgeRes.textContent = v.resolucion || 'HD';

  // Standby instantáneo: CERO bytes de video transferidos hasta dar clic
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  if (poster) {
    poster.style.display = 'flex';
    if (posterTitle) posterTitle.textContent = v.titulo;
    if (posterSub) posterSub.textContent = `${v.dur || '0:00'} · ${v.tamano || ''} · ${v.resolucion || 'HD'} — Haz clic para reproducir`;
    if (posterPlayBtn) posterPlayBtn.style.display = 'inline-flex';
  }

  cargarMetadatosEnEditor(v);
  renderClipsEstudio(v);

  // Marcar item activo en la lista lateral por su ID único
  document.querySelectorAll('.estudio-pl-item').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-id') === v.id);
  });

  const curEl = document.getElementById('estudio-cur');
  const durEl = document.getElementById('estudio-dur');
  const fill = document.getElementById('estudio-prog-fill');
  const thumb = document.getElementById('estudio-prog-thumb');
  const playBtn = document.getElementById('estudio-play-btn');

  if (curEl) curEl.textContent = '0:00';
  if (durEl) durEl.textContent = v.dur || '0:00';
  if (fill) fill.style.width = '0%';
  if (thumb) thumb.style.left = '0%';
  if (playBtn) playBtn.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" />';
}

function cargarVideoEnEstudio(idx, autoplay = true) {
  if (idx < 0 || idx >= App.playlist.length) return;
  App.estudio.idx = idx;
  const v = App.playlist[idx];
  App.estudio.videoActivo = v;

  if (!autoplay) {
    prepararVideoEnEstudio(idx);
    return;
  }

  const video = document.getElementById('estudio-video');
  const poster = document.getElementById('estudio-poster');
  const badgeEstado = document.getElementById('estudio-badge-estado');
  const badgeRes = document.getElementById('estudio-badge-resolucion');

  if (badgeEstado) {
    badgeEstado.textContent = (v.estado || 'descargado').toUpperCase();
    badgeEstado.style.borderColor = v.estado === 'editado' ? 'var(--purple)' : 'var(--cyan)';
    badgeEstado.style.color = v.estado === 'editado' ? 'var(--purple)' : 'var(--cyan)';
  }
  if (badgeRes) badgeRes.textContent = v.resolucion || 'HD';

  if (v.url_stream) {
    if (video) {
      const fullUrl = API_BASE + v.url_stream;
      if (video.src !== fullUrl) {
        video.src = fullUrl;
      }
      video.playbackRate = App.estudio.speed || 1.0;
      video.play().catch(e => {});
    }
    if (poster) poster.style.display = 'none';
  } else {
    prepararVideoEnEstudio(idx);
    return;
  }

  cargarMetadatosEnEditor(v);
  renderClipsEstudio(v);

  // Marcar item activo en la lista lateral por su ID único
  document.querySelectorAll('.estudio-pl-item').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-id') === v.id);
  });

  const curEl = document.getElementById('estudio-cur');
  const durEl = document.getElementById('estudio-dur');
  const playBtn = document.getElementById('estudio-play-btn');

  if (curEl) curEl.textContent = '0:00';
  if (durEl) durEl.textContent = v.dur || '0:00';
  if (playBtn) playBtn.innerHTML = '<img src="iconos/pausa.svg" class="icono-svg-sm" />';

  addLog('info', `Reproduciendo en Estudio: <span class="hl">${escapeHtml(v.titulo)}</span>`);
}

function estudioPosterClick() {
  if (App.estudio.videoActivo) {
    cargarVideoEnEstudio(App.estudio.idx, true);
  }
}

function estudioTogglePlay() {
  const v = document.getElementById('estudio-video');
  if (!v) return;
  if ((!v.src || !v.getAttribute('src')) && App.estudio.videoActivo) {
    cargarVideoEnEstudio(App.estudio.idx, true);
    return;
  }
  if (v.paused) {
    const poster = document.getElementById('estudio-poster');
    if (poster) poster.style.display = 'none';
    v.play().catch(e => {});
  } else {
    v.pause();
  }
}

function seekEstudio(e) {
  const track = e.currentTarget.querySelector('.estudio-prog-track');
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const v = document.getElementById('estudio-video');
  if (v && v.duration) {
    v.currentTime = v.duration * pct;
  }
  const elFill = document.getElementById('estudio-prog-fill');
  const elThumb = document.getElementById('estudio-prog-thumb');
  if (elFill) elFill.style.width = (pct * 100) + '%';
  if (elThumb) elThumb.style.left = (pct * 100) + '%';
}

let _ultimoSegundoEstudio = -1;
function estudioUpdateProgress() {
  const v = document.getElementById('estudio-video');
  if (!v || !v.duration) return;
  const pct = (v.currentTime / v.duration) * 100;
  const elFill = document.getElementById('estudio-prog-fill');
  const elThumb = document.getElementById('estudio-prog-thumb');
  if (elFill) elFill.style.width = pct + '%';
  if (elThumb) elThumb.style.left = pct + '%';

  const secInt = Math.floor(v.currentTime);
  if (secInt !== _ultimoSegundoEstudio) {
    _ultimoSegundoEstudio = secInt;
    const elCur = document.getElementById('estudio-cur');
    if (elCur) elCur.textContent = fmtTime(v.currentTime);
  }
}

function estudioOnVideoLoaded() {
  const v = document.getElementById('estudio-video');
  const poster = document.getElementById('estudio-poster');
  const elDur = document.getElementById('estudio-dur');
  if (poster) poster.style.display = 'none';
  if (v && elDur) elDur.textContent = fmtTime(v.duration);
}

function estudioSkip(sec) {
  const v = document.getElementById('estudio-video');
  if (v && v.src) v.currentTime = Math.max(0, Math.min(v.duration || 99999, v.currentTime + sec));
}

function estudioPrev() {
  const prevIdx = Math.max(0, App.estudio.idx - 1);
  cargarVideoEnEstudio(prevIdx, true);
}

function estudioNext() {
  const nextIdx = Math.min(App.playlist.length - 1, App.estudio.idx + 1);
  cargarVideoEnEstudio(nextIdx, true);
}

function estudioSetSpeed(spd) {
  App.estudio.speed = spd;
  const v = document.getElementById('estudio-video');
  if (v) v.playbackRate = spd;
  document.querySelectorAll('.estudio-spd').forEach(el => {
    el.classList.toggle('actv', parseFloat(el.getAttribute('data-spd')) === spd);
  });
}

function estudioSetVol(val) {
  const v = document.getElementById('estudio-video');
  if (v) v.volume = val;
  const b = document.getElementById('estudio-mute-btn');
  if (b) b.innerHTML = val == 0 ? '<img src="iconos/audio.svg" class="icono-svg-sm" style="opacity:0.35" />' : '<img src="iconos/audio.svg" class="icono-svg-sm" />';
}

function estudioToggleMute() {
  const v = document.getElementById('estudio-video');
  if (v) {
    v.muted = !v.muted;
    const b = document.getElementById('estudio-mute-btn');
    if (b) b.innerHTML = v.muted ? '<img src="iconos/audio.svg" class="icono-svg-sm" style="opacity:0.35" />' : '<img src="iconos/audio.svg" class="icono-svg-sm" />';
  }
}

function estudioToggleFullscreen() {
  const box = document.getElementById('estudio-viewport');
  if (!box) return;
  if (!document.fullscreenElement) {
    box.requestFullscreen().catch(e => {});
  } else {
    document.exitFullscreen().catch(e => {});
  }
}

function toggleModoTeatro() {
  const page = document.getElementById('pg-estudio');
  if (!page) return;
  App.estudio.modoTeatro = !App.estudio.modoTeatro;
  page.classList.toggle('estudio-teatro', App.estudio.modoTeatro);
  const btn = document.getElementById('btn-modo-teatro');
  if (btn) btn.innerHTML = App.estudio.modoTeatro ? '<img src="iconos/pantalla.svg" class="icono-svg-sm" /> Vista Normal' : '<img src="iconos/play.svg" class="icono-svg-sm" /> Modo Cine';
}

function activarModoFlotanteDesdeEstudio() {
  const ve = document.getElementById('estudio-video');
  const tiempo = ve ? ve.currentTime : 0;
  if (ve) ve.pause();
  navTo('dash', document.getElementById('nav-dash'));
  abrirEnPiP(App.estudio.idx);
  const vp = document.getElementById('pip-video');
  if (vp) vp.currentTime = tiempo;
}

// ─────────────────────────────────────────────────────────
// EDITOR DE METADATOS EN TIEMPO REAL (JSON)
// ─────────────────────────────────────────────────────────

function cargarMetadatosEnEditor(v) {
  if (!v) return;
  const inTitulo = document.getElementById('meta-input-titulo');
  const inDesc = document.getElementById('meta-input-desc');
  const cntTitulo = document.getElementById('meta-chars-titulo');
  const cntDesc = document.getElementById('meta-chars-desc');
  const tId = document.getElementById('meta-tech-id');
  const tDur = document.getElementById('meta-tech-dur');
  const tTam = document.getElementById('meta-tech-tam');
  const tRes = document.getElementById('meta-tech-res');
  const tPath = document.getElementById('meta-tech-path');
  const badge = document.getElementById('meta-save-badge');

  if (inTitulo) inTitulo.value = v.titulo || '';
  if (inDesc) inDesc.value = v.descripcion || '';
  if (cntTitulo) cntTitulo.textContent = `${(v.titulo || '').length}/100`;
  if (cntDesc) cntDesc.textContent = `${(v.descripcion || '').length} caracteres`;

  if (tId) tId.textContent = v.id || '—';
  if (tDur) tDur.textContent = v.dur || '—';
  if (tTam) tTam.textContent = v.tamano || '—';
  if (tRes) tRes.textContent = v.resolucion || 'Auto';
  if (tPath) tPath.textContent = v.url_stream || '—';

  if (badge) {
    badge.className = 'meta-badge-idle';
    badge.textContent = 'Sincronizado';
  }
}

function onInputMetadatos(campo, val) {
  const cntTitulo = document.getElementById('meta-chars-titulo');
  const cntDesc = document.getElementById('meta-chars-desc');
  const inTitulo = document.getElementById('meta-input-titulo');
  const inDesc = document.getElementById('meta-input-desc');

  if (campo === 'titulo' && cntTitulo) {
    cntTitulo.textContent = `${val.length}/100`;
    cntTitulo.style.color = val.length > 100 ? 'var(--red)' : 'var(--txt3)';
  } else if (campo === 'desc' && cntDesc) {
    cntDesc.textContent = `${val.length} caracteres`;
  }

  const badge = document.getElementById('meta-save-badge');
  if (badge) {
    badge.className = 'meta-badge-saving';
    badge.textContent = 'Modificado (guardando...)';
  }

  // Guardado en tiempo real con debounce (600ms)
  if (App.metaDebounceTimer) clearTimeout(App.metaDebounceTimer);
  App.metaDebounceTimer = setTimeout(() => {
    guardarMetadatosActivo(true);
  }, 650);
}

async function guardarMetadatosActivo(esAuto = false) {
  const v = App.estudio.videoActivo || App.playlist[App.estudio.idx];
  if (!v || !v.id) return;

  const inTitulo = document.getElementById('meta-input-titulo');
  const inDesc = document.getElementById('meta-input-desc');
  const nuevoTitulo = inTitulo ? inTitulo.value.trim() : '';
  const nuevaDesc = inDesc ? inDesc.value.trim() : '';

  if (!nuevoTitulo && !nuevaDesc) return;

  const badge = document.getElementById('meta-save-badge');
  if (badge) {
    badge.className = 'meta-badge-saving';
    badge.textContent = 'Guardando en JSON...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/videos/${v.id}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: nuevoTitulo || v.titulo,
        descripcion: nuevaDesc !== undefined ? nuevaDesc : v.descripcion,
      })
    });
    const data = await res.json();
    if (data.ok) {
      if (nuevoTitulo) v.titulo = nuevoTitulo;
      if (nuevaDesc !== undefined) v.descripcion = nuevaDesc;

      // Actualizar objeto en galeria
      const itemGal = App.galeria.find(g => g.id === v.id);
      if (itemGal) {
        if (nuevoTitulo) itemGal.titulo = nuevoTitulo;
        if (nuevaDesc !== undefined) itemGal.descripcion = nuevaDesc;
      }

      if (badge) {
        badge.className = 'meta-badge-idle';
        badge.textContent = 'Guardado en JSON';
      }

      // Actualizar visualmente títulos en listas sin reiniciar video
      actualizarTitulosEnListas(v.id, nuevoTitulo);

      if (!esAuto) {
        mostrarToast('success', 'Metadatos guardados permanentemente en el archivo JSON.');
      }
    } else {
      if (badge) {
        badge.className = 'meta-badge-saving';
        badge.textContent = 'Error al guardar';
      }
      if (!esAuto) mostrarToast('error', `Error: ${data.error}`);
    }
  } catch(e) {
    if (badge) {
      badge.className = 'meta-badge-saving';
      badge.textContent = 'Sin servidor';
    }
  }
}

function actualizarTitulosEnListas(idVideo, nuevoTitulo) {
  // Actualizar en Estudio playlist
  const elPlTitle = document.querySelector(`.estudio-pl-item[data-id="${idVideo}"] .estudio-pl-title`);
  if (elPlTitle) elPlTitle.textContent = nuevoTitulo;

  // Actualizar en PiP playlist
  const pipItem = document.querySelector(`.pip-pl-item[id="ppl-${App.pip.idx}"] .pip-pl-title`);
  if (pipItem && App.playlist[App.pip.idx]?.id === idVideo) pipItem.textContent = nuevoTitulo;

  // Actualizar en dashboard cola
  renderColaVideosDashboard(App.galeria);
}

function restaurarMetadatosOriginales() {
  const v = App.estudio.videoActivo;
  if (!v) return;
  cargarMetadatosEnEditor(v);
  mostrarToast('info', 'Valores restaurados desde la memoria actual.');
}

// ─────────────────────────────────────────────────────────
// MÓDULO DE RECORTE & SEGMENTACIÓN DE VIDEO (ESTUDIO)
// ─────────────────────────────────────────────────────────

function onCambioDuracionRecorte(val) {
  const wrapCustom = document.getElementById('wrap-duracion-custom');
  if (wrapCustom) wrapCustom.style.display = (val === 'custom') ? 'block' : 'none';
}

function renderClipsEstudio(v) {
  const contenedor = document.getElementById('lista-clips-estudio');
  const badge = document.getElementById('badge-estado-recorte');
  const titulo = document.getElementById('titulo-clips-estudio');
  if (!contenedor) return;

  if (!v) {
    if (badge) { badge.className = 'tbadge pend'; badge.textContent = 'Sin video'; }
    if (titulo) titulo.textContent = 'Clips Recortados (0 partes)';
    contenedor.innerHTML = '<div style="font-size:11px;color:var(--txt3);text-align:center;padding:12px">Selecciona un video de la biblioteca para ver o generar clips.</div>';
    return;
  }

  const clips = v.clips || [];
  if (badge) {
    if (clips.length > 0) {
      badge.className = 'tbadge ok';
      badge.textContent = `${clips.length} partes recortadas`;
    } else {
      badge.className = 'tbadge pend';
      badge.textContent = 'Sin clips';
    }
  }

  if (titulo) {
    titulo.textContent = `Clips Recortados (${clips.length} partes)`;
  }

  if (clips.length === 0) {
    contenedor.innerHTML = `
      <div style="font-size:11px;color:var(--txt3);text-align:center;padding:14px;background:var(--bg2);border-radius:6px">
        Este video aún no tiene clips recortados en disco.<br>
        Selecciona la duración arriba (ej: 60s para TikTok/Shorts) y haz clic en <strong>Cortar en Partes</strong>.
      </div>
    `;
    return;
  }

  contenedor.innerHTML = clips.map((clip, i) => {
    const nombreEsc = escapeHtml(clip.nombre);
    return `
      <div class="flex-between" style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:7px 10px;align-items:center;transition:border-color .2s">
        <div class="flex-align-8" style="cursor:pointer;flex:1;min-width:0" onclick="reproducirClipEnEstudio('${clip.url_stream}', '${nombreEsc}', ${clip.parte})">
          <span class="cico cico-cyan" style="width:26px;height:26px;min-width:26px;display:flex;align-items:center;justify-content:center"><img src="iconos/play.svg" class="icono-svg-sm" /></span>
          <div style="min-width:0;flex:1">
            <div style="font-size:12px;font-weight:600;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${nombreEsc}">${nombreEsc}</div>
            <div style="font-size:10px;color:var(--txt3)">Parte ${clip.parte || (i + 1)} · ${clip.tamano || '—'}</div>
          </div>
        </div>
        <div class="flex-align-8">
          <button class="btn bs bsm" onclick="reproducirClipEnEstudio('${clip.url_stream}', '${nombreEsc}', ${clip.parte})" title="Ver este clip en el reproductor">
            <img src="iconos/play.svg" class="icono-svg-sm" /> Ver
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function reproducirClipEnEstudio(urlStream, nombreClip, numParte) {
  const video = document.getElementById('estudio-video');
  const poster = document.getElementById('estudio-poster');
  const badgeEstado = document.getElementById('estudio-badge-estado');
  if (!video || !urlStream) return;

  if (poster) poster.style.display = 'none';
  video.src = API_BASE + urlStream;
  video.playbackRate = App.estudio.speed || 1.0;
  video.play().catch(() => {});

  if (badgeEstado) {
    badgeEstado.textContent = `PARTE ${numParte || 1}`;
    badgeEstado.style.borderColor = 'var(--purple)';
    badgeEstado.style.color = 'var(--purple)';
  }

  mostrarToast('info', `Reproduciendo: ${nombreClip}`);
  addLog('info', `Reproduciendo clip en Estudio: <span class="hl">${escapeHtml(nombreClip)}</span>`);
}

async function ejecutarRecorteEstudio() {
  const v = App.estudio.videoActivo || App.playlist[App.estudio.idx];
  if (!v || !v.id) {
    mostrarToast('warning', 'Selecciona un video primero en el Estudio.');
    return;
  }

  const selDur = document.getElementById('sel-duracion-recorte')?.value || '480';
  let durSeg = parseInt(selDur);
  if (selDur === 'custom') {
    durSeg = parseInt(document.getElementById('input-duracion-custom')?.value) || 60;
  }

  const vel = parseFloat(document.getElementById('sel-velocidad-recorte')?.value) || 1.0;
  const btn = document.getElementById('btn-ejecutar-recorte');
  const origBtnHtml = btn ? btn.innerHTML : '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<img src="iconos/cortar.svg" class="icono-svg-sm" /> Cortando video...';
  }

  mostrarToast('info', `Iniciando corte de "${escapeHtml(v.titulo)}" en bloques de ${durSeg}s...`);
  addLog('info', `Iniciando corte de video <span class="hl">${escapeHtml(v.titulo)}</span> (Bloques: ${durSeg}s, Vel: ${vel}x)...`);

  try {
    const res = await fetch(API_BASE + '/api/videos/recortar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_video: v.id,
        duracion_bloque: durSeg,
        factor_velocidad: vel,
        purgar_original: false
      })
    });
    const data = await res.json();
    if (data.ok) {
      v.clips = data.clips || [];
      v.partes = data.total_clips || (data.clips ? data.clips.length : 1);
      v.estado = 'editado';

      renderClipsEstudio(v);
      mostrarToast('success', `Corte finalizado: ${v.partes} partes generadas en descargas/${v.id}/clips/`);
      addLog('ok', `Video segmentado exitosamente: <span class="hl">${v.partes} partes</span> generadas.`);
      cargarGaleriaDesdeServidor();
    } else {
      mostrarToast('error', `Error al recortar: ${data.error || 'Desconocido'}`);
      addLog('err', `Fallo al recortar video: ${data.error || 'Error'}`);
    }
  } catch (err) {
    mostrarToast('error', `Error al comunicarse con el servidor: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnHtml;
    }
  }
}

let videoPendientePublicar = null;
let plataformaPendientePublicar = 'telegram';

function publicarVideoDesdeGaleria(idx, plat) {
  cargarVideoEnEstudio(idx, false);
  publicarVideoActivo(plat);
}

async function confirmarEliminarVideoEstudio() {
  const v = App.estudio.videoActivo || App.playlist[App.estudio.idx];
  if (!v || !v.id) {
    mostrarToast('warning', 'No hay un video activo seleccionado para eliminar.');
    return;
  }

  const titulo = v.titulo || v.id;
  const confirmado = await mostrarModalConfirmacion({
    tag: 'PURGA PERMANENTE DE DISCO',
    titulo: '¿Eliminar Video y Metadatos JSON?',
    subtitulo: 'Esta acción purgará físicamente el archivo original, todos los clips y la configuración JSON.',
    itemTitulo: titulo,
    itemId: v.id,
    detalles: [
      { label: 'Video Original', desc: 'descargas/' + v.id + ' (.mp4)' },
      { label: 'Metadatos JSON', desc: 'metadata.json (información de publicación)' },
      { label: 'Segmentos y Clips', desc: 'procesados/' + v.id + ' (subcarpetas de recortes)' }
    ],
    nota: 'El espacio en disco se liberará de inmediato. Esta acción no se puede deshacer.',
    textoConfirmar: 'Eliminar Permanentemente',
    icono: 'eliminar.svg',
    peligro: true
  });
  if (!confirmado) return;

  mostrarToast('info', `Eliminando "${escapeHtml(titulo)}" del disco...`);
  addLog('warn', `Eliminando video y metadata JSON: <span class="hl">${escapeHtml(titulo)}</span> (${v.id})...`);

  // Detener reproductor si estaba reproduciendo este video
  const video = document.getElementById('estudio-video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  // Guardar posición exacta del scroll e índice antes de eliminar
  const plContainer = document.getElementById('estudio-playlist-container');
  const scrollPrev = plContainer ? plContainer.scrollTop : 0;
  const idxPrev = App.estudio.idx;

  try {
    const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(v.id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Video "${escapeHtml(titulo)}" y su JSON eliminados permanentemente del disco.`);
      addLog('ok', `Video y archivo JSON eliminados de disco: <span class="hl">${v.id}</span>.`);

      // Sincronizar galería desde disco
      await cargarGaleriaDesdeServidor();

      // Si quedan videos, seleccionar el adyacente (manteniendo la posición relativa)
      if (App.galeria.length > 0) {
        const nextIdx = Math.max(0, Math.min(idxPrev, App.playlist.length - 1));
        cargarVideoEnEstudio(nextIdx, false);
      } else {
        App.estudio.videoActivo = null;
        const poster = document.getElementById('estudio-poster');
        const posterTitle = document.getElementById('estudio-poster-title');
        const posterSub = document.getElementById('estudio-poster-sub');
        if (poster) poster.style.display = 'flex';
        if (posterTitle) posterTitle.textContent = 'Ningún video en disco';
        if (posterSub) posterSub.textContent = 'Agrega una fuente o enlace para descargar videos.';
        renderClipsEstudio(null);
      }

      // Restaurar y mantener fijo el scroll del contenedor lateral
      if (plContainer) {
        plContainer.scrollTop = scrollPrev;
        requestAnimationFrame(() => {
          if (plContainer) plContainer.scrollTop = scrollPrev;
        });
        setTimeout(() => {
          if (plContainer) plContainer.scrollTop = scrollPrev;
        }, 60);
      }
    } else {
      mostrarToast('error', `Error al eliminar: ${data.error || 'Desconocido'}`);
      addLog('err', `Error al eliminar video ${v.id}: ${data.error}`);
    }
  } catch (err) {
    mostrarToast('error', `Error al comunicarse con el servidor: ${err.message}`);
  }
}

async function publicarVideoActivo(plat) {
  const v = App.estudio.videoActivo || App.playlist[App.estudio.idx];
  if (!v) {
    mostrarToast('warning', 'Selecciona un video primero en el Estudio.');
    return;
  }
  // Asegurar que los metadatos editados en pantalla se guarden en disco antes de publicar
  await guardarMetadatosActivo(true);

  videoPendientePublicar = v;
  plataformaPendientePublicar = plat || 'telegram';

  // Configurar elementos del modal
  const elHdr = document.getElementById('m-pub-titulo-hdr');
  const elVidTitulo = document.getElementById('m-pub-video-titulo');
  const elVidId = document.getElementById('m-pub-video-id');
  const elVidDur = document.getElementById('m-pub-video-dur');
  const elVidTam = document.getElementById('m-pub-video-tam');
  const elVidEstado = document.getElementById('m-pub-video-estado');
  const elCanal = document.getElementById('m-pub-canal');
  const elPlatLbl = document.getElementById('m-pub-plat-label');
  const grpCanal = document.getElementById('m-pub-grupo-canal');
  const btnConfirmar = document.getElementById('m-pub-btn-confirmar');

  const nombresPlat = {
    telegram: 'Telegram HD',
    youtube: 'YouTube',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    instagram: 'Instagram'
  };

  const nombrePlat = nombresPlat[plat] || (plat ? plat.toUpperCase() : 'Telegram HD');
  if (elHdr) elHdr.innerHTML = `<img src="iconos/${plat || 'telegram'}.svg" class="icono-svg" /> Publicar Video en ${nombrePlat}`;
  if (elPlatLbl) elPlatLbl.textContent = nombrePlat;
  if (elVidTitulo) elVidTitulo.textContent = v.titulo || 'Sin título';
  if (elVidId) elVidId.textContent = v.id || '—';
  if (elVidDur) elVidDur.textContent = v.dur || '—';
  if (elVidTam) elVidTam.textContent = v.tamano || '—';
  if (elVidEstado) elVidEstado.textContent = (v.estado || 'descargado').toUpperCase();

  // Controlar visibilidad del campo canal
  if (grpCanal) {
    grpCanal.style.display = (plat === 'telegram') ? 'block' : 'none';
  }
  if (elCanal && plat === 'telegram') {
    elCanal.value = App.canalTelegramActivo || '';
    actualizarVistasCanalTelegram();
  }

  // Adaptar dinámicamente opciones de modo (Completo vs Clips) según plataforma
  const rCompleto = document.getElementById('m-pub-radio-completo');
  const rClips = document.getElementById('m-pub-radio-clips');
  const rCompWrap = document.getElementById('m-pub-modo-completo-wrap');
  const tComp = document.getElementById('m-pub-modo-completo-titulo');
  const dComp = document.getElementById('m-pub-modo-completo-desc');
  const tClips = document.getElementById('m-pub-modo-clips-titulo');
  const dClips = document.getElementById('m-pub-modo-clips-desc');
  const notaModo = document.getElementById('m-pub-modo-nota');

  if (rCompleto && rClips && rCompWrap) {
    if (plat === 'tiktok') {
      rCompleto.disabled = true;
      rCompWrap.style.opacity = '0.35';
      rCompWrap.style.pointerEvents = 'none';
      rClips.checked = true;
      if (tClips) tClips.innerHTML = '<img src="iconos/tiktok.svg" class="icono-svg-sm" /> Videos Cortos / Clips (TikTok)';
      if (dClips) dClips.textContent = 'Publica cada parte o segmento recortado individualmente como video corto.';
      if (notaModo) {
        notaModo.style.display = 'block';
        notaModo.innerHTML = '<strong>Formato TikTok:</strong> Solo admite videos cortos / clips verticales. Si el video original no está segmentado aún, se recortará automáticamente.';
      }
    } else if (plat === 'facebook') {
      rCompleto.disabled = false;
      rCompWrap.style.opacity = '1';
      rCompWrap.style.pointerEvents = 'auto';
      rCompleto.checked = true;
      if (tComp) tComp.innerHTML = '<img src="iconos/facebook.svg" class="icono-svg-sm" /> Video Completo Original (Entero / Película)';
      if (dComp) dComp.textContent = 'Publica la película o video completo original sin cortes en tu página o perfil de Facebook.';
      if (tClips) tClips.innerHTML = '<img src="iconos/cortar.svg" class="icono-svg-sm" /> Segmentos / Clips Recortados (Secuencia / Lista)';
      if (dClips) dClips.textContent = 'Publica la serie de partes numeradas consecutivamente con títulos individuales.';
      if (notaModo) notaModo.style.display = 'none';
    } else if (plat === 'youtube') {
      rCompleto.disabled = false;
      rCompWrap.style.opacity = '1';
      rCompWrap.style.pointerEvents = 'auto';
      rCompleto.checked = true;
      if (tComp) tComp.innerHTML = '<img src="iconos/youtube.svg" class="icono-svg-sm" /> Video Completo Original (Horizontal Estándar)';
      if (dComp) dComp.textContent = 'Sube el video completo en alta calidad a tu canal de YouTube Studio.';
      if (tClips) tClips.innerHTML = '<img src="iconos/cortar.svg" class="icono-svg-sm" /> Clips Recortados (YouTube Shorts / Secuencia)';
      if (dClips) dClips.textContent = 'Sube los fragmentos divididos como serie de partes o shorts.';
      if (notaModo) notaModo.style.display = 'none';
    } else if (plat === 'telegram') {
      rCompleto.disabled = false;
      rCompWrap.style.opacity = '1';
      rCompWrap.style.pointerEvents = 'auto';
      rCompleto.checked = true;
      if (tComp) tComp.innerHTML = '<img src="iconos/telegram.svg" class="icono-svg-sm" /> Video Completo Original (Full HD / Archivo)';
      if (dComp) dComp.textContent = 'Envía el archivo de video completo en máxima calidad directamente al canal.';
      if (tClips) tClips.innerHTML = '<img src="iconos/cortar.svg" class="icono-svg-sm" /> Segmentos / Clips Recortados (Secuencia)';
      if (dClips) dClips.textContent = 'Envía cada parte dividida con sus marcas de tiempo y sinopsis.';
      if (notaModo) notaModo.style.display = 'none';
    } else {
      rCompleto.disabled = false;
      rCompWrap.style.opacity = '1';
      rCompWrap.style.pointerEvents = 'auto';
      rCompleto.checked = true;
      if (tComp) tComp.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" /> Video Completo Original';
      if (dComp) dComp.textContent = 'Sube el video original completo.';
      if (tClips) tClips.innerHTML = '<img src="iconos/cortar.svg" class="icono-svg-sm" /> Clips Recortados (Secuencia)';
      if (dClips) dClips.textContent = 'Sube los fragmentos divididos.';
      if (notaModo) notaModo.style.display = 'none';
    }
  }

  // Controlar visibilidad del selector de navegador (Solo Facebook utiliza CDP/Chromium)
  const grpBrowser = document.getElementById('m-pub-grupo-browser');
  if (grpBrowser) {
    grpBrowser.style.display = (plat === 'facebook') ? 'block' : 'none';
  }

  // Notificación de estado de conectividad real con backend
  const alertaPlat = document.getElementById('m-pub-plataforma-alerta');
  if (alertaPlat) {
    if (plat === 'telegram') {
      alertaPlat.style.display = 'block';
      alertaPlat.style.background = 'rgba(0, 136, 204, 0.12)';
      alertaPlat.style.border = '1px solid rgba(0, 136, 204, 0.35)';
      alertaPlat.style.color = '#4da6ff';
      alertaPlat.innerHTML = '<strong>● MTProto Nativo:</strong> Subida binaria directa a Telegram mediante grammers_client en Rust. Sin navegador ni consumo de memoria gráfica.';
    } else if (plat === 'facebook') {
      alertaPlat.style.display = 'block';
      alertaPlat.style.background = 'rgba(24, 119, 242, 0.12)';
      alertaPlat.style.border = '1px solid rgba(24, 119, 242, 0.35)';
      alertaPlat.style.color = '#4da6ff';
      alertaPlat.innerHTML = '<strong>● Conexión CDP:</strong> Publicación asistida a través del protocolo Chrome DevTools Protocol con sesión segura persistente.';
    } else {
      alertaPlat.style.display = 'block';
      alertaPlat.style.background = 'rgba(245, 158, 11, 0.12)';
      alertaPlat.style.border = '1px solid rgba(245, 158, 11, 0.35)';
      alertaPlat.style.color = 'var(--amber)';
      alertaPlat.innerHTML = `<strong>⏳ En espera de conexión con backend:</strong> El publicador de ${nombrePlat} está tipado en el trait de Rust pero no cuenta con API habilitada en este momento.`;
    }
  }

  if (btnConfirmar) {
    if (plat === 'telegram') {
      btnConfirmar.className = 'btn bp btn-telegram';
      btnConfirmar.disabled = false;
      btnConfirmar.innerHTML = `<img src="iconos/telegram.svg" class="icono-svg-sm" /> Publicar en Telegram HD`;
    } else if (plat === 'facebook') {
      btnConfirmar.className = 'btn bp';
      btnConfirmar.disabled = false;
      btnConfirmar.innerHTML = `<img src="iconos/facebook.svg" class="icono-svg-sm" /> Publicar en Facebook`;
    } else {
      btnConfirmar.className = 'btn bs';
      btnConfirmar.disabled = true;
      btnConfirmar.innerHTML = `<img src="iconos/${plat || 'pipeline'}.svg" class="icono-svg-sm" /> En Espera de Conexión (${nombrePlat})`;
    }
  }

  abrirModal('m-publicar-activo');
}

async function confirmarPublicacionDirecta() {
  if (!videoPendientePublicar) {
    mostrarToast('warning', 'No hay un video activo seleccionado.');
    cerrarModal('m-publicar-activo');
    return;
  }

  const v = videoPendientePublicar;
  const plat = plataformaPendientePublicar || 'telegram';
  const elModo = document.querySelector('input[name="m-pub-modo"]:checked');
  const modo = elModo ? elModo.value : 'completo';
  const canal = document.getElementById('m-pub-canal')?.value?.trim() || '';
  const modoBrowser = document.getElementById('m-pub-modo-browser')?.value || 'visible';
  const isHeadless = (modoBrowser === 'headless' || modoBrowser === 'invisible');

  if (plat !== 'telegram' && plat !== 'facebook') {
    mostrarToast('warning', `La plataforma ${plat.toUpperCase()} se encuentra en espera de integración con backend de Rust.`);
    cerrarModal('m-publicar-activo');
    return;
  }

  cerrarModal('m-publicar-activo');
  const etiquetaModo = plat === 'telegram' ? 'MTProto Nativo' : (isHeadless ? 'Invisible CDP' : 'Visible CDP');
  mostrarToast('info', `Iniciando publicación de "${escapeHtml(v.titulo)}" en ${plat.toUpperCase()} (${modo.toUpperCase()}, ${etiquetaModo})...`);

  try {
    const res = await fetch(API_BASE + '/api/publicar/individual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_video: v.id,
        plataforma: plat,
        modo: modo,
        canal: canal,
        modo_browser: modoBrowser,
        headless: isHeadless
      })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Publicación en ${plat.toUpperCase()} iniciada exitosamente (${etiquetaModo}).`);
      App.fases[3] = 'running';
      setFaseUI(3, 'running', `Publicando (${plat.toUpperCase()})...`);
      document.getElementById('fc3')?.classList.add('active-c');
      setSysUI('running', `Publicación directa en ${plat.toUpperCase()} en ejecución`);

      // Sondeo para actualizar la tarjeta a "Publicado" tan pronto termine
      let intentosPub = 0;
      const checkerPub = setInterval(async () => {
        intentosPub++;
        await cargarGaleriaDesdeServidor();
        const vidActual = App.galeria.find(g => g.id === v.id);
        if (vidActual && vidActual.publicado_telegram) {
          clearInterval(checkerPub);
          faseFin(3);
          mostrarToast('success', `¡"${escapeHtml(v.titulo)}" publicado exitosamente en Telegram!`);
        } else if (intentosPub >= 75) {
          clearInterval(checkerPub);
          setFaseUI(3, 'idle', 'Inactiva');
          App.fases[3] = 'idle';
        }
      }, 4000);
    } else {
      mostrarToast('error', `Error al publicar: ${data.error || 'Desconocido'}`);
    }
  } catch (err) {
    mostrarToast('error', `Error al comunicarse con el servidor: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────
// BIBLIOTECA LATERAL DEL ESTUDIO
// ─────────────────────────────────────────────────────────

function renderEstudioPlaylist(videos) {
  const contenedor = document.getElementById('estudio-playlist-container');
  const badgeTotal = document.getElementById('estudio-total-badge');
  if (!contenedor) return;

  const cantTotal = App.galeria.length;
  if (badgeTotal) {
    if (videos && videos.length < cantTotal) {
      badgeTotal.textContent = `${videos.length}/${cantTotal} videos`;
    } else {
      badgeTotal.textContent = `${videos ? videos.length : 0} video(s)`;
    }
  }

  if (!videos || videos.length === 0) {
    contenedor.innerHTML = '<div class="td-empty" style="padding:16px;text-align:center;font-size:12px;color:var(--txt3)">No se encontraron videos disponibles con los filtros actuales.<br><button class="btn bd bsm" style="margin-top:8px" onclick="limpiarTodosFiltros()">Mostrar todos</button></div>';
    return;
  }

  const idActivo = App.estudio.videoActivo ? App.estudio.videoActivo.id : null;

  const prevScroll = contenedor.scrollTop;

  contenedor.innerHTML = videos.map((v, i) => {
    const actualIdx = App.playlist.findIndex(x => x.id === v.id);
    const resolvedIdx = actualIdx >= 0 ? actualIdx : i;
    const isActive = idActivo ? (v.id === idActivo) : (actualIdx === App.estudio.idx);
    const tituloEsc = escapeHtml(v.titulo);
    const videoIdEsc = escapeHtml(v.id);
    const estadoReal = v.publicado_telegram ? 'publicado' : v.estado;
    const b = estadoBadge[estadoReal] || estadoBadge.descargado;
    return `
      <div class="estudio-pl-item ${isActive ? 'active' : ''}" data-id="${videoIdEsc}" onclick="cargarVideoEnEstudio(${resolvedIdx}, true)" title="${tituloEsc}">
        <span class="estudio-pl-num">${isActive ? '<img src="iconos/play.svg" class="icono-svg-sm" />' : '#' + (i+1)}</span>
        <div class="estudio-pl-info">
          <div class="estudio-pl-title">${tituloEsc}</div>
          <div class="estudio-pl-meta">
            <span>${v.dur || '0:00'}</span>
            <span>•</span>
            <span>${v.tamano || ''}</span>
            <span>•</span>
            <span style="color:${b.color};display:inline-flex;align-items:center;gap:3px"><img src="iconos/${b.ico || 'videos.svg'}" class="icono-svg-sm" style="width:10px;height:10px" /> ${b.label}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  contenedor.scrollTop = prevScroll;
  requestAnimationFrame(() => {
    if (contenedor) contenedor.scrollTop = prevScroll;
  });
}

function filtrarVideosEstudio(val) {
  if (val !== undefined) {
    App.filtros.busqueda = (val || '').trim();
  } else {
    const inSearch = document.getElementById('estudio-input-busqueda');
    if (inSearch) App.filtros.busqueda = inSearch.value.trim();
  }
  aplicarFiltrosYRenderizar();
}

function togglePlay() {
  const v = document.getElementById('pip-video');
  if (v && v.src && v.readyState > 0) {
    v.paused ? v.play() : v.pause();
  } else {
    const btn = document.getElementById('pip-play-btn');
    if (simTimer) { clearInterval(simTimer); simTimer = null; if(btn) btn.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" />'; }
    else {
      const vid = App.playlist[App.pip.idx];
      if (vid) simularReproduccion(vid.durSec);
      if(btn) btn.innerHTML = '<img src="iconos/pausa.svg" class="icono-svg-sm" />';
    }
  }
}

function pip10Back()  { const v = document.getElementById('pip-video'); if (v && v.src) v.currentTime -= 10; }
function pip10Fwd()   { const v = document.getElementById('pip-video'); if (v && v.src) v.currentTime += 10; }
function pipPrev()    { cargarVideo(Math.max(0, App.pip.idx - 1)); }
function pipNext()    { cargarVideo(Math.min(App.playlist.length - 1, App.pip.idx + 1)); }
function setVol(val)  { const v = document.getElementById('pip-video'); if(v) v.volume = val; const b = document.getElementById('pip-mute-btn'); if(b) b.innerHTML = val==0 ? '<img src="iconos/audio.svg" class="icono-svg-sm" style="opacity:0.35" />' : '<img src="iconos/audio.svg" class="icono-svg-sm" />'; }
function toggleMute() { const v = document.getElementById('pip-video'); if(v) { v.muted = !v.muted; const b = document.getElementById('pip-mute-btn'); if(b) b.innerHTML = v.muted ? '<img src="iconos/audio.svg" class="icono-svg-sm" style="opacity:0.35" />' : '<img src="iconos/audio.svg" class="icono-svg-sm" />'; } }

function cycleSpeed() {
  App.pip.speedIdx = (App.pip.speedIdx + 1) % App.pip.speeds.length;
  const s = App.pip.speeds[App.pip.speedIdx];
  const v = document.getElementById('pip-video');
  if (v) v.playbackRate = s;
  const spd = document.getElementById('pip-spd');
  if (spd) spd.textContent = s + 'x';
}

function seekVideo(e) {
  const track = e.currentTarget.querySelector('.pip-progress-track');
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const v = document.getElementById('pip-video');
  if (v && v.duration) { v.currentTime = v.duration * pct; }
  const elFill = document.getElementById('pip-prog-fill');
  const elThumb = document.getElementById('pip-prog-thumb');
  if (elFill) elFill.style.width = (pct*100)+'%';
  if (elThumb) elThumb.style.left = (pct*100)+'%';
}

let _ultimoSegundoPip = -1;
function updateProgress() {
  const v = document.getElementById('pip-video');
  if (!v || !v.duration) return;
  const pct = (v.currentTime / v.duration) * 100;
  const elFill = document.getElementById('pip-prog-fill');
  const elThumb = document.getElementById('pip-prog-thumb');
  if (elFill) elFill.style.width = pct + '%';
  if (elThumb) elThumb.style.left = pct + '%';

  const secInt = Math.floor(v.currentTime);
  if (secInt !== _ultimoSegundoPip) {
    _ultimoSegundoPip = secInt;
    const elCur = document.getElementById('pip-cur');
    if (elCur) elCur.textContent = fmtTime(v.currentTime);
  }
}

function onVideoLoaded() {
  const v = document.getElementById('pip-video');
  const poster = document.getElementById('pip-poster');
  const elDur = document.getElementById('pip-dur');
  if (poster) poster.style.display = 'none';
  if (v && elDur) elDur.textContent = fmtTime(v.duration);
  if (v) v.play().catch(e => {});
}

function fmtTime(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return m + ':' + String(sec).padStart(2,'0');
}

// ────────────────────────────────────────────
