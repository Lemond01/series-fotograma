import { searchShows, getShowIndex, getShowDetails } from './api.js';
import {
  initPage, createSeriesCard, createSkeletonCard, createElement, showStatus, fillErrorMessage,
  debounce, translateStatus, translateGenre, KNOWN_GENRES,
} from './ui.js';
import { getFavoriteIds, removeFavorite, onFavoritesChange } from './favorites.js';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;
const CATALOG_PAGE = 0;
const DEFAULT_SORT = 'relevancia';

const KNOWN_STATUSES = ['Running', 'Ended', 'To Be Determined', 'In Development'];

initPage();

// Elementos
const form = document.querySelector('[data-search-form]');
const input = document.querySelector('[data-search-input]');
const genreList = document.querySelector('[data-genre-filter]');
const moreGenresItem = genreList.querySelector('[data-more-genres-item]');
const moreGenresButton = genreList.querySelector('[data-more-genres]');
const statusSelect = document.getElementById('estado');
const sortSelect = document.getElementById('orden');
const clearButtons = [...document.querySelectorAll('[data-clear-filters]')];
const statusContainer = document.querySelector('[data-results-status]');
const grid = document.querySelector('[data-results-grid]');
const title = document.querySelector('[data-results-title]');
const count = document.querySelector('[data-results-count]');
const emptyTitle = statusContainer.querySelector('[data-empty-title]');
const emptyText = statusContainer.querySelector('[data-empty-text]');
const errorMessage = statusContainer.querySelector('[data-status="error"]');
const relevanceOption = sortSelect.querySelector('option[value="relevancia"]');

const MAIN_GENRES = [...genreList.querySelectorAll('[data-genre]')]
  .map((button) => button.dataset.genre)
  .filter(Boolean);
const AVAILABLE_GENRES = [...new Set([...MAIN_GENRES, ...KNOWN_GENRES])];
const SORT_VALUES = [...sortSelect.options].map((option) => option.value);

// Estado
const filters = {
  genres: new Set(),
  status: '',
  sort: DEFAULT_SORT,
};

let source = { mode: null, query: '', shows: [] };

let activeController = null;
let latestRequestId = 0;
let lastRequest = null;

const hasActiveFilters = () => filters.genres.size > 0 || filters.status !== '';

function normalizeQuery(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function matchAllowed(value, allowed) {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return allowed.find((item) => item.toLowerCase() === lower) ?? null;
}

// URL
function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const genres = params.getAll('genre')
    .map((value) => matchAllowed(value, AVAILABLE_GENRES))
    .filter(Boolean);
  return {
    query: normalizeQuery(params.get('q') ?? ''),
    genres: new Set(genres),
    status: matchAllowed(params.get('status'), KNOWN_STATUSES) ?? '',
    sort: matchAllowed(params.get('sort'), SORT_VALUES) ?? DEFAULT_SORT,
  };
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  const query = normalizeQuery(input.value);
  if (query.length >= MIN_QUERY_LENGTH) params.set('q', query);
  filters.genres.forEach((genre) => params.append('genre', genre));
  if (filters.status) params.set('status', filters.status);
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  const search = params.toString();
  const { pathname, hash } = window.location;
  window.history.replaceState(null, '', `${pathname}${search ? `?${search}` : ''}${hash}`);
}

// Filtros y orden (en memoria)
const nameCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

// Los valores nulos siempre al final
function compareNullable(a, b, direction, compare) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction * compare(a, b);
}

const SORTERS = {
  'rating-desc': (a, b) => compareNullable(a.rating, b.rating, -1, (x, y) => x - y),
  'rating-asc': (a, b) => compareNullable(a.rating, b.rating, 1, (x, y) => x - y),
  'name-asc': (a, b) => nameCollator.compare(a.name, b.name),
  'name-desc': (a, b) => nameCollator.compare(b.name, a.name),
  'year-desc': (a, b) => compareNullable(a.premiered, b.premiered, -1, (x, y) => x.localeCompare(y)),
  'year-asc': (a, b) => compareNullable(a.premiered, b.premiered, 1, (x, y) => x.localeCompare(y)),
};

// Géneros: basta con que coincida uno
function applyFilters(shows, { genres, status, sort }) {
  const filtered = shows.filter((show) => {
    if (genres.size > 0 && !show.genres.some((genre) => genres.has(genre))) return false;
    if (status && show.status !== status) return false;
    return true;
  });
  const sorter = SORTERS[sort];
  return sorter ? [...filtered].sort(sorter) : filtered;
}

// Controles
let moreGenresExpanded = false;

function getExtraGenres() {
  const found = new Set(source.shows.flatMap((show) => show.genres));
  filters.genres.forEach((genre) => found.add(genre));
  return [...found]
    .filter((genre) => !MAIN_GENRES.includes(genre))
    .sort((a, b) => nameCollator.compare(translateGenre(a), translateGenre(b)));
}

