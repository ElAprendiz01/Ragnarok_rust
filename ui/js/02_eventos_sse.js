// ============================================================================
// MODULO: 02_eventos_sse.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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
    while (bd.childNodes.length > 200) {
      bd.removeChild(bd.firstChild);
    }
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
