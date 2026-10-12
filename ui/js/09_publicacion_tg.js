// ============================================================================
// MODULO: 09_publicacion_tg.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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
          <span style="color:var(--txt3);font-size:11px;margin-left:3px;cursor:pointer" title="Eliminar canal de la lista" onclick="event.stopPropagation();eliminarCanalTelegram('${escapeHtml(c)}')">&times;</span>
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
  const modoVideo = document.getElementById('m-tg-lote-modo-video')?.value || 'completo';
  const forzar = document.getElementById('m-tg-lote-forzar')?.checked || false;

  cerrarModal('m-telegram-lotes');
  mostrarToast('info', `Iniciando publicación en lote para ${canal} (MTProto Nativo${forzar ? ' - REINICIO TOTAL' : ''})...`);
  addLog('info', `Iniciando cola por lotes Telegram hacia <span class="hl">${escapeHtml(canal)}</span> (MTProto Nativo Puro, Modo: ${modoVideo}${forzar ? ', Forzar: SI' : ''}).`);

  App.fases[4] = 'running';
  setFaseUI(4, 'running', 'Procesando cola en disco (Telegram MTProto)...');
  document.getElementById('fc4')?.classList.add('active-c');
  setSysUI('running', 'Publicación en lote Telegram en ejecución');

  try {
    const res = await fetch(API_BASE + '/api/publicar/lote/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canal: canal,
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
      ${yaSubido ? '<span style="color:#2ea043;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid rgba(46,160,67,0.3);background:rgba(46,160,67,0.1);display:inline-flex;align-items:center;gap:3px"><img src="iconos/check.svg" class="icono-svg-sm" style="width:10px;height:10px" /> Ya en Telegram</span>' : ''}
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
  const canalInput = document.getElementById('m-tg-canal-input')?.value.trim() || App.canalTelegramActivo;
  cerrarModal('m-telegram-manual');

  mostrarToast('info', `Iniciando cola de ${seleccionados.length} video(s) seleccionado(s) en Telegram HD (MTProto)...`);
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
// AUTENTICACION Y SESION TELEGRAM MTPROTO EN VIVO
// ────────────────────────────────────────────

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
        errBox.textContent = msg;
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
  const confirmar = await mostrarModalConfirmacion({
    tag: 'DESVINCULAR SESION OFICIAL',
    titulo: '¿Desvincular Sesión de Telegram?',
    subtitulo: 'Se eliminará la sesión local persistente del protocolo MTProto de grammers_client.',
    itemTitulo: 'Sesión de Telegram',
    detalles: [{ label: 'Protocolo', desc: 'MTProto Nativo Rust' }],
    nota: 'Podrás volver a autenticarte en cualquier momento ingresando tu número y código.',
    textoConfirmar: 'Desvincular Sesión',
    icono: 'telegram.svg',
    peligro: true
  });
  if (!confirmar) return;

  try {
    const res = await fetch(API_BASE + '/api/telegram/desvincular', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('info', 'Sesión de Telegram desvinculada.');
      addLog('info', 'Sesión de Telegram eliminada.');
      verificarEstadoSesionTelegram();
    } else {
      mostrarToast('error', `Error al desvincular: ${data.error || 'Desconocido'}`);
    }
  } catch(e) {
    mostrarToast('error', 'Error de conexión con el backend de Ragnarok.');
  }
}

