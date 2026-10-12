// ────────────────────────────────────────────
// CONFIGURACIÓN API BASE
// ────────────────────────────────────────────
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
  setInterval(refrescarEstadoAutomatico, 3000);
  setInterval(cargarEstadoCookies, 6000);

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

async function cargarGaleriaDesdeServidor() {
  try {
    const res = await fetch(API_BASE + '/api/videos');
    if (!res.ok) return;
    const data = await res.json();
    if (data.videos) {
      App.galeria = data.videos;
      buildPlaylist(App.galeria);
      aplicarFiltrosYRenderizar();
      renderPipPlaylist();
      renderColaVideosDashboard(App.galeria);

      const numDesc = data.videos.filter(v => v.estado === 'descargado').length;
      const numEdit = data.videos.filter(v => v.estado === 'editado').length;
      const numPub = data.videos.filter(v => v.publicado_telegram || v.estado === 'publicado').length;
      const numPend = Math.max(0, data.videos.length - numPub);

      const elDesc = document.getElementById('s-desc');
      const elClips = document.getElementById('s-clips');
      const elPub = document.getElementById('s-pub');
      if (elDesc) elDesc.textContent = numDesc;
      if (elClips) elClips.textContent = numEdit;
      if (elPub) elPub.textContent = numPub;

      // Actualizar contadores y porcentaje de Fase 4 (Telegram)
      const elF4c = document.getElementById('f4c');
      const elF4p = document.getElementById('f4p');
      const elF4pct = document.getElementById('f4pct');
      const elF4b = document.getElementById('f4b');

      if (elF4c) elF4c.textContent = numPub;
      if (elF4p) elF4p.textContent = numPend;
      if (elF4pct && App.fases[4] !== 'running') {
        const pctTg = data.videos.length > 0 ? Math.round((numPub / data.videos.length) * 100) : 0;
        elF4pct.textContent = pctTg + '%';
        if (elF4b) elF4b.style.width = pctTg + '%';
      }

      if (App.estudio.videoActivo === null && App.galeria.length > 0) {
        prepararVideoEnEstudio(0);
      }

      if (ultimaCantVideosLogueada !== data.videos.length) {
        ultimaCantVideosLogueada = data.videos.length;
        addLog('ok', `Biblioteca sincronizada con disco: <span class="hl">${data.videos.length} video(s)</span> (${numPub} en Telegram, ${numPend} pendientes)`);
      }
    }
  } catch(e) {}
}

async function ejecutarPublicacionIndividual(plat, modoBrowser = 'visible') {
  const isHeadless = (modoBrowser === 'headless' || modoBrowser === 'invisible');
  const etiquetaModo = isHeadless ? 'Modo Invisible (Headless)' : 'Modo Visible (Headed)';
  mostrarToast('info', `Iniciando publicación en ${plat.toUpperCase()} (${etiquetaModo})...`);
  try {
    const res = await fetch(API_BASE + '/ejecutar/publicar/' + plat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modo_browser: modoBrowser,
        headless: isHeadless
      })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Publicación en ${plat.toUpperCase()} lanzada en segundo plano (${etiquetaModo}).`);
      App.fases[3] = 'running';
      setFaseUI(3, 'running', `Publicando (${plat.toUpperCase()})...`);
      document.getElementById('fc3')?.classList.add('active-c');
      setSysUI('running', `Publicación en ${plat.toUpperCase()} en ejecución`);
    } else {
      mostrarToast('error', `Error: ${data.error}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al conectarse con el servidor.');
  }
}

let fbPollingInterval = null;

function abrirModalFacebook() {
  abrirModal('m-facebook-auth');
  actualizarEstadoModalFacebook();
  verificarEstadoNavegadorFacebook();
}

function cerrarModalFacebook() {
  cerrarModal('m-facebook-auth');
}

async function actualizarEstadoModalFacebook() {
  try {
    const res = await fetch(API_BASE + '/api/cookies');
    if (!res.ok) return;
    const data = await res.json();
    const txtEl = document.getElementById('fb-modal-status-text');
    const badgeEl = document.getElementById('fb-modal-badge');
    if (data.ok && data.cookies && data.cookies.facebook) {
      const fb = data.cookies.facebook;
      if (txtEl) txtEl.textContent = fb.mensaje || (fb.estado === 'ACTIVO' ? 'Sesión Activa' : 'Sin sesión');
      if (badgeEl) {
        if (fb.estado === 'ACTIVO') {
          badgeEl.className = 'tbadge done';
          badgeEl.textContent = 'ACTIVO';
        } else {
          badgeEl.className = 'tbadge pend';
          badgeEl.textContent = 'INACTIVO';
        }
      }
    }
  } catch(e) {}
}

async function verificarEstadoNavegadorFacebook() {
  try {
    const res = await fetch(API_BASE + '/api/facebook/estado_navegador');
    if (!res.ok) return;
    const data = await res.json();
    const boxCerrado = document.getElementById('fb-nav-cerrado-box');
    const boxAbierto = document.getElementById('fb-nav-abierto-box');
    if (data.abierto) {
      if (boxCerrado) boxCerrado.style.display = 'none';
      if (boxAbierto) boxAbierto.style.display = 'block';
    } else {
      if (boxCerrado) boxCerrado.style.display = 'block';
      if (boxAbierto) boxAbierto.style.display = 'none';
    }
  } catch(e) {}
}

