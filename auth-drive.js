const CLIENT_ID = '888656839698-7i9b4oekg8qc09s9asrf9t92v8jecsst.apps.googleusercontent.com'; // REEMPLAZAR
const API_KEY = 'AIzaSyB5UTbkPn61UYhkad1WjXjCoAtf_-uWmzk'; // REEMPLAZAR
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
// Usamos drive.file tal como lo tienes configurado en Google Cloud
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile';
const CONFIG_FILE_NAME = 'config_usuario.json';

const DEFAULT_PROFILE_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%232a2a2a'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%23555'/%3E%3Cellipse cx='50' cy='82' rx='28' ry='20' fill='%23555'/%3E%3C/svg%3E";

let tokenClient;
let accessToken = null;
let gapiInited = false;
let gisInited = false;

// Estructura inicial y local
let localConfig = {
  favorites: [],
  history: [],
  recently_watched: [],
  playback_progress: {},
  last_sync: 0
};

// --- 1. GESTIÓN LOCAL (localStorage) ---
const RECENTLY_WATCHED_KEY = 'movie_history_v1';

function loadLocalConfig() {
  const stored = localStorage.getItem('mauritv_config');
  if (stored) {
    try {
      localConfig = JSON.parse(stored);
      // Ensure all arrays/objects exist in case they were missing in older configs
      if (!localConfig.favorites) localConfig.favorites = [];
      if (!localConfig.history) localConfig.history = [];
      if (!localConfig.recently_watched) localConfig.recently_watched = [];
      if (!localConfig.playback_progress) localConfig.playback_progress = {};

      // Mirror recently_watched into the standalone localStorage key so
      // index.html can always read it without depending on auth-drive.js
      if (localConfig.recently_watched.length > 0) {
        localStorage.setItem(RECENTLY_WATCHED_KEY, JSON.stringify(localConfig.recently_watched));
      }

      console.log('Configuración local cargada');
    } catch (e) {
      console.error('Error parseando config local', e);
      localConfig = { favorites: [], history: [], recently_watched: [], playback_progress: {}, last_sync: 0 };
    }
  }
}

function saveLocalConfig() {
  localConfig.last_sync = Date.now();
  localStorage.setItem('mauritv_config', JSON.stringify(localConfig));
}

// --- 2. GESTIÓN DE SESIÓN DE GOOGLE ---
function checkPersistedSession() {
  const storedToken = localStorage.getItem('google_access_token');
  const expiry = localStorage.getItem('google_token_expiry');

  if (storedToken && expiry && Date.now() < parseInt(expiry, 10)) {
    console.log('Sesión válida encontrada en localStorage');
    accessToken = storedToken;
    updateProfileUI();
    // Inicia sincronización silenciosa si ya cargaron las APIs
    if (gapiInited) syncWithDrive();
  } else {
    handleLogout(false); // Limpia si expiró
  }
}

function saveSession(token, expiresIn) {
  accessToken = token;
  // expiresIn viene en segundos, le restamos un margen de seguridad (ej. 1 minuto)
  const expiryTime = Date.now() + (expiresIn - 60) * 1000;
  localStorage.setItem('google_access_token', token);
  localStorage.setItem('google_token_expiry', expiryTime.toString());
  updateProfileUI();
}

function handleLogout(interactive = true) {
  accessToken = null;
  localStorage.removeItem('google_access_token');
  localStorage.removeItem('google_token_expiry');

  // Restaurar UI
  const profileImg = document.getElementById('profile-img');
  if (profileImg) profileImg.src = DEFAULT_PROFILE_IMG;

  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  if (interactive) {
    console.log('Sesión cerrada');
  }
}

// Obtiene los datos del perfil y actualiza la imagen
async function updateProfileUI() {
  if (!accessToken) return;

  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (response.ok) {
      const data = await response.json();
      const profileImg = document.getElementById('profile-img');
      const profileName = document.getElementById('profile-name');

      if (profileImg && data.picture) {
        profileImg.src = data.picture;
      }
      if (profileName && data.name) {
        profileName.textContent = data.name;
      }
    }
  } catch (err) {
    console.error('Error obteniendo perfil:', err);
  }
}