function syncExtraGenreChips() {
  const focused = genreList.contains(document.activeElement) ? document.activeElement : null;
  const focusedGenre = focused?.closest('[data-extra-genre]') ? focused.dataset.genre : null;
  genreList.querySelectorAll('[data-extra-genre]').forEach((item) => item.remove());
  const extras = getExtraGenres();
  moreGenresItem.hidden = extras.length === 0;
  if (extras.length === 0) return;

  if (extras.some((genre) => filters.genres.has(genre))) moreGenresExpanded = true;
  moreGenresButton.setAttribute('aria-expanded', String(moreGenresExpanded));
  moreGenresButton.textContent = moreGenresExpanded ? 'Menos géneros' : `Más géneros (${extras.length})`;

  const items = extras.map((genre) => {
    const item = createElement('li');
    item.dataset.extraGenre = '';
    item.hidden = !moreGenresExpanded;
    const button = createElement('button', 'chip', translateGenre(genre));
    button.type = 'button';
    button.dataset.genre = genre;
    item.append(button);
    return item;
  });
  moreGenresItem.after(...items);
  if (focusedGenre) genreList.querySelector(`[data-extra-genre] [data-genre="${CSS.escape(focusedGenre)}"]`)?.focus();
}

function syncGenreButtons() {
  syncExtraGenreChips();
  genreList.querySelectorAll('button[data-genre]').forEach((button) => {
    const genre = button.dataset.genre;
    const pressed = genre ? filters.genres.has(genre) : filters.genres.size === 0;
    button.setAttribute('aria-pressed', String(pressed));
  });
}

function syncStatusOptions() {
  // Los recuentos ignoran el filtro de estado
  const byGenre = applyFilters(source.shows, { genres: filters.genres, status: '', sort: DEFAULT_SORT });
  const present = new Set(source.shows.map((show) => show.status).filter(Boolean));
  if (filters.status) present.add(filters.status);

  const ordered = [
    ...KNOWN_STATUSES.filter((status) => present.has(status)),
    ...[...present].filter((status) => !KNOWN_STATUSES.includes(status)).sort(),
  ];

  const options = [new Option(source.mode ? `Todos (${byGenre.length})` : 'Todos', '')];
  ordered.forEach((status) => {
    const total = byGenre.filter((show) => show.status === status).length;
    options.push(new Option(`${translateStatus(status)} (${total})`, status));
  });
  statusSelect.replaceChildren(...options);
  statusSelect.value = filters.status;
}

function syncSortSelect() {
  relevanceOption.textContent = source.mode === 'search' ? 'Relevancia' : 'Orden de TVmaze';
  sortSelect.value = filters.sort;
}

function syncControls() {
  syncGenreButtons();
  syncStatusOptions();
  syncSortSelect();
  clearButtons.forEach((button) => { button.hidden = !hasActiveFilters(); });
}

function describeSource() {
  return source.mode === 'search'
    ? `resultados para «${source.query}»`
    : 'series de la primera página del índice de TVmaze';
}

function hideResults() {
  grid.hidden = true;
  grid.replaceChildren();
  count.textContent = '';
}

function render() {
  syncControls();
  writeStateToUrl();
  if (!source.mode) return;

  title.textContent = source.mode === 'search' ? 'Resultados' : 'Catálogo';
  const total = source.shows.length;

  if (total === 0) {
    hideResults();
    emptyTitle.textContent = 'Sin resultados';
    emptyText.textContent = source.mode === 'search'
      ? `No encontramos series para «${source.query}». Prueba con otro título.`
      : 'TVmaze no devolvió series para el catálogo.';
    showStatus(statusContainer, 'empty');
    return;
  }

  const visible = applyFilters(source.shows, filters);

  if (visible.length === 0) {
    hideResults();
    emptyTitle.textContent = 'Ninguna serie coincide';
    emptyText.textContent = `Ninguna de las ${total} ${describeSource()} cumple los filtros seleccionados.`;
    showStatus(statusContainer, 'empty');
    return;
  }

  grid.replaceChildren(...visible.map(createSeriesCard));
  grid.hidden = false;
  count.textContent = hasActiveFilters()
    ? `Mostrando ${visible.length} de ${total} ${describeSource()}`
    : `${total} ${describeSource()}`;
  showStatus(statusContainer, null);
}

// Carga de datos
function cancelActiveRequest() {
  activeController?.abort();
  activeController = null;
  latestRequestId += 1;
}

