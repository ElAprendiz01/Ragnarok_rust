// ============================================================================
// MODULO: 07_reproductor_pip.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

// ────────────────────────────────────────────
// PiP PLAYER (WIDGET FLOTANTE)
// ────────────────────────────────────────────
function buildPlaylist(lista) {
  App.playlist = lista.map((v,i) => ({ ...v, idx: i }));
}

function renderPipPlaylist() {
  const el = document.getElementById('pip-playlist');
  if (!el) return;
  el.innerHTML = App.playlist.map((v,i) => {
    const tituloEsc = escapeHtml(v.titulo);
    return `
    <div class="pip-pl-item ${i === App.pip.idx ? 'active' : ''}" onclick="cargarVideo(${i})" id="ppl-${i}" title="${tituloEsc}">
      <span class="pip-pl-num">${i+1}</span>
      <span class="pip-pl-ico"><img src="iconos/play.svg" class="icono-svg-sm" /></span>
      <div class="pip-pl-info">
        <div class="pip-pl-title">${tituloEsc}</div>
        <div class="pip-pl-dur">${v.dur || '0:00'} · ${v.partes || 1} partes</div>
      </div>
    </div>`;
  }).join('');
}

function abrirEnPiP(idx) {
  App.pip.idx = idx;
  mostrarPiP();
  cargarVideo(idx);
  addLog('info', `Reproduciendo en PiP: <span class="hl">${escapeHtml(App.playlist[idx]?.titulo)}</span>`);
}

function cargarVideo(idx) {
  if (idx < 0 || idx >= App.playlist.length) return;
  App.pip.idx = idx;
  const v = App.playlist[idx];
  const elTitle = document.getElementById('pip-title');
  if (elTitle) elTitle.textContent = v.titulo;
  const video = document.getElementById('pip-video');
  const poster = document.getElementById('pip-poster');

  if (v.url_stream) {
    if (video) video.src = API_BASE + v.url_stream;
    if (poster) poster.style.display = 'none';
    if (video) video.play().catch(e => {});
  } else {
    if (video) video.src = '';
    if (poster) {
      poster.style.display = 'flex';
      const emptyTxt = poster.querySelector('.pip-empty-txt');
      if (emptyTxt) {
        emptyTxt.innerHTML = `
          <strong style="color:var(--cyan);font-size:13px">${escapeHtml(v.titulo)}</strong><br>
          <span style="color:var(--txt3)">${v.dur || 'N/A'} · ${v.tamano || ''} · ${v.partes || 1} partes</span><br><br>
          <span style="color:var(--amber);font-size:11px">[Stream no disponible o archivo en procesamiento]</span>`;
      }
    }
  }

  document.querySelectorAll('.pip-pl-item').forEach((el,i) => {
    el.classList.toggle('active', i === idx);
  });

  const elDur = document.getElementById('pip-dur');
  const elFill = document.getElementById('pip-prog-fill');
  const elThumb = document.getElementById('pip-prog-thumb');
  const elCur = document.getElementById('pip-cur');
  const elPlayBtn = document.getElementById('pip-play-btn');

  if (elDur) elDur.textContent = v.dur || '0:00';
  if (elFill) elFill.style.width = '0%';
  if (elThumb) elThumb.style.left = '0%';
  if (elCur) elCur.textContent = '0:00';
  if (elPlayBtn) elPlayBtn.innerHTML = v.url_stream 
    ? '<img src="iconos/pausa.svg" class="icono-svg-sm" />' 
    : '<img src="iconos/play.svg" class="icono-svg-sm" />';
}

function mostrarPiP() {
  App.pip.visible = true;
  const pip = document.getElementById('pip-player');
  if (pip) {
    pip.classList.remove('oculto-total');
    pip.classList.add('visible');
  }
  addLog('info','Reproductor flotante PiP activado.');
}

// ─────────────────────────────────────────────────────────
// CIERRE CON 'X': LIBERACIÓN TOTAL DE MEMORIA Y PAUSA REAL
// ─────────────────────────────────────────────────────────
function cerrarPiP() {
  App.pip.visible = false;
  const pip = document.getElementById('pip-player');
  if (pip) {
    pip.classList.remove('visible');
    pip.classList.add('oculto-total');
  }

  // Desconectar video para liberar RAM del decodificador del navegador
  const v = document.getElementById('pip-video');
  if (v) {
    v.pause();
    v.currentTime = 0;
    v.removeAttribute('src');
    v.load();
  }

  const fill = document.getElementById('pip-prog-fill');
  const thumb = document.getElementById('pip-prog-thumb');
  const cur = document.getElementById('pip-cur');
  const playBtn = document.getElementById('pip-play-btn');
  if (fill) fill.style.width = '0%';
  if (thumb) thumb.style.left = '0%';
  if (cur) cur.textContent = '0:00';
  if (playBtn) playBtn.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" />';

  mostrarToast('info', 'Reproductor flotante cerrado y memoria liberada.');
}

function togglePiP() {
  if (App.pip.visible) cerrarPiP();
  else {
    if (App.playlist.length > 0) { abrirEnPiP(App.pip.idx); }
    else { mostrarPiP(); }
  }
}

let pipMinimized = false;
function pipMinimize() {
  pipMinimized = !pipMinimized;
  const ctrl = document.getElementById('pip-controls');
  const pl = document.getElementById('pip-playlist');
  const vw = document.getElementById('pip-video-wrap');
  [ctrl, pl, vw].forEach(el => { if(el) el.style.display = pipMinimized ? 'none' : ''; });
  const btn = document.querySelector('.pip-act-btn[title="Minimizar"]');
  if (btn) btn.textContent = pipMinimized ? '⬆' : '—';
}

function pipExpand() {
  // Al pulsar expandir en el widget flotante, transicionar directamente al Estudio Cinema
  cerrarPiP();
  abrirEnEstudio(App.pip.idx);
}

// ─────────────────────────────────────────────────────────


// DRAG DEL PiP
// ────────────────────────────────────────────
function initDrag() {
  const pip = document.getElementById('pip-player');
  const handle = document.getElementById('pip-drag');
  if (!pip || !handle) return;
  let dragging = false, startX, startY, startR, startB;

  handle.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = pip.getBoundingClientRect();
    startR = window.innerWidth - rect.right;
    startB = window.innerHeight - rect.bottom;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = startX - e.clientX, dy = startY - e.clientY;
    pip.style.right = Math.max(0, startR + dx) + 'px';
    pip.style.bottom = Math.max(0, startB + dy) + 'px';
  });

  document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
}

// ────────────────────────────────────────────
