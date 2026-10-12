// ============================================================================
// Ragnarok — Orquestador de Módulos (Legacy Entrypoint / Auto-Loader)
// Carga automática de los 11 submódulos si no fueron incluidos en el HTML
// ============================================================================
(function() {
  if (window.__RAGNAROK_MODULOS_CARGADOS__) return;
  const modulos = [
    'js/01_core_estado.js',
    'js/02_eventos_sse.js',
    'js/03_pipeline_fases.js',
    'js/04_gestion_fuentes.js',
    'js/05_cola_pendientes.js',
    'js/06_galeria_videos.js',
    'js/07_reproductor_pip.js',
    'js/08_estudio_editor.js',
    'js/09_publicacion_tg.js',
    'js/10_auth_facebook.js',
    'js/11_configuracion.js'
  ];
  modulos.forEach(src => {
    if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.head.appendChild(s);
    }
  });
})();
