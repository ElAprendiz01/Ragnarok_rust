// ============================================================================
// MODULO: 05_cola_pendientes.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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
