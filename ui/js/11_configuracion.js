// ============================================================================
// MODULO: 11_configuracion.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// Responsabilidad Única: Gestión de Configuración, Parámetros y Scheduler
// ============================================================================

// ────────────────────────────────────────────
// SCHEDULER (PROGRAMADOR DE TAREAS)
// ────────────────────────────────────────────
function addTarea() {
  const elT = document.getElementById('sc-tarea');
  const elF = document.getElementById('sc-fecha');
  const elH = document.getElementById('sc-hora');
  if (!elT || !elF || !elH) return;
  const t = elT.value, f = elF.value, h = elH.value;
  if (!f || !h) {
    mostrarToast('warning', 'Completa fecha y hora para programar la tarea.');
    return;
  }
  const tbody = document.getElementById('tb-tareas');
  if (!tbody) return;

  // Remover fila vacía de aviso si existe
  const emptyRow = document.getElementById('sched-empty-row');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  const nombreTarea = t.split('(')[0].trim();
  tr.innerHTML = `
    <td class="tn">${escapeHtml(nombreTarea)}</td>
    <td class="tt">${escapeHtml(f)} ${escapeHtml(h)}</td>
    <td><span class="tbadge pend">En Cola Local</span></td>
    <td><button class="btn bs bsm" onclick="delTarea(this)" title="Eliminar tarea"><img src="iconos/eliminar.svg" class="icono-svg-sm" /></button></td>
  `;
  tbody.appendChild(tr);
  mostrarToast('info', `Tarea programada en cola local: ${nombreTarea} (En espera de demonio cron en Rust).`);
  addLog('info', `Tarea programada en cola local: <span class="hl">${escapeHtml(nombreTarea)}</span> para ${f} ${h}.`);
}

function delTarea(btn) {
  const tbody = document.getElementById('tb-tareas');
  btn.closest('tr')?.remove();
  mostrarToast('warning', 'Tarea eliminada de la cola local.');
  if (tbody && tbody.children.length === 0) {
    tbody.innerHTML = `
      <tr id="sched-empty-row">
        <td colspan="4" class="td-empty" style="padding:14px;text-align:center">
          <span style="color:var(--amber);font-weight:600">⏳ Módulo Scheduler en espera de demonio cron nativo en Rust</span><br>
          <span style="font-size:11px;color:var(--txt3)">Las tareas programadas se integrarán al servicio asíncrono de Tokio en la próxima versión.</span>
        </td>
      </tr>
    `;
  }
}

function guardarProg() {
  cerrarModal('m-programar');
  mostrarToast('info', 'Parámetros del scheduler configurados en memoria local (En espera de demonio cron en Rust).');
  addLog('info', 'Programación registrada localmente. En espera de demonio cron nativo.');
}

// ────────────────────────────────────────────
// PLATAFORMAS (GESTION DE ESTADOS Y CONEXIONES)
// ────────────────────────────────────────────
async function togPlat(nombre, cb) {
  const activo = cb.checked;
  const estadoStr = activo ? 'activada' : 'desactivada';

  if (nombre === 'YouTube' || nombre === 'TikTok' || nombre === 'Instagram') {
    mostrarToast('info', `${nombre}: ${estadoStr} localmente (En espera de conexión con backend de Rust).`);
    addLog('info', `Plataforma <span class="hl">${nombre}</span> ${estadoStr} localmente.`);
    return;
  }

  mostrarToast(activo ? 'success' : 'warning', `${nombre}: ${estadoStr}`);
  addLog(activo ? 'ok' : 'warn', `Plataforma <span class="hl">${nombre}</span> ${estadoStr}.`);
}

// ────────────────────────────────────────────
// MODAL DE CONFIGURACIÓN GLOBAL
// ────────────────────────────────────────────
function abrirProgramar() {
  abrirModal('m-programar');
}

async function abrirConfig() {
  abrirModal('m-config');
  try {
    const res = await fetch(API_BASE + '/config');
    if (!res.ok) return;
    const cfg = await res.json();

    if (cfg.extraccion) {
      if (cfg.extraccion.max_scrolls_por_sesion !== undefined) {
        const el = document.getElementById('cfg-max-scrolls');
        if (el) el.value = cfg.extraccion.max_scrolls_por_sesion;
      }
      if (cfg.extraccion.headless !== undefined) {
        const el = document.getElementById('cfg-headless');
        if (el) el.value = String(cfg.extraccion.headless);
      }
    }

    if (cfg.edicion) {
      if (cfg.edicion.factor_velocidad !== undefined) {
        const el = document.getElementById('cfg-velocidad');
        if (el) el.value = String(cfg.edicion.factor_velocidad);
      }
      if (cfg.edicion.duracion_bloque_segundos !== undefined) {
        const el = document.getElementById('cfg-dur-bloque');
        if (el) el.value = Math.round(cfg.edicion.duracion_bloque_segundos / 60);
      }
      if (cfg.edicion.threads_ffmpeg !== undefined) {
        const el = document.getElementById('cfg-threads');
        if (el) el.value = cfg.edicion.threads_ffmpeg;
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

    // Verificar estado en vivo de la sesión MTProto si está disponible la función
    if (typeof verificarEstadoSesionTelegram === 'function') {
      verificarEstadoSesionTelegram();
    }
  } catch (e) {
    // Sincronización silenciosa en caso de desconexión
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
      mostrarToast('success', `Configuración guardada en disco (Navegador CDP: ${headless ? 'Headless' : 'Visible'}).`);
      addLog('ok', `Configuración actualizada en backend: MaxScrolls=${maxScrolls}, Vel=${vel}x, Hilos=${threads}`);
    } else {
      mostrarToast('error', `Error al guardar: ${data.error || 'Desconocido'}`);
    }
  } catch (e) {
    cerrarModal('m-config');
    mostrarToast('warning', 'Configuración actualizada en vista local.');
  }
}

// ────────────────────────────────────────────
// MODAL DE VELOCIDAD DE EDICIÓN
// ────────────────────────────────────────────
function abrirVelocidad() {
  abrirModal('m-vel');
}

async function aplicarVel() {
  const checked = document.querySelector('input[name="vel"]:checked');
  const v = checked ? parseFloat(checked.value) : 1.0;
  cerrarModal('m-vel');

  try {
    const res = await fetch(API_BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edicion: {
          factor_velocidad: v
        }
      })
    });
    const data = await res.json();
    if (data.ok) {
      mostrarToast('success', `Factor de velocidad configurado en backend: ${v}x`);
      addLog('ok', `Factor de velocidad de edición actualizado en backend: <span class="hl">${v}x</span>.`);
      return;
    }
  } catch (e) {}

  mostrarToast('info', `Velocidad local: ${v}x`);
  addLog('info', `Factor de velocidad actualizado localmente: <span class="hl">${v}x</span>.`);
}

document.querySelectorAll('.mover').forEach(o => {
  o.addEventListener('click', e => {
    if (e.target === o) cerrarModal(o.id);
  });
});
