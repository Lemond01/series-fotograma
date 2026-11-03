import axios from '../../node_modules/axios/dist/esm/axios.min.js';

const BASE_URL = 'https://api.tvmaze.com';
const TIMEOUT_MS = 10000;
const RATE_LIMIT_RETRY_DELAY_MS = 1500;

// Cliente de la API de TVmaze
const http = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

export class ApiError extends Error {
  constructor(type, message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.type = type;
    this.status = status;
  }
}

// Errores
function toApiError(error) {
  if (error instanceof ApiError) return error;

  if (axios.isCancel(error)) {
    return new ApiError('aborted', 'Solicitud cancelada', { cause: error });
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ApiError('timeout', 'Tiempo de espera agotado', { cause: error });
  }
  if (error.response) {
    const { status } = error.response;
    if (status === 404) return new ApiError('not-found', 'Recurso no encontrado', { status, cause: error });
    if (status === 429) return new ApiError('rate-limit', 'Límite de solicitudes superado', { status, cause: error });
    return new ApiError('http', `Error HTTP ${status}`, { status, cause: error });
  }
  if (error.request) {
    return new ApiError('network', 'Error de red', { cause: error });
  }
  return new ApiError('http', error.message || 'Error desconocido', { cause: error });
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Caché en memoria (clave -> promesa)
const cache = new Map();

async function fetchJson(path, { params, signal } = {}) {
  try {
    const response = await http.get(path, { params, signal });
    return response.data;
  } catch (error) {
    const apiError = toApiError(error);
    // Un reintento si TVmaze responde 429
    if (apiError.type === 'rate-limit' && !signal?.aborted) {
      await wait(RATE_LIMIT_RETRY_DELAY_MS);
      try {
        const response = await http.get(path, { params, signal });
        return response.data;
      } catch (retryError) {
        throw toApiError(retryError);
      }
    }
    throw apiError;
  }
}

function cachedRequest(key, path, { params, signal } = {}) {
  if (cache.has(key)) return cache.get(key);

  const promise = fetchJson(path, { params, signal });

  if (!signal) {
    cache.set(key, promise);
    promise.catch(() => cache.delete(key)); // no cachear errores
    return promise;
  }

  return promise.then((data) => {
    cache.set(key, Promise.resolve(data));
    return data;
  });
}

const isObject = (value) => value !== null && typeof value === 'object';
const textOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Normalización
function normalizeImage(image) {
  if (!isObject(image)) return null;
  const medium = textOrNull(image.medium);
  const original = textOrNull(image.original);
  if (!medium && !original) return null;
  return { medium: medium ?? original, original: original ?? medium };
}

function normalizeShow(show) {
  if (!isObject(show) || typeof show.id !== 'number') return null;
  const premiered = textOrNull(show.premiered);
  return {
    id: show.id,
    name: textOrNull(show.name) ?? 'Sin título',
    year: premiered ? premiered.slice(0, 4) : null,
    premiered,
    ended: textOrNull(show.ended),
    genres: Array.isArray(show.genres) ? show.genres.filter((g) => typeof g === 'string') : [],
    rating: numberOrNull(show.rating?.average),
    image: normalizeImage(show.image),
    summary: textOrNull(show.summary),
    language: textOrNull(show.language),
    status: textOrNull(show.status),
    runtime: numberOrNull(show.runtime) ?? numberOrNull(show.averageRuntime),
    network: textOrNull(show.network?.name) ?? textOrNull(show.webChannel?.name),
    scheduleDays: Array.isArray(show.schedule?.days) ? show.schedule.days : [],
    scheduleTime: textOrNull(show.schedule?.time),
  };
}

function normalizeEpisode(episode) {
  if (!isObject(episode) || typeof episode.id !== 'number') return null;
  return {
    id: episode.id,
    name: textOrNull(episode.name) ?? 'Sin título',
    season: numberOrNull(episode.season),
    number: numberOrNull(episode.number),
    airdate: textOrNull(episode.airdate),
    airstamp: textOrNull(episode.airstamp),
    runtime: numberOrNull(episode.runtime),
    image: normalizeImage(episode.image),
    summary: textOrNull(episode.summary),
  };
}

function ensureArray(data) {
  if (!Array.isArray(data)) throw new ApiError('invalid', 'Formato de respuesta inesperado');
  return data;
}

// GET /search/shows?q=
export async function searchShows(query, { signal } = {}) {
  const q = query.trim();
  const key = `search:${q.toLowerCase()}`;
  const data = ensureArray(await cachedRequest(key, '/search/shows', { params: { q }, signal }));
  return data.map((result) => normalizeShow(result?.show)).filter(Boolean);
}

// GET /shows?page=
export async function getShowIndex(page = 0) {
  const data = ensureArray(await cachedRequest(`index:${page}`, '/shows', { params: { page } }));
  return data.map(normalizeShow).filter(Boolean);
}

// GET /shows/:id
export async function getShowDetails(id) {
  const data = await cachedRequest(`show:${id}`, `/shows/${encodeURIComponent(id)}`);
  const show = normalizeShow(data);
  if (!show) throw new ApiError('invalid', 'Formato de respuesta inesperado');
  return show;
}

// GET /shows/:id/episodes
export async function getShowEpisodes(id) {
  const data = ensureArray(await cachedRequest(`episodes:${id}`, `/shows/${encodeURIComponent(id)}/episodes`));
  return data.map(normalizeEpisode).filter(Boolean);
}

// GET /schedule/web
export async function getWebSchedule() {
  const data = ensureArray(await cachedRequest('schedule:web', '/schedule/web'));
  return data
    .map((item) => {
      const episode = normalizeEpisode(item);
      const show = normalizeShow(item?._embedded?.show);
      return episode && show ? { ...episode, show } : null;
    })
    .filter(Boolean);
}
