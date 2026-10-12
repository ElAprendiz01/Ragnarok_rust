// ============================================================================
// MODULO: 06_galeria_videos.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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

