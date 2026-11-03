// Solo se guardan los IDs de TVmaze
const STORAGE_KEY = 'series-atlas:favorites';
const CHANGE_EVENT = 'favorites:change';

const events = new EventTarget();
let memoryFallback = null;

function toValidId(value) {
  const id = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(toValidId).filter((id) => id !== null))];
}

// localStorage puede no estar disponible (modo privado)
function readStorage() {
  if (memoryFallback) return [...memoryFallback];
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[Favoritos] localStorage no está disponible; se usará memoria temporal.', error);
    memoryFallback = [];
    return [];
  }
  if (raw === null) return [];
  try {
    return sanitize(JSON.parse(raw));
  } catch (error) {
    console.warn('[Favoritos] Se ignoró un valor guardado no válido.', error);
    return [];
  }
}

function writeStorage(ids) {
  if (memoryFallback) {
    memoryFallback = [...ids];
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (error) {
    console.warn('[Favoritos] No se pudo guardar en localStorage; se usará memoria temporal.', error);
    memoryFallback = [...ids];
  }
}

function notify(detail) {
  events.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail }));
}

export function getFavoriteIds() {
  return readStorage();
}

export function isFavorite(id) {
  const validId = toValidId(id);
  return validId !== null && readStorage().includes(validId);
}

export function getFavoritesCount() {
  return readStorage().length;
}

export function addFavorite(id) {
  const validId = toValidId(id);
  if (validId === null) return false;
  const ids = readStorage();
  if (ids.includes(validId)) return false;
  writeStorage([validId, ...ids]);
  notify({ id: validId, isFavorite: true });
  return true;
}

export function removeFavorite(id) {
  const validId = toValidId(id);
  if (validId === null) return false;
  const ids = readStorage();
  if (!ids.includes(validId)) return false;
  writeStorage(ids.filter((item) => item !== validId));
  notify({ id: validId, isFavorite: false });
  return true;
}

export function toggleFavorite(id) {
  if (isFavorite(id)) {
    removeFavorite(id);
    return false;
  }
  return addFavorite(id);
}

export function onFavoritesChange(callback) {
  const handler = (event) => callback(event.detail);
  events.addEventListener(CHANGE_EVENT, handler);
  return () => events.removeEventListener(CHANGE_EVENT, handler);
}

// Sincronización entre pestañas
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    notify({ external: true });
  }
});