async function abrirNavegadorFacebook() {
  const btn = document.getElementById('btn-abrir-fb-nav');
  if (btn) { btn.disabled = true; btn.innerHTML = '<img src="iconos/facebook.svg" class="icono-svg-sm" /> Abriendo navegador seguro...'; }

  mostrarToast('info', 'Abriendo ventana segura de Chrome...');
  addLog('info', '[FACEBOOK] Iniciando navegador seguro con perfil persistente (sin bots)...');

  try {
    const res = await fetch(API_BASE + '/api/facebook/login', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', 'Navegador abierto. Inicia sesión en Facebook normalmente.');
      const boxCerrado = document.getElementById('fb-nav-cerrado-box');
      const boxAbierto = document.getElementById('fb-nav-abierto-box');
      if (boxCerrado) boxCerrado.style.display = 'none';
      if (boxAbierto) boxAbierto.style.display = 'block';
    } else {
      mostrarToast('error', `Error al abrir navegador: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error de conexión con el backend de Ragnarok.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<img src="iconos/facebook.svg" class="icono-svg-sm" /> 🚀 Abrir Navegador para Iniciar Sesión'; }
  }
}

async function capturarSesionFacebook() {
  const btn = document.getElementById('btn-capturar-fb-sesion');
  if (btn) { btn.disabled = true; btn.innerHTML = '<img src="iconos/check.svg" class="icono-svg-sm" /> Verificando sesión en Facebook...'; }

  mostrarToast('info', 'Comprobando sesión en el navegador...');
  addLog('info', '[FACEBOOK] Verificando cookies de autenticación...');

  try {
    const res = await fetch(API_BASE + '/api/facebook/capturar_sesion', { method: 'POST' });
    const data = await res.json();
    if (data.ok && data.logueado) {
      mostrarToast('success', data.mensaje || '¡Sesión de Facebook vinculada exitosamente!');
      addLog('ok', `[FACEBOOK] ¡Sesión vinculada con éxito! Usuario: ${data.usuario_id || 'OK'}`);

      const boxCerrado = document.getElementById('fb-nav-cerrado-box');
      const boxAbierto = document.getElementById('fb-nav-abierto-box');
      if (boxCerrado) boxCerrado.style.display = 'block';
      if (boxAbierto) boxAbierto.style.display = 'none';

      await cargarEstadoCookies();
      await actualizarEstadoModalFacebook();
    } else if (data.logueado === false) {
      mostrarToast('warning', data.mensaje || 'Aún no has completado el inicio de sesión.');
      addLog('warn', `[FACEBOOK] ${data.mensaje || 'Pendiente de inicio de sesión'}`);
    } else {
      mostrarToast('error', data.error || 'No se pudo capturar la sesión.');
      addLog('error', `[FACEBOOK] Error: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al comunicarse con el backend.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<img src="iconos/check.svg" class="icono-svg-sm" /> ✅ Ya entré a mi cuenta — Guardar y Vincular Sesión'; }
  }
}

async function cerrarNavegadorFacebookManual() {
  mostrarToast('info', 'Cerrando ventana del navegador...');
  try {
    await fetch(API_BASE + '/api/facebook/cerrar_navegador', { method: 'POST' });
  } catch(e) {}

  const boxCerrado = document.getElementById('fb-nav-cerrado-box');
  const boxAbierto = document.getElementById('fb-nav-abierto-box');
  if (boxCerrado) boxCerrado.style.display = 'block';
  if (boxAbierto) boxAbierto.style.display = 'none';
  mostrarToast('info', 'Navegador cerrado.');
}

async function abrirFacebookNavegadorLimpio() {
  abrirNavegadorFacebook();
}

async function iniciarSesionFacebookChrome() {
  abrirNavegadorFacebook();
}

async function guardarCookiesFacebookManual() {
  const inputEl = document.getElementById('fb-cookies-json-input');
  if (!inputEl) return;
  const texto = inputEl.value.trim();
  if (!texto) {
    mostrarToast('warning', 'Por favor pega el JSON con las cookies de Facebook.');
    return;
  }

  let cookiesJson;
  try {
    cookiesJson = JSON.parse(texto);
  } catch(e) {
    mostrarToast('error', 'El formato no es un JSON válido. Asegúrate de copiar el JSON completo.');
    return;
  }

  mostrarToast('info', 'Guardando y sincronizando cookies...');
  try {
    const res = await fetch(API_BASE + '/api/facebook/guardar_cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cookiesJson)
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', '¡Cookies de Facebook guardadas y sincronizadas en disco!');
      inputEl.value = '';
      await cargarEstadoCookies();
      await actualizarEstadoModalFacebook();
    } else {
      mostrarToast('error', `Error guardando cookies: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error de conexión con el backend de Ragnarok.');
  }
}

async function iniciarSesionFacebook() {
  abrirModalFacebook();
}

async function iniciarSesionTelegramWeb() {
  abrirModalConfiguracion();
  mostrarToast('info', 'Gestiona tu sesión de Telegram MTProto directamente ingresando tu número y código.');
  setTimeout(() => {
    const el = document.getElementById('cfg-tg-phone');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }, 250);
}

function normalizarCanalTelegram(val) {
  let s = String(val || '').trim();
  if (!s) return '';
  if (s.includes('telegram.org') || s.includes('t.me')) {
    const match = s.match(/(?:#@|#|t\.me\/)([\w_]+)/);
    if (match) s = match[1];
    else s = s.split('/').pop();
  }
  s = s.replace(/^@+/, '').trim();
  return s ? '@' + s : '';
}

async function guardarCanalTelegram() {
  const input = document.getElementById('input-canal-tg');
  if (!input) return;
  const canalRaw = input.value.trim();
  if (!canalRaw) {
    mostrarToast('warning', 'Escribe el nombre, handle o URL del canal de Telegram.');
    return;
  }
  await agregarYGuardarCanalTelegram(canalRaw);
}

async function cargarConfiguracionCanalTelegram() {
  try {
    const res = await fetch(API_BASE + '/config');
    if (!res.ok) return;
    const cfg = await res.json();

    let canales = [];
    if (cfg.canales_telegram && Array.isArray(cfg.canales_telegram)) {
      canales = cfg.canales_telegram;
    } else if (cfg.publicacion && Array.isArray(cfg.publicacion.canales_telegram)) {
      canales = cfg.publicacion.canales_telegram;
    }

    const canalActivo = cfg.canal_telegram || (cfg.publicacion ? cfg.publicacion.canal_telegram : '') || (canales.length > 0 ? canales[0] : '');

    if (canalActivo && !canales.includes(canalActivo)) {
      canales.unshift(canalActivo);
    }

    App.canalesTelegram = canales.map(normalizarCanalTelegram).filter(Boolean);
    App.canalTelegramActivo = normalizarCanalTelegram(canalActivo);

    actualizarVistasCanalTelegram();
  } catch(e) {}
}

function actualizarVistasCanalTelegram() {
  const canalActivo = App.canalTelegramActivo;
  const canales = App.canalesTelegram || [];

  // 1. Inputs y etiquetas principales
  const inputMain = document.getElementById('input-canal-tg');
  const lblMain = document.getElementById('lbl-canal-tg');
  const inputManual = document.getElementById('m-tg-canal-input');
  const inputLote = document.getElementById('m-tg-lote-canal');
  const inputPub = document.getElementById('m-pub-canal');
  const estadoLbl = document.getElementById('m-pub-canal-estado');

  if (inputMain) inputMain.value = canalActivo || '';
  if (lblMain) lblMain.textContent = canalActivo || 'Sin canal configurado';
  if (inputManual) inputManual.value = canalActivo || '';
  if (inputLote) inputLote.value = canalActivo || '';
  if (inputPub) inputPub.value = canalActivo || '';

  if (estadoLbl) {
    if (canalActivo) {
      estadoLbl.textContent = `${canales.length} canal${canales.length > 1 ? 'es' : ''} guardado${canales.length > 1 ? 's' : ''}`;
    } else {
      estadoLbl.textContent = 'Sin canal configurado';
    }
  }

  // Generar HTML de opciones para todos los <select>
  let opcionesHtml = `<option value="">-- Elige un canal guardado (${canales.length}) --</option>`;
  canales.forEach(c => {
    const isSel = c === canalActivo;
    opcionesHtml += `<option value="${escapeHtml(c)}" ${isSel ? 'selected' : ''}>${escapeHtml(c)} ${isSel ? '(Activo)' : ''}</option>`;
  });
  opcionesHtml += '<option value="__nuevo__">+ Escribir otro canal nuevo...</option>';

  // 2. Poblar todos los selectores del sistema
  const selectMain = document.getElementById('select-canal-tg');
  const selectPub = document.getElementById('m-pub-canales-select');
  const selectLote = document.getElementById('m-tg-lote-canal-select');
  const selectManual = document.getElementById('m-tg-canal-select');

  if (selectMain) selectMain.innerHTML = opcionesHtml;
  if (selectPub) selectPub.innerHTML = opcionesHtml;
  if (selectLote) selectLote.innerHTML = opcionesHtml;
  if (selectManual) selectManual.innerHTML = opcionesHtml;

  // 3. Datalist para autocompletado en el input
  const datalist = document.getElementById('m-pub-canales-datalist');
  if (datalist) {
    datalist.innerHTML = canales.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
  }

  // 4. Chips interactivos
  const chipsContainer = document.getElementById('m-pub-canales-chips-container');
  const chipsList = document.getElementById('m-pub-canales-chips');
  if (chipsContainer) chipsContainer.style.display = canales.length > 0 ? 'block' : 'none';
  if (chipsList) {
    chipsList.innerHTML = canales.map(c => {
      const isActivo = c === canalActivo;
      return `
        <span class="tech-chip" style="cursor:pointer;background:${isActivo ? 'rgba(0,210,255,0.18)' : 'var(--bg2)'};border-color:${isActivo ? 'var(--cyan)' : 'var(--border)'};display:inline-flex;align-items:center;gap:5px;padding:3px 8px" onclick="seleccionarCanalDeLista('${escapeHtml(c)}')">
          <img src="iconos/telegram.svg" class="icono-svg-sm" style="width:11px;height:11px" />
          <span style="color:${isActivo ? 'var(--cyan)' : 'var(--txt1)'}">${escapeHtml(c)}</span>
          <span style="color:var(--txt3);font-size:11px;margin-left:3px;cursor:pointer" title="Eliminar canal de la lista" onclick="event.stopPropagation();eliminarCanalTelegram('${escapeHtml(c)}')">✕</span>
        </span>
      `;
    }).join('');
  }
}

function seleccionarCanalDashboard(val) {
  if (val === '__nuevo__') {
    const inp = document.getElementById('input-canal-tg');
    if (inp) { inp.value = '@'; inp.focus(); }
    return;
  }
  if (!val) return;
  seleccionarCanalDeLista(val);
}

function seleccionarCanalModalLote(val) {
  if (val === '__nuevo__') {
    const inp = document.getElementById('m-tg-lote-canal');
    if (inp) { inp.value = '@'; inp.focus(); }
    return;
  }
  if (!val) return;
  seleccionarCanalDeLista(val);
}

function seleccionarCanalModalManual(val) {
  if (val === '__nuevo__') {
    const inp = document.getElementById('m-tg-canal-input');
    if (inp) { inp.value = '@'; inp.focus(); }
    return;
  }
  if (!val) return;
  seleccionarCanalDeLista(val);
}

function seleccionarCanalDeLista(val) {
  if (val === '__nuevo__') {
    const inp = document.getElementById('m-pub-canal') || document.getElementById('input-canal-tg');
    if (inp) { inp.value = '@'; inp.focus(); }
    return;
  }
  if (!val) return;
  const canalNorm = normalizarCanalTelegram(val);
  App.canalTelegramActivo = canalNorm;
  actualizarVistasCanalTelegram();

  fetch(API_BASE + '/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canal_telegram: canalNorm,
      canales_telegram: App.canalesTelegram,
      publicacion: {
        canal_telegram: canalNorm,
        canales_telegram: App.canalesTelegram
      }
    })
  }).catch(() => {});
}

async function guardarCanalRapidoModal() {
  const inputPub = document.getElementById('m-pub-canal');
  if (!inputPub) return;
  const val = inputPub.value.trim();
  if (!val) {
    mostrarToast('warning', 'Escribe un canal de Telegram.');
    return;
  }
  await agregarYGuardarCanalTelegram(val);
}

async function agregarYGuardarCanalTelegram(canalRaw) {
  const canalNorm = normalizarCanalTelegram(canalRaw);
  if (!canalNorm) return;

  if (!App.canalesTelegram.includes(canalNorm)) {
    App.canalesTelegram.push(canalNorm);
  }
  App.canalTelegramActivo = canalNorm;

  try {
    const res = await fetch(API_BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canal_telegram: canalNorm,
        canales_telegram: App.canalesTelegram,
        publicacion: {
          canal_telegram: canalNorm,
          canales_telegram: App.canalesTelegram
        }
      })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Canal guardado en memoria permanente: ${canalNorm}`);
      addLog('ok', `Canal de Telegram guardado en memoria: <span class="hl">${canalNorm}</span>`);
    }
  } catch(e) {}

  actualizarVistasCanalTelegram();
}

async function eliminarCanalTelegram(canal) {
  App.canalesTelegram = App.canalesTelegram.filter(c => c !== canal);
  if (App.canalTelegramActivo === canal) {
    App.canalTelegramActivo = App.canalesTelegram[0] || '';
  }

  try {
    await fetch(API_BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canal_telegram: App.canalTelegramActivo,
        canales_telegram: App.canalesTelegram,
        publicacion: {
          canal_telegram: App.canalTelegramActivo,
          canales_telegram: App.canalesTelegram
        }
      })
    });
    mostrarToast('info', `Canal eliminado: ${canal}`);
    addLog('info', `Canal eliminado de la memoria: <span class="hl">${canal}</span>`);
  } catch(e) {}

  actualizarVistasCanalTelegram();
}

function abrirModalTelegramManual() {
  const modal = document.getElementById('m-telegram-manual');
  if (!modal) return;
  const inputCanal = document.getElementById('m-tg-canal-input');
  const canalActual = document.getElementById('lbl-canal-tg')?.textContent || '';
  if (inputCanal) inputCanal.value = canalActual === 'Sin canal configurado' ? '' : canalActual;

  renderListaVideosModalTelegram();
  abrirModal('m-telegram-manual');
}

function abrirModalTelegramLotes() {
  const modal = document.getElementById('m-telegram-lotes');
  if (!modal) return;
  const inputCanal = document.getElementById('m-tg-lote-canal');
  const canalActual = document.getElementById('lbl-canal-tg')?.textContent || '';
  if (inputCanal) {
    inputCanal.value = (canalActual && canalActual !== 'Sin canal configurado') ? canalActual : (App.canalTelegramActivo || (App.canalesTelegram && App.canalesTelegram[0]) || '');
  }
  const elCant = document.getElementById('m-tg-lote-cant-videos');
  if (elCant) {
    const total = (App.galeria && App.galeria.length) || 0;
    const yaSubidos = (App.galeria && App.galeria.filter(v => v.publicado_telegram).length) || 0;
    const pendientes = Math.max(0, total - yaSubidos);
    elCant.textContent = `${total} en disco (${yaSubidos} ya en Telegram, ${pendientes} pendientes)`;
  }
  abrirModal('m-telegram-lotes');
}