// --- 3. INICIALIZACIÓN DE GOOGLE APIs ---
function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC],
  });
  gapiInited = true;
  maybeEnableButtons();
  if (accessToken) {
    gapi.client.setToken({ access_token: accessToken });
    syncWithDrive();
  }
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error !== undefined) {
        throw (resp);
      }

      // Verificar si el usuario realmente aprobó el permiso de Drive
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/drive.file')) {
        console.error('El usuario no otorgó los permisos requeridos.');
        alert('Debes marcar la casilla para darle permiso a la aplicación de guardar tus datos.');
        handleLogout(false);
        return;
      }

      console.log('Login exitoso. Token y permisos obtenidos.');
      // Guardar token en localStorage
      saveSession(resp.access_token, resp.expires_in);

      // Sincronizar
      if (gapiInited) syncWithDrive();
    },
  });
  gisInited = true;
  maybeEnableButtons();
}

function maybeEnableButtons() {
  if (gapiInited && gisInited) {
    const loginBtn = document.getElementById('profile-btn');
    const logoutBtn = document.getElementById('btn-logout');

    if (loginBtn) {
      loginBtn.disabled = false;
      // Quitamos el onclick anterior si existía para evitar duplicados
      loginBtn.onclick = handleAuthClick;
    }

    if (logoutBtn) {
      logoutBtn.onclick = () => handleLogout(true);
    }
  }
}

// --- 4. LOGIN Y DROPDOWN ---
function handleAuthClick() {
  if (!tokenClient) return;

  if (accessToken) {
    // Si ya estamos logueados, el botón alterna el menú desplegable
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  } else {
    // Si no estamos logueados, inicia flujo de Google
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }
}

// --- 5. SINCRONIZACIÓN CON DRIVE ---
async function syncWithDrive() {
  if (!accessToken) return;

  try {
    const fileId = await findConfigFile();

    if (fileId) {
      console.log('Archivo encontrado en Drive. Descargando...');
      const driveData = await downloadFromDrive(fileId);

      if (driveData && driveData.last_sync > localConfig.last_sync) {
        console.log('Datos de Drive más recientes. Actualizando local...');

        // Guardar el historial local antes de sobreescribir (podría tener items nuevos)
        const localRecentIds = new Set(
          (localConfig.recently_watched || []).map(i => String(i.id))
        );

        localConfig = driveData;
        // Asegurar campos que podrían no existir en configs antiguas de Drive
        if (!localConfig.recently_watched) localConfig.recently_watched = [];
        if (!localConfig.favorites) localConfig.favorites = [];
        if (!localConfig.history) localConfig.history = [];
        if (!localConfig.playback_progress) localConfig.playback_progress = {};

        // Mergear items locales que Drive no tenga (evita pérdida de datos)
        const localStandalone = JSON.parse(localStorage.getItem(RECENTLY_WATCHED_KEY) || '[]');
        for (const item of localStandalone) {
          const driveHas = localConfig.recently_watched.some(i => String(i.id) === String(item.id));
          if (!driveHas) {
            localConfig.recently_watched.push(item);
          }
        }
        // Limitar a 10 y guardar
        localConfig.recently_watched = localConfig.recently_watched.slice(0, 10);

        localStorage.setItem('mauritv_config', JSON.stringify(localConfig));
        // Espejo en la clave standalone para que index.html siempre vea el historial actualizado
        if (localConfig.recently_watched.length > 0) {
          localStorage.setItem(RECENTLY_WATCHED_KEY, JSON.stringify(localConfig.recently_watched));
        } else {
          localStorage.removeItem(RECENTLY_WATCHED_KEY);
        }

      } else if (driveData && driveData.last_sync < localConfig.last_sync) {
        console.log('Datos locales más recientes. Actualizando Drive...');
        await saveToDrive(fileId, localConfig);
      } else {
        console.log('Datos sincronizados.');
      }
    } else {
      console.log('Archivo no encontrado. Creando uno nuevo en Drive...');
      await createInDrive(localConfig);
    }

    // Notificar a la página que el historial puede haber cambiado (siempre, tras cualquier sync)
    window.dispatchEvent(new CustomEvent('recentlyWatchedUpdated'));

  } catch (error) {
    console.error('Error en sincronización con Drive:', error);
    if (error.status === 401 || error.status === 403) {
      // Si el token es inválido/expiró o faltan permisos
      alert('Tu sesión de Google ha expirado o es inválida. Por favor, vuelve a iniciar sesión en la página principal para seguir sincronizando tus favoritos con Drive.');
      handleLogout(false);
    }
  }
}

