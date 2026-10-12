// ============================================================================
// MODULO: 03_pipeline_fases.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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