async function load(mode, query = '') {
  cancelActiveRequest();
  const controller = mode === 'search' ? new AbortController() : null;
  activeController = controller;
  const requestId = latestRequestId;
  lastRequest = { mode, query };

  hideResults();
  showStatus(statusContainer, 'loading');

  try {
    const shows = mode === 'search'
      ? await searchShows(query, { signal: controller.signal })
      : await getShowIndex(CATALOG_PAGE);
    if (requestId !== latestRequestId) return; // respuesta de una búsqueda anterior
    source = { mode, query, shows };
    render();
  } catch (error) {
    if (error.type === 'aborted' || requestId !== latestRequestId) return;
    console.error(`[Explorar] Error al cargar ${mode === 'search' ? `la búsqueda «${query}»` : 'el catálogo'}:`, error);
    source = { mode: null, query: '', shows: [] };
    hideResults();
    syncControls();
    fillErrorMessage(errorMessage, error);
    showStatus(statusContainer, 'error');
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function updateSource(rawValue, { force = false } = {}) {
  const query = normalizeQuery(rawValue);
  const mode = query.length >= MIN_QUERY_LENGTH ? 'search' : 'catalog';
  const sameSource = source.mode === mode && (mode === 'catalog' || source.query.toLowerCase() === query.toLowerCase());

  if (sameSource && !force) {
    render();
    return;
  }
  load(mode, mode === 'search' ? query : '');
}

// Eventos
const debouncedUpdate = debounce((value) => updateSource(value), DEBOUNCE_MS);

input.addEventListener('input', () => {
  if (normalizeQuery(input.value).length < MIN_QUERY_LENGTH) {
    debouncedUpdate.cancel();
    updateSource(input.value);
    return;
  }
  debouncedUpdate(input.value);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  debouncedUpdate.cancel();
  updateSource(input.value);
});

genreList.addEventListener('click', (event) => {
  if (event.target.closest('[data-more-genres]')) {
    moreGenresExpanded = !moreGenresExpanded;
    syncGenreButtons();
    return;
  }
  const button = event.target.closest('button[data-genre]');
  if (!button) return;
  const { genre } = button.dataset;
  if (!genre) filters.genres.clear();
  else if (filters.genres.has(genre)) filters.genres.delete(genre);
  else filters.genres.add(genre);
  render();
});

statusSelect.addEventListener('change', () => {
  filters.status = statusSelect.value;
  render();
});

sortSelect.addEventListener('change', () => {
  filters.sort = sortSelect.value;
  render();
});

clearButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filters.genres.clear();
    filters.status = '';
    render();
  });
});

errorMessage.querySelector('[data-retry]')?.addEventListener('click', () => {
  if (lastRequest) load(lastRequest.mode, lastRequest.query);
});

// Estado inicial desde la URL
const initial = readStateFromUrl();
input.value = initial.query;
filters.genres = initial.genres;
filters.status = initial.status;
filters.sort = initial.sort;
syncControls();

// Vista de favoritos
const FAVORITES_HASH = '#favoritos';
const FAVORITES_CONCURRENCY = 4; // límite de TVmaze: ~20 solicitudes / 10 s

const pageEyebrow = document.querySelector('[data-page-eyebrow]');
const pageTitle = document.querySelector('[data-page-title]');
const pageDescription = document.querySelector('[data-page-description]');
const exploreSections = [...document.querySelectorAll('[data-explore-view]')];
const favoritesView = document.querySelector('[data-favorites-view]');
const favoritesStatus = favoritesView.querySelector('[data-favorites-status]');
const favoritesGrid = favoritesView.querySelector('[data-favorites-grid]');
const favoritesSummary = favoritesView.querySelector('[data-favorites-summary]');
const favoritesNotice = favoritesView.querySelector('[data-favorites-notice]');
const favoritesNoticeText = favoritesView.querySelector('[data-favorites-notice-text]');
const favoritesNoticeAction = favoritesView.querySelector('[data-favorites-notice-action]');
const navExplore = document.querySelector('.site-nav__link[href="explorar.html"]');
const navFavorites = document.querySelector('[data-nav-favorites]');

const PAGE_TEXTS = {
  explore: ['Catálogo', 'Explorar series', pageDescription.textContent],
  favorites: ['Tu colección', 'Favoritos', 'Las series que has guardado. Se conservan en este navegador.'],
};

const favoriteShows = new Map();
let favoritesRequestId = 0;
let currentView = null;

const isFavoritesView = () => window.location.hash === FAVORITES_HASH;

