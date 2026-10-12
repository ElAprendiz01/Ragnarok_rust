// ============================================================================
// MODULO: 01_core_estado.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

// ────────────────────────────────────────────
// CONFIGURACIÓN API BASE
// ────────────────────────────────────────────
window.__RAGNAROK_MODULOS_CARGADOS__ = true;

const API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') 
  ? '' 
  : 'http://127.0.0.1:5757';

// ────────────────────────────────────────────
// ESTADO GLOBAL
// ────────────────────────────────────────────
const App = {
  fases: { 1:'idle', 2:'idle', 3:'idle', 4:'idle' },
  timers: { 1:null, 2:null, 3:null, 4:null },
  pip: { visible:false, minimized:false, idx:0, speeds:[0.5,1.0,1.25,1.5,2.0], speedIdx:1 },
  estudio: { idx: 0, modoTeatro: false, speed: 1.0, videoActivo: null },
  playlist: [],
  galeria: [],
  metaDebounceTimer: null,
  canalesTelegram: [],
  canalTelegramActivo: '',
  filtros: {
    estado: 'all',
    soloHoy: false,
    orden: 'recientes',
    busqueda: ''
  }
};

// Utilidad para evitar que comillas o caracteres especiales rompan atributos y HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.galeria = [];
  App.playlist = [];

  const hoy = new Date();
  const man = new Date(hoy.getTime() + 86400000);
  const elFecha = document.getElementById('sc-fecha');
  if (elFecha) elFecha.value = man.toISOString().split('T')[0];

  setInterval(tickClock, 1000);

  // Solución RIESGO-09: Control inteligente de sondeo con Page Visibility API
  let timerEstado = setInterval(refrescarEstadoAutomatico, 3000);
  let timerCookies = setInterval(cargarEstadoCookies, 6000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (timerEstado) { clearInterval(timerEstado); timerEstado = null; }
      if (timerCookies) { clearInterval(timerCookies); timerCookies = null; }
    } else {
      // Sincronización inmediata al volver a la pestaña
      refrescarEstadoAutomatico();
      cargarEstadoCookies();
      if (!timerEstado) timerEstado = setInterval(refrescarEstadoAutomatico, 3000);
      if (!timerCookies) timerCookies = setInterval(cargarEstadoCookies, 6000);
    }
  });

  addLog('info', 'Panel de Control Ragnarok iniciado. Sincronizando con servidor local...');
  cargarGaleriaDesdeServidor();
  cargarConfiguracionCanalTelegram();
  cargarEstadoCookies();
  cargarFuentesDesdeServidor();
  cargarPendientesDesdeServidor();
  tickClock();

  // Eventos del video PiP
  const v = document.getElementById('pip-video');
  if (v) {
    v.addEventListener('timeupdate', updateProgress);
    v.addEventListener('loadedmetadata', onVideoLoaded);
    v.addEventListener('ended', () => { pipNext(); });
    v.addEventListener('play', () => { const b = document.getElementById('pip-play-btn'); if(b) b.innerHTML = '<img src="iconos/pausa.svg" class="icono-svg-sm" />'; });
    v.addEventListener('pause', () => { const b = document.getElementById('pip-play-btn'); if(b) b.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" />'; });
  }

  // Eventos del video Estudio
  const ve = document.getElementById('estudio-video');
  if (ve) {
    ve.addEventListener('timeupdate', estudioUpdateProgress);
    ve.addEventListener('loadedmetadata', estudioOnVideoLoaded);
    ve.addEventListener('ended', () => { estudioNext(); });
    ve.addEventListener('play', () => { const b = document.getElementById('estudio-play-btn'); if(b) b.innerHTML = '<img src="iconos/pausa.svg" class="icono-svg-sm" />'; });
    ve.addEventListener('pause', () => { const b = document.getElementById('estudio-play-btn'); if(b) b.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" />'; });
  }

  // Drag del PiP
  initDrag();
});

function tickClock() {
  const t = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const elTime = document.getElementById('upd-time');
  if (elTime) elTime.textContent = `Actualizado: ${t}`;
}

// ────────────────────────────────────────────
// NAVEGACIÓN DE PÁGINAS
// ────────────────────────────────────────────
function navTo(pg, btn) {
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const isDashRelated = (pg === 'dash' || pg === 'fases' || pg === 'sched' || pg === 'plat');
  const elDash = document.getElementById('pg-dash');
  const elVids = document.getElementById('pg-videos');
  const elEstudio = document.getElementById('pg-estudio');

  if (elDash) elDash.style.display = isDashRelated ? 'block' : 'none';
  if (elVids) {
    elVids.classList.toggle('pg-hidden', pg !== 'videos');
    elVids.style.display = pg === 'videos' ? 'block' : 'none';
  }
  if (elEstudio) {
    elEstudio.classList.toggle('pg-hidden', pg !== 'estudio');
    elEstudio.style.display = pg === 'estudio' ? 'block' : 'none';
  }
  const titles = {
    dash: 'Dashboard',
    estudio: 'Estudio de Reproducción & Publicación',
    videos: 'Mis Videos',
    fases: 'Control Fases',
    sched: 'Programación',
    plat: 'Plataformas'
  };
  const elTitle = document.getElementById('pg-title');
  if (elTitle) elTitle.textContent = titles[pg] || '';
  
  if (pg === 'videos') {
    cargarGaleriaDesdeServidor();
  } else if (pg === 'estudio') {
    if (App.galeria.length > 0 && App.estudio.videoActivo === null) {
      prepararVideoEnEstudio(0);
    }
    renderEstudioPlaylist(obtenerVideosFiltrados());
    sincronizarControlesFiltros();
    actualizarEtiquetasFiltros(obtenerVideosFiltrados().length, App.galeria.length);
  } else if (pg === 'fases') {
    document.querySelector('.fu3')?.scrollIntoView({ behavior: 'smooth' });
  } else if (pg === 'sched' || pg === 'plat') {
    document.querySelector('.fu4')?.scrollIntoView({ behavior: 'smooth' });
  }
}

let ultimaCantVideosLogueada = -1;



function abrirModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.style.display = 'flex';
    m.classList.add('open');
  }
}

function cerrarModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('open');
    m.style.display = 'none';
  }
}

/**
 * Muestra un cuadro de confirmación modal interactivo de alta definición y estética Obsidian.
 * Reemplaza los confirm/alert nativos con una experiencia visual profesional.
 * Retorna una Promise<boolean> que resuelve a true al confirmar o false al cancelar.
 */
function mostrarModalConfirmacion({
  tag = 'PURGA PERMANENTE DE DISCO',
  titulo = '¿Eliminar Video y Metadatos JSON?',
  subtitulo = 'Esta acción purgará físicamente el archivo original, todos los clips y la configuración JSON.',
  itemTitulo = '',
  itemId = '',
  detalles = [],
  nota = 'El espacio en disco se liberará de inmediato. Esta acción no se puede deshacer.',
  textoConfirmar = 'Eliminar Permanentemente',
  icono = 'eliminar.svg',
  peligro = true
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('m-confirm-custom');
    if (!overlay) {
      resolve(window.confirm(`${titulo}\n\n${itemTitulo}\n\n${subtitulo}`));
      return;
    }

    const elTag = document.getElementById('m-confirm-tag');
    const elTitulo = document.getElementById('m-confirm-titulo');
    const elSub = document.getElementById('m-confirm-sub');
    const elItemTitulo = document.getElementById('m-confirm-item-titulo');
    const elItemId = document.getElementById('m-confirm-item-id');
    const elDetalles = document.getElementById('m-confirm-detalles');
    const elNota = document.getElementById('m-confirm-nota');
    const btnConfirm = document.getElementById('m-confirm-btn-action');
    const btnCancel = document.getElementById('m-confirm-btn-cancel');
    const elIcono = document.getElementById('m-confirm-icon-img');

    if (elTag) elTag.textContent = tag;
    if (elTitulo) elTitulo.textContent = titulo;
    if (elSub) elSub.textContent = subtitulo;
    if (elItemTitulo) elItemTitulo.textContent = itemTitulo || 'Elemento seleccionado';
    if (elItemId) {
      if (itemId) {
        elItemId.textContent = `ID: ${itemId}`;
        elItemId.style.display = 'inline-block';
      } else {
        elItemId.style.display = 'none';
      }
    }

    if (elDetalles) {
      if (detalles && detalles.length > 0) {
        elDetalles.innerHTML = detalles.map(d => `
          <div class="confirm-detail-row">
            <span class="confirm-detail-bullet"></span>
            <span class="confirm-detail-label">${escapeHtml(d.label || '')}:</span>
            <span class="confirm-detail-desc">${escapeHtml(d.desc || '')}</span>
          </div>
        `).join('');
        elDetalles.style.display = 'flex';
      } else {
        elDetalles.style.display = 'none';
      }
    }

    if (elNota) elNota.textContent = nota;
    if (elIcono && icono) elIcono.src = `iconos/${icono}`;
    if (btnConfirm) {
      btnConfirm.innerHTML = `<img src="iconos/${icono}" class="icono-svg-sm" /> ${escapeHtml(textoConfirmar)}`;
    }

    function cleanup() {
      overlay.classList.remove('open');
      document.removeEventListener('keydown', onKeyDown);
      overlay.removeEventListener('click', onBackdropClick);
      if (btnConfirm) btnConfirm.removeEventListener('click', onConfirm);
      if (btnCancel) btnCancel.removeEventListener('click', onCancel);
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 240);
    }

    function onConfirm(e) {
      if (e) e.stopPropagation();
      cleanup();
      resolve(true);
    }

    function onCancel(e) {
      if (e) e.stopPropagation();
      cleanup();
      resolve(false);
    }

    function onBackdropClick(e) {
      if (e.target === overlay) {
        onCancel(e);
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel(e);
      }
    }

    if (btnConfirm) btnConfirm.addEventListener('click', onConfirm, { once: true });
    if (btnCancel) btnCancel.addEventListener('click', onCancel, { once: true });
    overlay.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown);

    overlay.style.display = 'flex';
    void overlay.offsetWidth; // Forzar repintado para transición CSS fluida
    overlay.classList.add('open');
    if (btnCancel) btnCancel.focus();
  });
}



