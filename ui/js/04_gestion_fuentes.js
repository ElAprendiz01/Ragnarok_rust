// ============================================================================
// MODULO: 04_gestion_fuentes.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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