async function guardarCanalTelegramModalLote() {
  const input = document.getElementById('m-tg-lote-canal');
  if (!input) return;
  const canalRaw = input.value.trim();
  if (!canalRaw) {
    mostrarToast('warning', 'Escribe el nombre o handle del canal de Telegram.');
    return;
  }
  await agregarYGuardarCanalTelegram(canalRaw);
}

let _intervaloSondeoLoteTelegram = null;
let _ultimosCompletadosSondeo = -1;

function iniciarSondeoProgresoLoteTelegram() {
  if (_intervaloSondeoLoteTelegram) clearInterval(_intervaloSondeoLoteTelegram);
  _ultimosCompletadosSondeo = -1;
  _intervaloSondeoLoteTelegram = setInterval(async () => {
    try {
      const res = await fetch(API_BASE + '/api/publicar/lote/estado');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;

      const total = data.total || 0;
      const completados = data.completados || 0;
      const fallidos = data.fallidos || 0;
      const pct = total > 0 ? Math.round(((completados + fallidos) / total) * 100) : 0;

      const b = document.getElementById('f4b');
      const p = document.getElementById('f4pct');
      const fc = document.getElementById('f4c');
      const fp = document.getElementById('f4p');

      if (b) b.style.width = pct + '%';
      if (p) p.textContent = pct + '%';
      if (fc) fc.textContent = completados;
      if (fp) fp.textContent = Math.max(0, total - completados);

      // Si subió un nuevo video, refrescar biblioteca para que su tarjeta cambie a verde
      if (_ultimosCompletadosSondeo !== -1 && completados > _ultimosCompletadosSondeo) {
        cargarGaleriaDesdeServidor();
      }
      _ultimosCompletadosSondeo = completados;

      const btnLogDetener = document.getElementById('btn-log-detener-lote');
      const btnModalDetener = document.getElementById('btn-modal-detener-lote');
      if (btnLogDetener) btnLogDetener.style.display = data.activo ? 'inline-flex' : 'none';
      if (btnModalDetener) btnModalDetener.style.display = data.activo ? 'inline-flex' : 'none';

      if (!data.activo) {
        clearInterval(_intervaloSondeoLoteTelegram);
        _intervaloSondeoLoteTelegram = null;
        if (completados > 0 || (total > 0 && fallidos === 0)) {
          faseFin(4);
          mostrarToast('success', `Lote finalizado: ${completados} video(s) subidos a Telegram.`);
          addLog('ok', `Lote Telegram completado: <span class="hl">${completados}/${total}</span> videos subidos.`);
        } else {
          setFaseUI(4, 'idle', 'Inactiva');
          App.fases[4] = 'idle';
        }
        await cargarGaleriaDesdeServidor();
      }
    } catch (e) {
      // Manejo silencioso en sondeo recurrente
    }
  }, 2500);
}

async function detenerLoteTelegram() {
  const conf = await mostrarDialogoConfirmacion({
    titulo: '¿Detener Publicación por Lote?',
    mensaje: 'Se enviará una orden al servidor para detener de forma segura la cola de Telegram.',
    tipo: 'peligro',
    textoConfirmar: 'Detener Lote',
    textoCancelar: 'Continuar Lote'
  });
  if (!conf) return;

  try {
    const res = await fetch(API_BASE + '/api/publicar/lote/detener', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('warning', 'Deteniendo cola de publicación por lote...');
      addLog('warn', 'Solicitud de detención de lote enviada al servidor.');
      setFaseUI(4, 'idle', 'Deteniendo...');
      const btnLogDetener = document.getElementById('btn-log-detener-lote');
      const btnModalDetener = document.getElementById('btn-modal-detener-lote');
      if (btnLogDetener) btnLogDetener.style.display = 'none';
      if (btnModalDetener) btnModalDetener.style.display = 'none';
    }
  } catch(e) {
    mostrarToast('error', 'Error al comunicarse con el servidor.');
  }
}

async function iniciarPublicacionLoteTelegram() {
  const canal = document.getElementById('m-tg-lote-canal')?.value.trim();
  if (!canal) {
    mostrarToast('warning', 'Por favor especifica un canal objetivo de Telegram.');
    return;
  }
  const modoBrowser = document.getElementById('m-tg-lote-browser')?.value || 'visible';
  const modoVideo = document.getElementById('m-tg-lote-modo-video')?.value || 'completo';
  const forzar = document.getElementById('m-tg-lote-forzar')?.checked || false;

  cerrarModal('m-telegram-lotes');
  mostrarToast('info', `Iniciando publicación en lote para ${canal} (${modoBrowser.toUpperCase()}${forzar ? ' - REINICIO TOTAL' : ''})...`);
  addLog('info', `Iniciando cola por lotes Telegram hacia <span class="hl">${escapeHtml(canal)}</span> (Modo: ${modoVideo}, Ventana: ${modoBrowser}${forzar ? ', Forzar: SI' : ''}).`);

  App.fases[4] = 'running';
  setFaseUI(4, 'running', 'Procesando cola en disco (Telegram)...');
  document.getElementById('fc4')?.classList.add('active-c');
  setSysUI('running', 'Publicación en lote Telegram en ejecución');

  try {
    const res = await fetch(API_BASE + '/api/publicar/lote/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canal: canal,
        modo_browser: modoBrowser,
        modo_video: modoVideo,
        forzar: forzar
      })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', 'Cola Zero-RAM iniciada en el servidor.');
      iniciarSondeoProgresoLoteTelegram();
    } else {
      mostrarToast('error', `Error al iniciar lote: ${data.error}`);
      addLog('err', `Error al iniciar lote de Telegram: ${data.error}`);
      setFaseUI(4, 'idle', 'Inactiva');
      App.fases[4] = 'idle';
    }
  } catch (err) {
    mostrarToast('error', `Error al conectar con servidor: ${err.message}`);
    setFaseUI(4, 'idle', 'Inactiva');
    App.fases[4] = 'idle';
  }
}

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

function renderListaVideosModalTelegram() {
  const contenedor = document.getElementById('m-tg-lista-videos');
  if (!contenedor) return;
  if (!App.galeria || App.galeria.length === 0) {
    contenedor.innerHTML = '<div style="color:var(--txt3);font-size:12px;text-align:center;padding:12px">No hay videos disponibles en la biblioteca descargada.</div>';
    return;
  }
  contenedor.innerHTML = App.galeria.map((v, i) => {
    const yaSubido = !!v.publicado_telegram;
    return `
    <label style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer;${yaSubido ? 'opacity:0.65;background:rgba(46,160,67,0.06)' : ''}">
      <input type="checkbox" class="chk-tg-vid" value="${v.id}" data-num="${i+1}" ${yaSubido ? '' : 'checked'}>
      <span style="color:var(--cyan);font-weight:700">#${i+1}</span>
      <img src="iconos/play.svg" class="icono-svg-sm" style="opacity:0.75" />
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${v.titulo}">${v.titulo}</span>
      ${yaSubido ? '<span style="color:#2ea043;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid rgba(46,160,67,0.3);background:rgba(46,160,67,0.1)">✓ Ya en Telegram</span>' : ''}
      <span style="color:var(--txt3);font-size:11px">${v.dur || 'Original'}</span>
    </label>
  `;
  }).join('');
}

function filtrarCasillasPorNumeros(valStr) {
  if (!valStr || !valStr.trim()) {
    document.querySelectorAll('.chk-tg-vid').forEach(c => c.checked = true);
    return;
  }
  const nums = valStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  document.querySelectorAll('.chk-tg-vid').forEach(chk => {
    const n = parseInt(chk.getAttribute('data-num'));
    chk.checked = nums.includes(n);
  });
}

async function guardarCanalTelegramModal() {
  const input = document.getElementById('m-tg-canal-input');
  if (!input) return;
  const val = input.value.trim();
  if (val) {
    const inputMain = document.getElementById('input-canal-tg');
    if (inputMain) inputMain.value = val;
    await guardarCanalTelegram();
  }
}

async function publicarSeleccionTelegramModal() {
  const seleccionados = Array.from(document.querySelectorAll('.chk-tg-vid:checked')).map(c => c.value);
  if (seleccionados.length === 0) {
    mostrarToast('warning', 'Selecciona al menos un video por número o casilla.');
    return;
  }
  const modoBrowser = document.getElementById('m-tg-modo-browser')?.value || 'visible';
  const canalInput = document.getElementById('m-tg-canal-input')?.value.trim() || App.canalTelegramActivo;
  cerrarModal('m-telegram-manual');

  mostrarToast('info', `Iniciando cola de ${seleccionados.length} video(s) seleccionado(s) en Telegram Web...`);
  addLog('info', `Iniciando cola de <span class="hl">${seleccionados.length}</span> videos seleccionados en Telegram hacia <span class="hl">${escapeHtml(canalInput || 'Canal Configurado')}</span>.`);

  App.fases[4] = 'running';
  setFaseUI(4, 'running', `Publicando selección (${seleccionados.length} videos)...`);
  document.getElementById('fc4')?.classList.add('active-c');
  setSysUI('running', 'Publicación manual Telegram en ejecución');

  try {
    const res = await fetch(API_BASE + '/api/publicar/lote/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canal: canalInput,
        modo_browser: modoBrowser,
        modo_video: 'completo',
        ids: seleccionados
      })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', 'Cola de videos seleccionados iniciada en segundo plano.');
      iniciarSondeoProgresoLoteTelegram();
    } else {
      mostrarToast('error', `Error: ${data.error}`);
      setFaseUI(4, 'idle', 'Inactiva');
      App.fases[4] = 'idle';
    }
  } catch(e) {
    mostrarToast('error', 'Error al conectarse con el servidor.');
    setFaseUI(4, 'idle', 'Inactiva');
    App.fases[4] = 'idle';
  }
}


function toggleDropMenu(btn) {
  const menu = btn.nextElementSibling;
  const wasVisible = menu.style.display === 'block';
  document.querySelectorAll('.dropdown-content').forEach(m => m.style.display = 'none');
  if (!wasVisible) menu.style.display = 'block';
}

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-content').forEach(m => m.style.display = 'none');
});

// ────────────────────────────────────────────
// GALERÍA DE VIDEOS
// ────────────────────────────────────────────
const estadoBadge = {
  descargado: { color:'var(--cyan)',   bc:'rgba(0,212,255,.3)',   bg:'rgba(0,212,255,.08)',   label:'Descargado', ico:'descargar.svg' },
  editado:    { color:'var(--purple)', bc:'rgba(168,85,247,.3)',  bg:'rgba(168,85,247,.08)',  label:'Editado',    ico:'cortar.svg' },
  publicado:  { color:'var(--green)',  bc:'rgba(34,211,160,.3)',  bg:'rgba(34,211,160,.08)',  label:'Publicado',  ico:'check.svg' },
};

