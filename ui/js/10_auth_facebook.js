// ============================================================================
// MODULO: 10_auth_facebook.js
// Ecosistema Ragnarok — Arquitectura Modular Ultra Ligera
// ============================================================================

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
    if (btn) { btn.disabled = false; btn.innerHTML = '<img src="iconos/facebook.svg" class="icono-svg-sm" /> Abrir Navegador para Iniciar Sesión'; }
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
    if (btn) { btn.disabled = false; btn.innerHTML = '<img src="iconos/check.svg" class="icono-svg-sm" /> Ya entré a mi cuenta — Guardar y Vincular Sesión'; }
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

async function iniciarSesionTelegramMTProto() {
  abrirConfig();
  mostrarToast('info', 'Gestiona tu sesión oficial de Telegram MTProto nativo ingresando tu número y código.');
  setTimeout(() => {
    const el = document.getElementById('cfg-tg-phone');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }, 250);
}
const iniciarSesionTelegramWeb = iniciarSesionTelegramMTProto;