async function findConfigFile() {
  const response = await gapi.client.drive.files.list({
    q: `name='${CONFIG_FILE_NAME}' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive' // Buscar en el Drive normal
  });
  const files = response.result.files;
  if (files && files.length > 0) {
    return files[0].id;
  }
  return null;
}

async function downloadFromDrive(fileId) {
  const response = await gapi.client.drive.files.get({
    fileId: fileId,
    alt: 'media'
  });
  return response.result;
}

async function saveToDrive(fileId, data) {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    throw new Error('Fallo al actualizar el archivo en Drive');
  }
}

async function createInDrive(data) {
  const metadata = {
    name: CONFIG_FILE_NAME,
    mimeType: 'application/json'
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error('Fallo al crear archivo en Drive');
  }
  const result = await response.json();
  console.log('Archivo creado con ID:', result.id);
}

// --- UTILIDADES PARA LA APP ---
function agregarFavorito(movieObj) {
  console.log('Intentando agregar a favorito:', movieObj);
  if (!localConfig.favorites) localConfig.favorites = [];
  localConfig.favorites.push(movieObj);
  saveLocalConfig();
  console.log('Guardado en localStorage exitosamente');
  if (accessToken) syncWithDrive();
}

function removerFavorito(movieId) {
  console.log('Intentando quitar de favorito:', movieId);
  if (!localConfig.favorites) localConfig.favorites = [];
  localConfig.favorites = localConfig.favorites.filter(fav => String(fav.id) !== String(movieId));
  saveLocalConfig();
  console.log('Eliminado de localStorage exitosamente');
  if (accessToken) syncWithDrive();
}

function esFavorito(movieId) {
  if (!localConfig.favorites) return false;
  return localConfig.favorites.some(fav => String(fav.id) === String(movieId));
}


function actualizarHistorial(movieObj) {
  localConfig.history.push(movieObj);
  saveLocalConfig();
  if (accessToken) syncWithDrive();
}

// --- HISTORIAL DE VISTO RECIENTEMENTE (máx. 10 elementos) ---

/**
 * Guarda una película/serie en el historial de "Vistos recientemente".
 * Persiste en localStorage Y en Drive si el usuario está logueado.
 */
function guardarReciente(movieObj) {
  if (!localConfig.recently_watched) localConfig.recently_watched = [];

  // Eliminar duplicado si ya existe
  localConfig.recently_watched = localConfig.recently_watched.filter(
    item =>
      String(item.id) !== String(movieObj.id) &&
      !(item.tmdbId && movieObj.tmdbId && String(item.tmdbId) === String(movieObj.tmdbId))
  );

  // Insertar al inicio
  localConfig.recently_watched.unshift(movieObj);

  // Mantener máximo 10 elementos
  if (localConfig.recently_watched.length > 10) {
    localConfig.recently_watched = localConfig.recently_watched.slice(0, 10);
  }

  // Persistir localmente
  saveLocalConfig();

  // Espejo en la clave standalone para compatibilidad con código que no usa auth-drive.js
  localStorage.setItem(RECENTLY_WATCHED_KEY, JSON.stringify(localConfig.recently_watched));

  // Sincronizar con Drive si el usuario está logueado
  if (accessToken) syncWithDrive();
}

/**
 * Devuelve el historial de vistos recientemente.
 * Jerarquía de fuentes (de mayor a menor prioridad):
 *   1. localConfig en memoria (si el usuario está logueado y tiene datos)
 *   2. HISTORY_KEY en localStorage (clave standalone, siempre disponible)
 *   3. recently_watched dentro de mauritv_config en localStorage (fallback)
 */
function obtenerRecientes() {
  // 1. localConfig en memoria (logueado + synced)
  if (accessToken && localConfig.recently_watched && localConfig.recently_watched.length > 0) {
    return localConfig.recently_watched;
  }
  // 2. Clave standalone
  const standalone = JSON.parse(localStorage.getItem(RECENTLY_WATCHED_KEY) || '[]');
  if (standalone.length > 0) return standalone;
  // 3. Fallback desde mauritv_config en localStorage
  try {
    const cfg = JSON.parse(localStorage.getItem('mauritv_config') || '{}');
    return cfg.recently_watched || [];
  } catch (e) {
    return [];
  }
}

/**
 * Borra el historial de vistos recientemente de localStorage y Drive.
 */
function borrarRecientes() {
  localConfig.recently_watched = [];
  saveLocalConfig();
  localStorage.removeItem(RECENTLY_WATCHED_KEY);
  if (accessToken) syncWithDrive();
}

function actualizarProgreso(movieId, position, duration) {
  localConfig.playback_progress[movieId] = {
    position,
    duration,
    last_updated: Date.now()
  };
  saveLocalConfig();
  if (accessToken) syncWithDrive();
}

// Cargar estado inicial
loadLocalConfig();
checkPersistedSession();