function renderGaleria(lista) {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  if (!lista || lista.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--txt3);font-size:13px">No hay videos que coincidan con los filtros seleccionados.<br><button class="btn bd bsm" style="margin-top:10px" onclick="limpiarTodosFiltros()">Mostrar todos</button></div>';
    return;
  }
  grid.innerHTML = lista.map((v, i) => {
    const actualIdx = App.playlist.findIndex(x => x.id === v.id);
    const resolvedIdx = actualIdx >= 0 ? actualIdx : i;
    const estadoReal = v.publicado_telegram ? 'publicado' : v.estado;
    const b = estadoBadge[estadoReal] || estadoBadge.descargado;
    const isNew = i < 2 && !v.publicado_telegram;
    const tituloEsc = escapeHtml(v.titulo);
    const videoIdEsc = escapeHtml(v.id);
    return `
    <div class="gv-card" onclick="abrirEnEstudio('${videoIdEsc}')" title="Reproducir y editar: ${tituloEsc}">
      <div class="gv-thumb">
        <img src="iconos/play.svg" class="icono-svg-xl" />
        <div class="gv-play-overlay">
          <div class="gv-play-btn"><img src="iconos/play.svg" class="icono-svg-sm" /></div>
        </div>
        <div class="gv-dur">${v.dur || '0:00'}</div>
        ${isNew ? '<div class="gv-new-badge">Nuevo</div>' : ''}
      </div>
      <div class="gv-info">
        <div class="gv-title" title="${tituloEsc}">${tituloEsc}</div>
        <div class="gv-meta">
          <span class="gv-size">${v.tamano || ''} · ${v.partes || 1} partes</span>
          <span style="color:${b.color};border-color:${b.bc};background:${b.bg};font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;border:1px solid;display:inline-flex;align-items:center;gap:3px"><img src="iconos/${b.ico}" class="icono-svg-sm" style="width:10px;height:10px" /> ${b.label}</span>
        </div>
        <div class="gv-actions">
          <button class="btn bs bsm" style="flex:1;justify-content:center" onclick="event.stopPropagation();abrirEnEstudio('${videoIdEsc}')"><img src="iconos/estudio.svg" class="icono-svg-sm" /> Estudio</button>
          
          <div class="dropdown" style="display:inline-block;position:relative">
            <button class="btn bs bsm" onclick="event.stopPropagation();toggleDropMenu(this)"><img src="iconos/pipeline.svg" class="icono-svg-sm" /> Publicar <img src="iconos/chevron_abajo.svg" class="icono-svg-sm" style="margin-left:2px;width:10px;height:10px" /></button>
            <div class="dropdown-content" style="display:none;position:absolute;right:0;top:100%;background:var(--bg2);border:1px solid var(--border);border-radius:6px;z-index:99;min-width:170px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:4px 0">
              <a href="#" style="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--txt1);text-decoration:none" onclick="event.preventDefault();event.stopPropagation();publicarVideoDesdeGaleria('${videoIdEsc}', 'telegram')"><img src="iconos/telegram.svg" class="icono-svg-sm" /> Solo Telegram (HD)</a>
              <a href="#" style="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--txt1);text-decoration:none" onclick="event.preventDefault();event.stopPropagation();publicarVideoDesdeGaleria('${videoIdEsc}', 'youtube')"><img src="iconos/youtube.svg" class="icono-svg-sm" /> Solo YouTube</a>
              <a href="#" style="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--txt1);text-decoration:none" onclick="event.preventDefault();event.stopPropagation();publicarVideoDesdeGaleria('${videoIdEsc}', 'tiktok')"><img src="iconos/tiktok.svg" class="icono-svg-sm" /> Solo TikTok</a>
              <a href="#" style="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--txt1);text-decoration:none" onclick="event.preventDefault();event.stopPropagation();publicarVideoDesdeGaleria('${videoIdEsc}', 'facebook')"><img src="iconos/facebook.svg" class="icono-svg-sm" /> Solo Facebook</a>
              <a href="#" style="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--txt1);text-decoration:none" onclick="event.preventDefault();event.stopPropagation();publicarVideoDesdeGaleria('${videoIdEsc}', 'instagram')"><img src="iconos/instagram.svg" class="icono-svg-sm" /> Solo Instagram</a>
              <div style="border-top:1px solid var(--border);margin:4px 0"></div>
              <a href="#" style="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--cyan);font-weight:700;text-decoration:none" onclick="event.preventDefault();event.stopPropagation();ejecutarFase(3)"><img src="iconos/pipeline.svg" class="icono-svg-sm" /> Todas las Redes</a>
            </div>
          </div>

          <button class="btn bd bsm" onclick="event.stopPropagation();eliminarVideo('${videoIdEsc}',this)"><img src="iconos/eliminar.svg" class="icono-svg-sm" /></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderColaVideosDashboard(videos) {
  const el = document.getElementById('cola-list');
  if (!el) return;
  if (!videos || videos.length === 0) {
    el.innerHTML = '<div class="td-empty" style="padding:16px;text-align:center;font-size:11px;color:var(--txt3)">No hay videos en disco. Agrega una fuente o enlace para comenzar.</div>';
    return;
  }
  el.innerHTML = videos.slice(0, 8).map((v, i) => {
    const actualIdx = App.playlist.findIndex(x => x.id === v.id);
    const resolvedIdx = actualIdx >= 0 ? actualIdx : i;
    const tituloEsc = escapeHtml(v.titulo);
    const videoIdEsc = escapeHtml(v.id);
    const estadoClass = v.estado === 'editado' ? 'editing' : (v.estado === 'publicado' ? 'done' : 'pending');
    const estadoLabel = v.estado === 'editado' ? 'Editado' : (v.estado === 'publicado' ? 'Publicado' : 'Descargado');
    return `
      <div class="qi" onclick="abrirEnEstudio('${videoIdEsc}')" title="Abrir en Estudio: ${tituloEsc}">
        <div class="qthumb"><img src="iconos/play.svg" class="icono-svg-sm" /></div>
        <div class="qi-info">
          <div class="qi-t" title="${tituloEsc}">${tituloEsc}</div>
          <div class="qi-m">${v.dur || '0:00'} • ${v.tamano || ''} • ${v.partes || 1} parte(s)</div>
        </div>
        <span class="qst qst-${estadoClass}">${estadoLabel}</span>
      </div>
    `;
  }).join('');
}

// ────────────────────────────────────────────
// MOTOR DE FILTRADO Y ORDENAMIENTO PERSISTENTE
// ────────────────────────────────────────────
function obtenerFechaHoyLocal() {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, '0');
  const day = String(ahora.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function esVideoDeHoy(v) {
  const hoyStr = obtenerFechaHoyLocal();
  if (v.fecha_descarga && typeof v.fecha_descarga === 'string') {
    if (v.fecha_descarga.startsWith(hoyStr)) return true;
    try {
      const d = new Date(v.fecha_descarga);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dia = String(d.getDate()).padStart(2, '0');
        if (`${y}-${m}-${dia}` === hoyStr) return true;
      }
    } catch(e) {}
  }
  if (v.timestamp && typeof v.timestamp === 'number' && v.timestamp > 0) {
    const d = new Date(v.timestamp * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}` === hoyStr;
  }
  return false;
}

function compararPorFechaDescarga(a, b, orden) {
  const tsA = (a.timestamp && a.timestamp > 0) 
    ? a.timestamp * 1000 
    : (a.fecha_descarga ? new Date(a.fecha_descarga).getTime() : 0);
  const tsB = (b.timestamp && b.timestamp > 0) 
    ? b.timestamp * 1000 
    : (b.fecha_descarga ? new Date(b.fecha_descarga).getTime() : 0);

  if (orden === 'antiguos') {
    return tsA - tsB; // Más viejo primero
  }
  return tsB - tsA; // Más reciente primero (por defecto)
}

function obtenerVideosFiltrados() {
  let lista = [...App.galeria];

  // 1. Filtro por Estado
  if (App.filtros.estado && App.filtros.estado !== 'all') {
    lista = lista.filter(v => {
      const estadoReal = v.publicado_telegram ? 'publicado' : v.estado;
      return estadoReal === App.filtros.estado || v.estado === App.filtros.estado;
    });
  }

  // 2. Filtro Fecha: Solo Hoy
  if (App.filtros.soloHoy) {
    lista = lista.filter(v => esVideoDeHoy(v));
  }

  // 3. Filtro por Búsqueda (título o ID)
  if (App.filtros.busqueda) {
    const q = App.filtros.busqueda.toLowerCase();
    lista = lista.filter(v => 
      (v.titulo && v.titulo.toLowerCase().includes(q)) || 
      (v.id && v.id.toLowerCase().includes(q))
    );
  }

  // 4. Ordenamiento por Fecha de Descarga
  lista.sort((a, b) => compararPorFechaDescarga(a, b, App.filtros.orden));

  return lista;
}

function aplicarFiltrosYRenderizar() {
  const filtrados = obtenerVideosFiltrados();

  sincronizarControlesFiltros();
  renderGaleria(filtrados);
  renderEstudioPlaylist(filtrados);
  actualizarEtiquetasFiltros(filtrados.length, App.galeria.length);
}

function sincronizarControlesFiltros() {
  const galSel = document.getElementById('gal-filter');
  const estSel = document.getElementById('estudio-filter-estado');
  const galSort = document.getElementById('gal-sort');
  const estSort = document.getElementById('estudio-sort');
  const estInp = document.getElementById('estudio-input-busqueda');
  const btnHoyGal = document.getElementById('btn-filtro-hoy-gal');
  const btnHoyEst = document.getElementById('btn-filtro-hoy-estudio');

  if (galSel) galSel.value = App.filtros.estado;
  if (estSel) estSel.value = App.filtros.estado;
  if (galSort) galSort.value = App.filtros.orden;
  if (estSort) estSort.value = App.filtros.orden;
  if (estInp && document.activeElement !== estInp) estInp.value = App.filtros.busqueda;

  const aplicarEstiloActivo = (btn, activo) => {
    if (!btn) return;
    if (activo) {
      btn.style.borderColor = 'var(--cyan)';
      btn.style.background = 'rgba(0, 212, 255, 0.16)';
      btn.style.color = 'var(--cyan)';
      btn.style.fontWeight = '700';
    } else {
      btn.style.borderColor = '';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.fontWeight = '';
    }
  };

  aplicarEstiloActivo(btnHoyGal, App.filtros.soloHoy);
  aplicarEstiloActivo(btnHoyEst, App.filtros.soloHoy);
}