function setView(view) {
  if (view === currentView) return;
  currentView = view;
  const favorites = view === 'favorites';

  exploreSections.forEach((section) => { section.hidden = favorites; });
  favoritesView.hidden = !favorites;

  const [eyebrow, heading, description] = PAGE_TEXTS[view];
  pageEyebrow.textContent = eyebrow;
  pageTitle.textContent = heading;
  pageDescription.textContent = description;
  document.title = favorites ? 'Favoritos — Series Atlas' : 'Explorar series — Series Atlas';

  if (favorites) {
    navExplore?.removeAttribute('aria-current');
    navFavorites?.setAttribute('aria-current', 'page');
    loadFavorites();
  } else {
    navFavorites?.removeAttribute('aria-current');
    navExplore?.setAttribute('aria-current', 'page');
    if (!source.mode) updateSource(input.value);
  }
}

function findShowInMemory(id) {
  return favoriteShows.get(id) ?? source.shows.find((show) => show.id === id) ?? null;
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function updateFavoritesSummary(count) {
  favoritesSummary.textContent = count === 0
    ? 'Se conservan en este navegador.'
    : `${count} ${count === 1 ? 'serie guardada' : 'series guardadas'} en este navegador.`;
}

function hideFavoritesNotice() {
  favoritesNotice.hidden = true;
  favoritesNoticeAction.onclick = null;
}

function showFavoritesNotice(text, actionLabel, action) {
  favoritesNoticeText.textContent = text;
  favoritesNoticeAction.textContent = actionLabel;
  favoritesNoticeAction.onclick = action;
  favoritesNotice.hidden = false;
}

// TVmaze no permite pedir varios IDs a la vez
async function loadFavorites() {
  const requestId = ++favoritesRequestId;
  const ids = getFavoriteIds();
  hideFavoritesNotice();
  updateFavoritesSummary(ids.length);

  if (ids.length === 0) {
    favoritesGrid.hidden = true;
    favoritesGrid.replaceChildren();
    showStatus(favoritesStatus, 'empty');
    return;
  }

  showStatus(favoritesStatus, null);
  const missing = ids.filter((id) => !findShowInMemory(id));
  if (missing.length > 0) {
    favoritesGrid.replaceChildren(...ids.map((id) => {
      const show = findShowInMemory(id);
      return show ? createSeriesCard(show) : createSkeletonCard();
    }));
    favoritesGrid.setAttribute('aria-busy', 'true');
    favoritesGrid.hidden = false;
  }

  const results = await mapWithConcurrency(missing, FAVORITES_CONCURRENCY, (id) => getShowDetails(id));
  if (requestId !== favoritesRequestId) return;

  const unavailable = [];
  const failed = [];
  results.forEach((result, index) => {
    const id = missing[index];
    if (result.value) {
      favoriteShows.set(id, result.value);
    } else if (result.error?.type === 'not-found') {
      unavailable.push(id);
    } else {
      failed.push({ id, error: result.error });
      console.error(`[Favoritos] No se pudo cargar la serie ${id}:`, result.error);
    }
  });

  renderFavorites();

  const shown = favoritesGrid.childElementCount;
  if (shown === 0 && failed.length > 0 && unavailable.length === 0) {
    favoritesGrid.hidden = true;
    fillErrorMessage(favoritesStatus.querySelector('[data-status="error"]'), failed[0].error);
    showStatus(favoritesStatus, 'error');
    return;
  }
  if (unavailable.length > 0) {
    const word = unavailable.length === 1 ? 'serie guardada ya no está disponible' : 'series guardadas ya no están disponibles';
    showFavoritesNotice(`${unavailable.length} ${word} en TVmaze.`, 'Quitar de favoritos', () => {
      unavailable.forEach((id) => removeFavorite(id));
    });
  } else if (failed.length > 0) {
    const text = failed.length === 1 ? 'No se pudo cargar 1 serie.' : `No se pudieron cargar ${failed.length} series.`;
    showFavoritesNotice(text, 'Reintentar', loadFavorites);
  }
}

function renderFavorites() {
  const ids = getFavoriteIds();
  const shows = ids.map(findShowInMemory).filter(Boolean);
  favoritesGrid.removeAttribute('aria-busy');
  updateFavoritesSummary(ids.length);

  if (ids.length === 0) {
    hideFavoritesNotice();
    favoritesGrid.hidden = true;
    favoritesGrid.replaceChildren();
    showStatus(favoritesStatus, 'empty');
    return;
  }
  favoritesGrid.replaceChildren(...shows.map(createSeriesCard));
  favoritesGrid.hidden = shows.length === 0;
}

favoritesStatus.querySelector('[data-retry]')?.addEventListener('click', loadFavorites);

onFavoritesChange((change) => {
  if (currentView !== 'favorites') return;
  if (!change.external && change.isFavorite === false) {
    renderFavorites();
    if (getFavoriteIds().every((id) => findShowInMemory(id))) hideFavoritesNotice();
    return;
  }
  loadFavorites();
});

window.addEventListener('hashchange', () => setView(isFavoritesView() ? 'favorites' : 'explore'));

setView(isFavoritesView() ? 'favorites' : 'explore');