// ────────────────────────────────────────────
// LOG DE ACTIVIDAD
// ────────────────────────────────────────────
function addLog(tipo, msg) {
  const bd = document.getElementById('log-bd');
  if (!bd) return;
  while (bd.childNodes.length > 200) {
    bd.removeChild(bd.firstChild);
  }
  const t = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const lbl = {info:'INFO',ok:'OK',warn:'AVISO',err:'ERROR'};
  const div = document.createElement('div');
  div.className = 'le';
  div.innerHTML = `<span class="lt">${horaActualOSegura(t)}</span><span class="ltag ${tipo}">${lbl[tipo]||'INFO'}</span><span class="lm">${msg}</span>`;
  bd.appendChild(div);
  bd.scrollTop = bd.scrollHeight;
}
function horaActualOSegura(t) { return t; }
function limpiarLog() { const bd = document.getElementById('log-bd'); if(bd) bd.innerHTML=''; addLog('info','Log limpiado.'); }
function verLogFase(n) { addLog('info',`Consultando log detallado de la Fase <span class="hl">${n}</span>...`); mostrarToast('success',`Log Fase ${n} consultado.`); }

// ────────────────────────────────────────────
// TOASTS
// ────────────────────────────────────────────
function mostrarToast(tipo, msg) {
  const tc = document.getElementById('tc');
  if (!tc) return;
  const ic = {
    success: '<img src="iconos/check.svg" class="icono-svg-sm" />',
    warning: '<img src="iconos/alerta.svg" class="icono-svg-sm" />',
    error: '<img src="iconos/error.svg" class="icono-svg-sm" />',
    info: '<img src="iconos/pipeline.svg" class="icono-svg-sm" />'
  };
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span>${ic[tipo] || '<img src="iconos/pipeline.svg" class="icono-svg-sm" />'}</span><span>${msg}</span>`;
  tc.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all .3s';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