function actualizarEtiquetasFiltros(cantFiltrados, cantTotal) {
  const tieneFiltros = App.filtros.soloHoy || 
    (App.filtros.estado && App.filtros.estado !== 'all') || 
    Boolean(App.filtros.busqueda) || 
    App.filtros.orden !== 'recientes';

  const partes = [];
  if (App.filtros.soloHoy) partes.push('📅 Descargados hoy');
  if (App.filtros.estado && App.filtros.estado !== 'all') {
    const map = { descargado: 'Descargados', editado: 'Editados', publicado: 'Publicados' };
    partes.push(map[App.filtros.estado] || App.filtros.estado);
  }
  if (App.filtros.busqueda) partes.push(`"${App.filtros.busqueda}"`);
  if (App.filtros.orden === 'antiguos') partes.push('Más antiguos');

  const texto = partes.join(' · ');

  const tagGal = document.getElementById('gal-filtro-tags');
  const badgeGal = document.getElementById('gal-filtro-badge');
  const tagEst = document.getElementById('estudio-filtro-tags');
  const badgeEst = document.getElementById('estudio-filtro-badge');
  const btnLimpiarEst = document.getElementById('btn-limpiar-filtro-estudio');

  if (tieneFiltros) {
    if (tagGal) tagGal.style.display = 'flex';
    if (badgeGal) badgeGal.textContent = `${texto} (${cantFiltrados}/${cantTotal})`;
    if (tagEst) tagEst.style.display = 'flex';
    if (badgeEst) badgeEst.textContent = `${texto} (${cantFiltrados}/${cantTotal})`;
    if (btnLimpiarEst) btnLimpiarEst.style.display = 'inline-flex';
  } else {
    if (tagGal) tagGal.style.display = 'none';
    if (tagEst) tagEst.style.display = 'none';
    if (btnLimpiarEst) btnLimpiarEst.style.display = 'none';
  }
}

function cambiarFiltroEstado(val) {
  App.filtros.estado = val;
  aplicarFiltrosYRenderizar();
}

function toggleFiltroHoy() {
  App.filtros.soloHoy = !App.filtros.soloHoy;
  aplicarFiltrosYRenderizar();
  if (App.filtros.soloHoy) {
    mostrarToast('info', 'Filtro activado: Mostrando videos descargados hoy.');
  }
}

function cambiarOrdenVideos(val) {
  App.filtros.orden = val;
  aplicarFiltrosYRenderizar();
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

function limpiarTodosFiltros() {
  App.filtros.estado = 'all';
  App.filtros.soloHoy = false;
  App.filtros.busqueda = '';
  App.filtros.orden = 'recientes';
  aplicarFiltrosYRenderizar();
  mostrarToast('success', 'Filtros restablecidos: Mostrando todos los videos.');
}

function filtrarGaleria() {
  const f = document.getElementById('gal-filter');
  if (f) App.filtros.estado = f.value;
  aplicarFiltrosYRenderizar();
}

async function eliminarVideo(idxOrId, btn) {
  const v = typeof idxOrId === 'string'
    ? App.galeria.find(x => x.id === idxOrId)
    : App.galeria[idxOrId];
  if (!v) return;

  const titulo = v.titulo || v.id;
  const confirmado = await mostrarModalConfirmacion({
    tag: 'PURGA DE BIBLIOTECA',
    titulo: '¿Eliminar Video Seleccionado?',
    subtitulo: 'Se purgará físicamente el archivo del sistema junto a su configuración JSON y clips.',
    itemTitulo: titulo,
    itemId: v.id,
    detalles: [
      { label: 'Video Original', desc: 'descargas/' + v.id + ' (.mp4)' },
      { label: 'Metadatos JSON', desc: 'metadata.json (información de publicación)' },
      { label: 'Clips y Partes', desc: 'procesados/' + v.id + ' (segmentos)' }
    ],
    nota: 'La eliminación es inmediata e irreversible. Los archivos no van a la papelera.',
    textoConfirmar: 'Eliminar Permanentemente',
    icono: 'eliminar.svg',
    peligro: true
  });
  if (!confirmado) return;

  try {
    const res = await fetch(`${API_BASE}/api/videos/${encodeURIComponent(v.id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('warning', `Video "${escapeHtml(titulo)}" y su JSON eliminados de disco.`);
      addLog('warn', `Video y metadata eliminados de disco: <span class="hl">${v.id}</span>.`);
      await cargarGaleriaDesdeServidor();
    } else {
      mostrarToast('error', `Error al eliminar: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al comunicarse con el servidor.');
  }
}

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
          <span style="color:var(--txt3)">${v.dur} · ${v.tamano} · ${v.partes} partes</span><br><br>
          <span style="color:var(--txt3);font-size:11px">descargas/${v.id}/video_original.mp4</span>`;
      }
    }
    simularReproduccion(v.durSec);
  }

  document.querySelectorAll('.pip-pl-item').forEach((el,i) => {
    el.classList.toggle('active', i === idx);
  });

  const elDur = document.getElementById('pip-dur');
  const elFill = document.getElementById('pip-prog-fill');
  const elThumb = document.getElementById('pip-prog-thumb');
  const elCur = document.getElementById('pip-cur');
  const elPlayBtn = document.getElementById('pip-play-btn');

  if (elDur) elDur.textContent = v.dur;
  if (elFill) elFill.style.width = '0%';
  if (elThumb) elThumb.style.left = '0%';
  if (elCur) elCur.textContent = '0:00';
  if (elPlayBtn) elPlayBtn.innerHTML = '<img src="iconos/pausa.svg" class="icono-svg-sm" />';
}

let simTimer = null;
function simularReproduccion(totalSec) {
  if (simTimer) clearInterval(simTimer);
  let elapsed = 0;
  const step = 1;
  simTimer = setInterval(() => {
    elapsed += step;
    if (elapsed > totalSec) { clearInterval(simTimer); return; }
    const pct = (elapsed / totalSec) * 100;
    const elFill = document.getElementById('pip-prog-fill');
    const elThumb = document.getElementById('pip-prog-thumb');
    const elCur = document.getElementById('pip-cur');
    if (elFill) elFill.style.width = pct + '%';
    if (elThumb) elThumb.style.left = pct + '%';
    if (elCur) elCur.textContent = fmtTime(elapsed);
  }, 100);
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

  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
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

  if (btnConfirmar) {
    btnConfirmar.className = (plat === 'telegram') ? 'btn bp btn-telegram' : 'btn bp';
    btnConfirmar.innerHTML = `<img src="iconos/${plat || 'telegram'}.svg" class="icono-svg-sm" /> Publicar en ${nombrePlat}`;
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

  if (canal && plat === 'telegram') {
    agregarYGuardarCanalTelegram(canal).catch(() => {});
  }

  cerrarModal('m-publicar-activo');
  const etiquetaModo = isHeadless ? 'Invisible' : 'Visible';
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
// CONEXIÓN CON SERVIDORES SSE Y API
// ────────────────────────────────────────────
let sseSource = null;

function conectarServidorLogs() {
  if (sseSource) sseSource.close();
  try {
    sseSource = new EventSource(API_BASE + '/eventos');
    sseSource.onopen = () => {
      const dot = document.getElementById('srv-dot');
      const txt = document.getElementById('srv-txt');
      const ind = document.getElementById('srv-indicator');
      if (dot) dot.style.background = 'var(--green)';
      if (txt) txt.textContent = 'Servidor Conectado';
      if (ind) ind.style.borderColor = 'rgba(34,211,160,.4)';
      addLog('ok', 'Conexión en vivo establecida con el servidor Ragnarok (http://127.0.0.1:5757)');
      cargarFuentesDesdeServidor();
      cargarPendientesDesdeServidor();
      cargarGaleriaDesdeServidor();
      cargarEstadoCookies();
      cargarConfiguracionCanalTelegram();
    };
    sseSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const tipoMap = { INFO:'info', OK:'ok', WARN:'warn', ERROR:'err' };
        addLogRealtime(tipoMap[data.nivel] || 'info', data.t, data.msg);
      } catch(err) {}
    };
    sseSource.onerror = () => {
      const dot = document.getElementById('srv-dot');
      const txt = document.getElementById('srv-txt');
      const ind = document.getElementById('srv-indicator');
      if (dot) dot.style.background = 'var(--red)';
      if (txt) txt.textContent = 'Reconectando con el servidor...';
      if (ind) ind.style.borderColor = 'var(--border)';
    };
  } catch(err) {
    console.log('Servidor SSE no disponible.');
  }
}

// Inicializar conexión SSE al cargar
document.addEventListener('DOMContentLoaded', () => {
  conectarServidorLogs();
  if (window.location.protocol === 'file:') {
    setTimeout(() => {
      mostrarToast('warning', 'ATENCIÓN: Abriste el archivo HTML localmente. Abre http://127.0.0.1:5757 en tu navegador para una mejor experiencia.');
    }, 1500);
  }
});

function addLogRealtime(tipo, hora, msg) {
  const bd = document.getElementById('log-bd');
  if (bd) {
    const lbl = {info:'INFO',ok:'OK',warn:'AVISO',err:'ERROR'};
    const div = document.createElement('div');
    div.className = 'le';
    div.innerHTML = `<span class="lt">${hora}</span><span class="ltag ${tipo}">${lbl[tipo]||'INFO'}</span><span class="lm">${msg}</span>`;
    bd.appendChild(div);
    bd.scrollTop = bd.scrollHeight;
  }

  // Actualización dinámica de Progreso en Vivo en el Panel (Fase 1 - Descargas)
  try {
    const f1b = document.getElementById('f1b');
    const f1pct = document.getElementById('f1pct');

    if (msg.includes('[download]') && msg.includes('%')) {
      const matchPct = msg.match(/(\d+(?:\.\d+)?)%/);
      if (matchPct) {
        const pct = parseFloat(matchPct[1]);
        if (f1b) f1b.style.width = pct + '%';
        const speedMatch = msg.match(/at\s+([^\s]+)\s+ETA\s+([^\s]+)/i);
        if (f1pct) {
          if (speedMatch) {
            f1pct.textContent = `${pct.toFixed(0)}% (${speedMatch[1]} · ETA ${speedMatch[2]})`;
          } else {
            f1pct.textContent = `${pct.toFixed(0)}%`;
          }
        }
      }
    } else if (msg.includes('[Merger]') || msg.includes('Uniendo pistas')) {
      if (f1pct) f1pct.textContent = 'Uniendo pistas MP4...';
    } else if (msg.includes('Consultando video') || msg.includes('Conectando con servidor')) {
      if (f1pct) f1pct.textContent = 'Conectando con servidor...';
    } else if (msg.includes('descargado y registrado con éxito')) {
      if (f1b) f1b.style.width = '100%';
      if (f1pct) f1pct.textContent = '100% Completado';
      cargarPendientesDesdeServidor();
      cargarGaleriaDesdeServidor();
    } else if (msg.includes('Fase 1 completada') || msg.includes('Ciclo de descargas finalizado')) {
      if (f1b) f1b.style.width = '100%';
      if (f1pct) f1pct.textContent = '100%';
      setTimeout(() => {
        if (App.fases[1] !== 'running') {
          if (f1b) f1b.style.width = '0%';
          if (f1pct) f1pct.textContent = '0%';
        }
      }, 3000);
      cargarPendientesDesdeServidor();
      cargarGaleriaDesdeServidor();
    }

    // Actualización dinámica de Progreso en Vivo en el Panel (Fase 4 - Telegram MTProto)
    const f4b = document.getElementById('f4b');
    const f4pct = document.getElementById('f4pct');
    if (msg.includes('[TELEGRAM]')) {
      const btnLogDetener = document.getElementById('btn-log-detener-lote');
      const btnModalDetener = document.getElementById('btn-modal-detener-lote');
      if (msg.includes('finalizado') || msg.includes('cancelado') || msg.includes('detenida')) {
        if (btnLogDetener) btnLogDetener.style.display = 'none';
        if (btnModalDetener) btnModalDetener.style.display = 'none';
        if (f4b) f4b.style.width = '0%';
        if (f4pct) f4pct.textContent = '0%';
      } else {
        if (btnLogDetener) btnLogDetener.style.display = 'inline-flex';
        if (btnModalDetener) btnModalDetener.style.display = 'inline-flex';
        const matchPct = msg.match(/(\d+(?:\.\d+)?)%/);
        if (matchPct && f4pct && f4b) {
          const pct = parseFloat(matchPct[1]);
          f4b.style.width = pct + '%';
          f4pct.textContent = `${pct.toFixed(0)}%`;
        }
      }
    }
  } catch(e) {}
}

// ────────────────────────────────────────────
// GESTIÓN DE FUENTES URL
// ────────────────────────────────────────────
function setEjemplo(url) {
  const el = document.getElementById('nueva-fuente-url');
  if (el) el.value = url;
}

async function cargarFuentesDesdeServidor() {
  try {
    const res = await fetch(API_BASE + '/fuentes');
    if (!res.ok) return;
    const data = await res.json();
    renderTablaFuentes(data.fuentes || []);
  } catch(e) {}
}

function renderTablaFuentes(fuentes) {
  const tbody = document.getElementById('tb-fuentes');
  if (!tbody) return;
  if (fuentes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--txt3);padding:16px;font-size:12px">No hay fuentes configuradas. Ingresa una URL de Facebook arriba.</td></tr>';
    return;
  }
  const badgeTipo = {
    watch_global:  '<span class="tbadge actv" style="color:var(--cyan);border-color:rgba(0,212,255,.3)"><img src="iconos/facebook.svg" class="icono-svg-sm" /> Watch Global</span>',
    grupo_videos:  '<span class="tbadge actv" style="color:var(--purple);border-color:rgba(168,85,247,.3)"><img src="iconos/fuentes.svg" class="icono-svg-sm" /> Grupo</span>',
    pagina_videos: '<span class="tbadge actv" style="color:var(--green);border-color:rgba(34,211,160,.3)"><img src="iconos/fuentes.svg" class="icono-svg-sm" /> Página</span>',
    perfil_videos: '<span class="tbadge actv" style="color:var(--amber);border-color:rgba(245,158,11,.3)"><img src="iconos/sesion.svg" class="icono-svg-sm" /> Perfil</span>',
    reel:          '<span class="tbadge actv" style="color:var(--pink);border-color:rgba(244,114,182,.3)"><img src="iconos/play.svg" class="icono-svg-sm" /> Reel</span>',
    video_directo: '<span class="tbadge actv"><img src="iconos/play.svg" class="icono-svg-sm" /> Video Directo</span>',
    busqueda:      '<span class="tbadge actv"><img src="iconos/buscar.svg" class="icono-svg-sm" /> Búsqueda</span>',
    desconocida:   '<span class="tbadge pend"><img src="iconos/alerta.svg" class="icono-svg-sm" /> URL Genérica</span>',
  };

  tbody.innerHTML = fuentes.map(f => `
    <tr>
      <td>${badgeTipo[f.tipo] || f.tipo}</td>
      <td class="tn" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.url_original}">${f.url_original}</td>
      <td class="tt" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.url_scroll}">${f.url_scroll}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <label class="tog" title="${f.activa ? 'Desactivar fuente' : 'Activar fuente'}">
            <input type="checkbox" ${f.activa ? 'checked' : ''} onchange="toggleFuenteURL('${encodeURIComponent(f.url_original)}', this.checked)">
            <div class="tog-track"></div>
          </label>
          <span class="tbadge ${f.activa ? 'done' : 'pend'}">${f.activa ? 'Activa' : 'Pausada'}</span>
        </div>
      </td>
      <td><button class="btn bd bsm" onclick="eliminarFuenteURL('${encodeURIComponent(f.url_original)}')"><img src="iconos/eliminar.svg" class="icono-svg-sm" /></button></td>
    </tr>
  `).join('');
}

async function toggleFuenteURL(urlEnc, activa) {
  const url = decodeURIComponent(urlEnc);
  try {
    const res = await fetch(API_BASE + '/fuentes/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, activa: activa }),
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Fuente ${activa ? 'activada' : 'pausada'}: ${url}`);
      cargarFuentesDesdeServidor();
    } else {
      mostrarToast('error', `Error: ${data.error}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al comunicarse con el servidor.');
  }
}

async function cargarEstadoCookies() {
  try {
    const res = await fetch(API_BASE + '/api/cookies');
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && data.cookies) {
      const mapaPlat = { youtube:'yt', tiktok:'tk', facebook:'fb', instagram:'ig', telegram:'tg' };
      for (const [plat, info] of Object.entries(data.cookies)) {
        const idSuf = mapaPlat[plat] || plat;
        const directEl = document.getElementById('st-' + idSuf);
        const tog = document.getElementById('tog-' + idSuf);
        const stEl = directEl || (tog ? tog.closest('.pl-row')?.querySelector('.pl-st') : null);
        if (stEl) {
          if (info.estado === 'ACTIVO') {
            stEl.className = 'pl-st ok';
            stEl.textContent = info.mensaje;
          } else {
            stEl.className = 'pl-st warn';
            stEl.textContent = info.mensaje;
          }
        }
      }
    }
  } catch(e) {}
}

async function agregarFuenteURL() {
  const input = document.getElementById('nueva-fuente-url');
  if (!input) return;
  const url = input.value.trim();
  if (!url) { mostrarToast('warning','Por favor escribe una URL de Facebook.'); return; }
  mostrarToast('info', 'Agregando fuente de Facebook...');
  try {
    const res = await fetch(API_BASE + '/fuentes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url }),
    });
    const data = await res.json();
    if (data.ok) {
      const desc = (data.fuente && data.fuente.descripcion) ? data.fuente.descripcion : url;
      mostrarToast('success', `Fuente agregada: ${desc}`);
      addLog('ok', `Nueva fuente de extracción agregada: <span class="hl">${escapeHtml(url)}</span>`);
      input.value = '';
      cargarFuentesDesdeServidor();
    } else {
      mostrarToast('error', `Error: ${data.error || 'No se pudo agregar la fuente'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al conectarse con el backend de Ragnarok.');
  }
}

async function eliminarFuenteURL(urlEnc) {
  try {
    const res = await fetch(API_BASE + '/fuentes/' + urlEnc, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('warning', 'Fuente eliminada de la lista.');
      addLog('warn', `Fuente eliminada.`);
      cargarFuentesDesdeServidor();
    } else {
      mostrarToast('error', `Error eliminando fuente: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error de conexión.');
  }
}

// ────────────────────────────────────────────
// GESTIÓN DE COLA DE PENDIENTES (DESCARGA DIRECTA)
// ────────────────────────────────────────────
async function cargarPendientesDesdeServidor() {
  try {
    const res = await fetch(API_BASE + '/pendientes');
    if (!res.ok) return;
    const data = await res.json();
    renderTablaPendientes(data.pendientes || []);
  } catch(e) {}
}

function renderTablaPendientes(pendientes) {
  const tbody = document.getElementById('tb-pendientes');
  if (!tbody) return;
  if (pendientes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--txt3);padding:16px;font-size:12px">No hay enlaces pendientes en cola_pendientes.txt. Pega uno arriba para descargar directamente.</td></tr>';
    return;
  }
  tbody.innerHTML = pendientes.map((url, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="tn" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${url}">${url}</td>
      <td><span class="tbadge pend"><img src="iconos/descargar.svg" class="icono-svg-sm" /> Pendiente yt-dlp</span></td>
      <td><button class="btn bd bsm" onclick="eliminarPendienteURL('${encodeURIComponent(url)}')"><img src="iconos/eliminar.svg" class="icono-svg-sm" /></button></td>
    </tr>
  `).join('');
}

async function agregarEnlacePendiente() {
  const input = document.getElementById('nuevo-pendiente-url');
  if (!input) return;
  const url = input.value.trim();
  if (!url) { mostrarToast('warning','Por favor escribe un enlace de video.'); return; }
  try {
    const res = await fetch(API_BASE + '/pendientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Enlace agregado a la cola de pendientes.`);
      addLog('ok', `Enlace directo encolado para descarga: <span class="hl">${escapeHtml(url)}</span>`);
      input.value = '';
      cargarPendientesDesdeServidor();
    } else {
      mostrarToast('error', `Error: ${data.error || 'No se pudo agregar'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al comunicarse con el backend de Ragnarok.');
  }
}

async function eliminarPendienteURL(urlEnc) {
  try {
    const res = await fetch(API_BASE + '/pendientes/' + urlEnc, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('warning', 'Enlace eliminado de la cola de pendientes.');
      cargarPendientesDesdeServidor();
    }
  } catch(e) {}
}

async function ejecutarDescargaUnicamente() {
  if (App.fases[1] === 'running') { mostrarToast('warning', 'La descarga o Fase 1 ya está en ejecución.'); return; }
  try {
    const res = await fetch(API_BASE + '/ejecutar/descargar', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', 'Descarga de pendientes iniciada con yt-dlp nativo...');
      App.fases[1] = 'running';
      setFaseUI(1, 'running', 'Descargando (yt-dlp)...');
      document.getElementById('fc1')?.classList.add('active-c');
      setSysUI('running', 'Descarga de pendientes en ejecución');
      return;
    } else {
      mostrarToast('error', `Error: ${data.error || 'No se pudo iniciar'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al iniciar descarga.');
  }
}

// ────────────────────────────────────────────
// EJECUCIÓN DE FASES
// ────────────────────────────────────────────
async function ejecutarFase(n) {
  if (App.fases[n] === 'running') { mostrarToast('warning', `Fase ${n} ya está en ejecución.`); return; }

  try {
    const res = await fetch(API_BASE + `/ejecutar/${n}`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Fase ${n} iniciada con éxito.`);
      App.fases[n] = 'running';
      setFaseUI(n, 'running', 'Ejecutando...');
      document.getElementById(`fc${n}`)?.classList.add('active-c');
      setSysUI('running', `Fase ${n} en ejecución`);
      return;
    } else {
      mostrarToast('error', `Error iniciando Fase ${n}: ${data.error}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error al comunicarse con el backend de Ragnarok.');
  }
}

function faseFin(n) {
  App.fases[n] = 'done';
  setFaseUI(n, 'done', 'Completada');
  document.getElementById(`fc${n}`)?.classList.remove('active-c');
  const btn = document.getElementById(`btn${n}`);
  if (btn) btn.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" /> Reiniciar';
  setSysUI('idle', 'Sistema inactivo');
  mostrarToast('success', `Fase ${n} completada.`);
  addLog('ok', `Fase <span class="hl">${n}</span> finalizada exitosamente.`);
}

async function detenerFase(n) {
  if (App.fases[n] !== 'running') return;
  try { await fetch(API_BASE + `/detener/${n}`, { method: 'POST' }); } catch(e) {}
  App.fases[n] = 'idle';
  clearInterval(App.timers[n]);
  setFaseUI(n, 'idle', 'Detenida');
  document.getElementById(`fc${n}`)?.classList.remove('active-c');
  const btn = document.getElementById(`btn${n}`);
  if (btn) btn.innerHTML = '<img src="iconos/play.svg" class="icono-svg-sm" /> Iniciar';
  if (n === 1 || n === '1') {
    const f1b = document.getElementById('f1b');
    const f1pct = document.getElementById('f1pct');
    if (f1b) f1b.style.width = '0%';
    if (f1pct) f1pct.textContent = '0%';
  }
  setSysUI('idle', 'Sistema inactivo');
  mostrarToast('warning', `Fase ${n} detenida.`);
  addLog('warn', `Fase <span class="hl">${n}</span> detenida manualmente.`);
}

function detenerTodo() { [1,2,3].forEach(detenerFase); mostrarToast('warning','Todos los procesos detenidos.'); }

function ejecutarPipelineCompleto() {
  mostrarToast('success','Pipeline completo iniciado: Fase 1 → 2 → 3');
  addLog('info','Pipeline completo iniciado.');
  ejecutarFase(1);
  setTimeout(() => ejecutarFase(2), 4000);
  setTimeout(() => ejecutarFase(3), 8000);
}

// ── UI helpers ──
function setFaseUI(n, tipo, txt) {
  const el = document.getElementById(`fsi${n}`);
  if (el) {
    el.className = `fsi ${tipo}`;
    el.innerHTML = `<span class="sdot ${tipo==='running'?'pulse':''}"></span><span>${txt}</span>`;
  }
}
function setSysUI(tipo, txt) {
  const badge = document.getElementById('sys-badge');
  const dot = document.getElementById('sys-dot');
  const text = document.getElementById('sys-txt');
  if (badge) badge.className = `sbadge ${tipo}`;
  if (dot) dot.className = `sdot ${tipo==='running'?'pulse':''}`;
  if (text) text.textContent = txt;
}

// ────────────────────────────────────────────
// SCHEDULER
// ────────────────────────────────────────────
function addTarea() {
  const elT = document.getElementById('sc-tarea');
  const elF = document.getElementById('sc-fecha');
  const elH = document.getElementById('sc-hora');
  if (!elT || !elF || !elH) return;
  const t = elT.value, f = elF.value, h = elH.value;
  if (!f||!h) { mostrarToast('warning','Completa fecha y hora.'); return; }
  const tbody = document.getElementById('tb-tareas');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="tn">${t.split('(')[0].trim()}</td><td class="tt">${f} ${h}</td><td><span class="tbadge pend">Pendiente</span></td><td><button class="btn bs bsm" onclick="delTarea(this)"><img src="iconos/eliminar.svg" class="icono-svg-sm" /></button></td>`;
  tbody.appendChild(tr);
  mostrarToast('success','Tarea programada agregada.');
  addLog('ok',`Tarea programada: <span class="hl">${t.split('(')[0].trim()}</span> para ${f} ${h}`);
}
function delTarea(btn) { btn.closest('tr')?.remove(); mostrarToast('warning','Tarea eliminada.'); }
function guardarProg() { cerrarModal('m-programar'); mostrarToast('success','Tarea programada guardada.'); addLog('ok','Tarea programada configurada desde el modal.'); }

// ────────────────────────────────────────────
// PLATAFORMAS
// ────────────────────────────────────────────
function togPlat(nombre, cb) {
  const e = cb.checked ? 'activada' : 'desactivada';
  mostrarToast(cb.checked?'success':'warning', `${nombre}: ${e}`);
  addLog(cb.checked?'ok':'warn', `Plataforma <span class="hl">${nombre}</span> ${e}.`);
}

// ────────────────────────────────────────────
// MODALES
// ────────────────────────────────────────────
function abrirProgramar() { document.getElementById('m-programar')?.classList.add('open'); }
async function abrirConfig() {
  document.getElementById('m-config')?.classList.add('open');
  try {
    const res = await fetch(API_BASE + '/config');
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg.extraccion) {
      if (cfg.extraccion.max_scrolls_por_sesion !== undefined) {
        const el = document.getElementById('cfg-max-scrolls');
        if(el) el.value = cfg.extraccion.max_scrolls_por_sesion;
      }
      if (cfg.extraccion.headless !== undefined) {
        const el = document.getElementById('cfg-headless');
        if(el) el.value = String(cfg.extraccion.headless);
      }
    }
    if (cfg.edicion) {
      if (cfg.edicion.factor_velocidad !== undefined) {
        const el = document.getElementById('cfg-velocidad');
        if(el) el.value = String(cfg.edicion.factor_velocidad);
      }
      if (cfg.edicion.duracion_bloque_segundos !== undefined) {
        const el = document.getElementById('cfg-dur-bloque');
        if(el) el.value = Math.round(cfg.edicion.duracion_bloque_segundos / 60);
      }
      if (cfg.edicion.threads_ffmpeg !== undefined) {
        const el = document.getElementById('cfg-threads');
        if(el) el.value = cfg.edicion.threads_ffmpeg;
      }
    }
    if (cfg.publicacion) {
      if (cfg.publicacion.telegram_api_id) {
        const el = document.getElementById('cfg-tg-api-id');
        if (el) el.value = cfg.publicacion.telegram_api_id;
      }
      if (cfg.publicacion.telegram_api_hash) {
        const el = document.getElementById('cfg-tg-api-hash');
        if (el) el.value = cfg.publicacion.telegram_api_hash;
      }
      if (cfg.publicacion.canal_telegram) {
        const el = document.getElementById('cfg-tg-canal');
        if (el) el.value = cfg.publicacion.canal_telegram;
      }
      if (cfg.publicacion.telegram_telefono) {
        const el = document.getElementById('cfg-tg-phone');
        if (el) el.value = cfg.publicacion.telegram_telefono;
      }
    }
    // Verificar estado en vivo de la sesión MTProto
    verificarEstadoSesionTelegram();
  } catch(e) {}
}

async function verificarEstadoSesionTelegram() {
  const badge = document.getElementById('tg-status-text');
  const btnDesvincular = document.getElementById('btn-tg-desvincular');
  const btnSolicitar = document.getElementById('btn-tg-solicitar');
  if (!badge) return;
  try {
    const res = await fetch(API_BASE + '/api/telegram/estado_sesion');
    const data = await res.json();
    if (data.vinculado) {
      badge.innerHTML = '<span style="color: #2ea043; font-weight: bold;">●</span> <span style="color: #2ea043;">Sesión Activa</span>';
      badge.style.background = 'rgba(46, 160, 67, 0.15)';
      if (btnDesvincular) btnDesvincular.style.display = 'inline-block';
      if (btnSolicitar) btnSolicitar.innerHTML = '<img src="iconos/telegram.svg" class="icono-svg-sm" /> Re-vincular';
    } else {
      badge.innerHTML = '<span style="color: #8b949e;">●</span> Sin sesión';
      badge.style.background = 'rgba(255, 255, 255, 0.06)';
      if (btnDesvincular) btnDesvincular.style.display = 'none';
      if (btnSolicitar) btnSolicitar.innerHTML = '<img src="iconos/telegram.svg" class="icono-svg-sm" /> Solicitar Código';
    }
  } catch(e) {
    badge.innerHTML = '<span style="color: #8b949e;">●</span> Sin sesión';
  }
}

async function solicitarCodigoTelegram() {
  const apiId = parseInt(document.getElementById('cfg-tg-api-id')?.value) || 0;
  const apiHash = document.getElementById('cfg-tg-api-hash')?.value?.trim() || '';
  const phone = document.getElementById('cfg-tg-phone')?.value?.trim() || '';

  if (!phone) {
    mostrarToast('error', 'Por favor ingresa el número de teléfono de tu cuenta de Telegram.');
    return;
  }
  if (!apiId || !apiHash) {
    mostrarToast('error', 'Por favor ingresa tu api_id y api_hash de my.telegram.org.');
    return;
  }

  const btn = document.getElementById('btn-tg-solicitar');
  if (btn) { btn.disabled = true; btn.textContent = 'Conectando con Telegram...'; }

  mostrarToast('info', 'Conectando a Telegram y solicitando código oficial...');
  addLog('info', `Solicitando código de Telegram para ${phone}...`);

  try {
    const res = await fetch(API_BASE + '/api/telegram/solicitar_codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefono: phone,
        api_id: apiId,
        api_hash: apiHash
      })
    });
    const data = await res.json();
    if (data.ok) {
      if (data.ya_autorizado) {
        mostrarToast('success', data.mensaje);
        verificarEstadoSesionTelegram();
      } else {
        mostrarToast('success', '¡Código enviado a tu app de Telegram!');
        const codeBox = document.getElementById('tg-code-box');
        if (codeBox) {
          codeBox.style.display = 'block';
          setTimeout(() => codeBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        }
        const codeInput = document.getElementById('cfg-tg-code');
        if (codeInput) { codeInput.value = ''; codeInput.focus(); }
      }
    } else {
      mostrarToast('error', data.error || 'Error al solicitar código.');
      addLog('error', `Fallo al solicitar código: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error de conexión con el servidor.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<img src="iconos/telegram.svg" class="icono-svg-sm" /> Solicitar Código'; }
  }
}

async function confirmarCodigoTelegram() {
  const code = document.getElementById('cfg-tg-code')?.value?.trim() || '';
  if (!code) {
    mostrarToast('error', 'Ingresa el código de 5 dígitos.');
    return;
  }

  mostrarToast('info', 'Verificando código con Telegram...');
  addLog('info', 'Validando código de Telegram...');

  try {
    const res = await fetch(API_BASE + '/api/telegram/confirmar_codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: code })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', data.mensaje);
      addLog('ok', data.mensaje);
      const codeBox = document.getElementById('tg-code-box');
      if (codeBox) codeBox.style.display = 'none';
      const box2fa = document.getElementById('tg-2fa-box');
      if (box2fa) box2fa.style.display = 'none';
      verificarEstadoSesionTelegram();
    } else if (data.requiere_2fa) {
      mostrarToast('warning', data.mensaje);
      const box2fa = document.getElementById('tg-2fa-box');
      if (box2fa) {
        box2fa.style.display = 'block';
        setTimeout(() => box2fa.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      }
      const pwdInput = document.getElementById('cfg-tg-2fa');
      if (pwdInput) { pwdInput.value = ''; pwdInput.focus(); }
    } else {
      mostrarToast('error', data.error || 'Código incorrecto o expirado.');
      addLog('error', data.error || 'Código incorrecto.');
    }
  } catch(e) {
    mostrarToast('error', 'Error al verificar código con Telegram.');
  }
}

function toggleVerPassword2FA() {
  const inp = document.getElementById('cfg-tg-2fa');
  if (inp) {
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }
}

async function confirmarPasswordTelegram() {
  const pwd = document.getElementById('cfg-tg-2fa')?.value || '';
  const errBox = document.getElementById('tg-2fa-error-msg');
  if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }

  if (!pwd) {
    mostrarToast('error', 'Ingresa tu contraseña 2FA de Telegram.');
    return;
  }

  const btn = document.getElementById('btn-tg-2fa-confirmar');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }

  mostrarToast('info', 'Verificando contraseña 2FA con Telegram...');
  try {
    const res = await fetch(API_BASE + '/api/telegram/confirmar_password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', data.mensaje);
      addLog('ok', data.mensaje);
      const codeBox = document.getElementById('tg-code-box');
      if (codeBox) codeBox.style.display = 'none';
      const box2fa = document.getElementById('tg-2fa-box');
      if (box2fa) box2fa.style.display = 'none';
      verificarEstadoSesionTelegram();
    } else {
      const msg = data.error || 'Contraseña 2FA incorrecta.';
      mostrarToast('error', msg);
      addLog('error', msg);
      if (errBox) {
        errBox.textContent = '⚠️ ' + msg;
        errBox.style.display = 'block';
      }
      const pwdInput = document.getElementById('cfg-tg-2fa');
      if (pwdInput) { pwdInput.focus(); pwdInput.select(); }
    }
  } catch(e) {
    mostrarToast('error', 'Error verificando contraseña 2FA con el servidor.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Contraseña'; }
  }
}

async function desvincularTelegram() {
  if (!confirm('¿Deseas desvincular tu sesión de Telegram de este sistema?')) return;
  try {
    const res = await fetch(API_BASE + '/api/telegram/desvincular', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('info', 'Sesión de Telegram desvinculada.');
      addLog('info', 'Sesión de Telegram eliminada.');
      verificarEstadoSesionTelegram();
    }
  } catch(e) {
    mostrarToast('error', 'Error desvinculando sesión.');
  }
}

async function guardarConfig() {
  const maxScrolls = parseInt(document.getElementById('cfg-max-scrolls')?.value) || 50;
  const vel = parseFloat(document.getElementById('cfg-velocidad')?.value) || 1.0;
  const durMin = parseInt(document.getElementById('cfg-dur-bloque')?.value) || 8;
  const threads = parseInt(document.getElementById('cfg-threads')?.value) || 4;
  const headless = document.getElementById('cfg-headless')?.value === 'true';

  const tgApiId = parseInt(document.getElementById('cfg-tg-api-id')?.value) || 0;
  const tgApiHash = document.getElementById('cfg-tg-api-hash')?.value?.trim() || '';
  const tgCanal = document.getElementById('cfg-tg-canal')?.value?.trim() || '';
  const tgPhone = document.getElementById('cfg-tg-phone')?.value?.trim() || '';

  const body = {
    extraccion: {
      max_scrolls_por_sesion: maxScrolls,
      headless: headless
    },
    edicion: {
      factor_velocidad: vel,
      duracion_bloque_segundos: durMin * 60,
      threads_ffmpeg: threads
    },
    publicacion: {
      canal_telegram: tgCanal,
      telegram_api_id: tgApiId > 0 ? tgApiId : undefined,
      telegram_api_hash: tgApiHash !== '' ? tgApiHash : undefined,
      telegram_telefono: tgPhone !== '' ? tgPhone : undefined
    }
  };

  try {
    const res = await fetch(API_BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) {
      cerrarModal('m-config');
      mostrarToast('success', `Configuración guardada (Navegador: ${headless ? 'Headless' : 'Visible'}).`);
      addLog('ok', `Configuración actualizada en disco: Headless=${headless}, MaxScrolls=${maxScrolls}, Vel=${vel}x`);
    } else {
      mostrarToast('error', `Error al guardar: ${data.error}`);
    }
  } catch(e) {
    cerrarModal('m-config');
    mostrarToast('warning', 'Configuración actualizada en vista local.');
  }
}

function abrirVelocidad() { abrirModal('m-vel'); }
function aplicarVel() {
  const checked = document.querySelector('input[name="vel"]:checked');
  const v = checked ? checked.value : '1.0';
  cerrarModal('m-vel');
  mostrarToast('success', `Velocidad: ${v}x`);
  addLog('info', `Factor de velocidad actualizado a <span class="hl">${v}x</span>.`);
}

document.querySelectorAll('.mover').forEach(o => o.addEventListener('click', e => { if(e.target===o) cerrarModal(o.id); }));

// ────────────────────────────────────────────
// LOG DE ACTIVIDAD
// ────────────────────────────────────────────
function addLog(tipo, msg) {
  const bd = document.getElementById('log-bd');
  if (!bd) return;
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
  el.innerHTML = `<span>${ic[tipo]||'<img src="iconos/pipeline.svg" class="icono-svg-sm" />'}</span><span>${msg}</span>`;
  tc.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(20px)'; el.style.transition='all .3s'; setTimeout(()=>el.remove(),300); }, 3500);
}

// ────────────────────────────────────────────
// ESTADO Y REFRESH CON SERVIDORES
// ────────────────────────────────────────────
async function refrescar() {
  try {
    const res = await fetch(API_BASE + '/estado');
    if (res.ok) {
      const data = await res.json();
      const sDet = document.getElementById('s-det');
      const f1p = document.getElementById('f1p');
      const f1c = document.getElementById('f1c');
      const sDesc = document.getElementById('s-desc');
      if(sDet && data.estadisticas) sDet.textContent = data.estadisticas.historial;
      if(f1p && data.estadisticas) f1p.textContent = data.estadisticas.pendientes;
      if(f1c && data.estadisticas) f1c.textContent = data.estadisticas.completados;
      if(sDesc && data.estadisticas) sDesc.textContent = data.estadisticas.completados;
    }
  } catch(e) {}
  cargarFuentesDesdeServidor();
  cargarPendientesDesdeServidor();
  cargarGaleriaDesdeServidor();
  cargarEstadoCookies();
  mostrarToast('success','Estado y datos sincronizados con Ragnarok.');
  addLog('info','Actualización manual completada.');
}

async function refrescarEstadoAutomatico() {
  try {
    const res = await fetch(API_BASE + '/estado');
    if (!res.ok) return;
    const data = await res.json();
    if (data.fases) {
      for (const [f, st] of Object.entries(data.fases)) {
        if (App.fases[f] !== st) {
          App.fases[f] = st;
          const txtMap = { idle: 'Inactiva', running: 'Ejecutando...', done: 'Completada', error: 'Error' };
          setFaseUI(f, st, txtMap[st] || st);
          const card = document.getElementById('fc' + f);
          if (card) {
            if (st === 'running') card.classList.add('active-c');
            else card.classList.remove('active-c');
          }
          if (f === '1' && st === 'idle') {
            const f1b = document.getElementById('f1b');
            const f1pct = document.getElementById('f1pct');
            if (f1b) f1b.style.width = '0%';
            if (f1pct) f1pct.textContent = '0%';
            cargarPendientesDesdeServidor();
            cargarGaleriaDesdeServidor();
          }
        }
      }
      const tieneRunning = Object.values(data.fases).includes('running');
      if (tieneRunning) {
        setSysUI('running', 'Proceso en ejecución en el servidor');
      } else {
        setSysUI('idle', 'Sistema inactivo');
      }
    }
    if (data.estadisticas) {
      const sDet = document.getElementById('s-det');
      const f1p = document.getElementById('f1p');
      const f1c = document.getElementById('f1c');
      const sDesc = document.getElementById('s-desc');
      if(sDet) sDet.textContent = data.estadisticas.historial;
      if(f1p) f1p.textContent = data.estadisticas.pendientes;
      if(f1c) f1c.textContent = data.estadisticas.completados;
      if(sDesc) sDesc.textContent = data.estadisticas.completados;
    }
    if (data.fases && (data.fases['1'] === 'running' || data.fases[1] === 'running')) {
      cargarPendientesDesdeServidor();
    }
  } catch(e) {}
}
