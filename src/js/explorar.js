import { searchShows, getShowIndex, getShowDetails } from './api.js';
import {
  initPage, createSeriesCard, createSkeletonCard, showStatus, fillErrorMessage,
  debounce, translateStatus, translateGenre, KNOWN_GENRES,
} from './ui.js';
import { getFavoriteIds, removeFavorite, onFavoritesChange } from './favorites.js';
import { pageTitle as brandTitle } from './brand.js';

const MIN_QUERY_LENGTH = 2;
const PAGE_DEBOUNCE_MS = 300;
const SKELETON_COUNT = 12;
const MAX_PAGE_PARAM = 100000;

// Catálogo con filtros: páginas de tamaño fijo, reunidas recorriendo el índice de TVmaze en orden
const FILTERED_TARGET = 48; // series por página, ajustadas a filas completas del grid
const SCAN_BUDGET = 25; // páginas del índice que se piden como máximo en cada carga
const SCAN_DELAY_MS = 500; // pausa entre peticiones: ~18 cada 10 s, por debajo del límite de TVmaze
const DEFAULT_SORT = 'relevancia';

const KNOWN_STATUSES = ['Running', 'Ended', 'To Be Determined', 'In Development'];

initPage();

// Elementos
const pageEyebrow = document.querySelector('[data-page-eyebrow]');
const pageTitle = document.querySelector('[data-page-title]');
const genreSelect = document.getElementById('genero');
const statusSelect = document.getElementById('estado');
const sortSelect = document.getElementById('orden');
const clearButtons = [...document.querySelectorAll('[data-clear-filters]')];
const statusContainer = document.querySelector('[data-results-status]');
const grid = document.querySelector('[data-results-grid]');
const count = document.querySelector('[data-results-count]');
const emptyTitle = statusContainer.querySelector('[data-empty-title]');
const emptyText = statusContainer.querySelector('[data-empty-text]');
const errorMessage = statusContainer.querySelector('[data-status="error"]');
const relevanceOption = sortSelect.querySelector('option[value="relevancia"]');
const resultsSection = grid.closest('.results');
const paginations = [...document.querySelectorAll('[data-pagination]')];
const statusScope = document.querySelector('[data-status-scope]');
const notice = document.querySelector('[data-results-notice]');
const noticeText = document.querySelector('[data-results-notice-text]');
const noticeAction = document.querySelector('[data-results-notice-action]');

// Título de la página según el género (los que en español son adjetivos llevan su forma)
const GENRE_TITLES = {
  Adult: 'Series para adultos', Children: 'Series infantiles', Family: 'Series familiares',
  Legal: 'Series legales', Medical: 'Series médicas', Supernatural: 'Series sobrenaturales',
  War: 'Series bélicas', Western: 'Series del oeste',
};
const DEFAULT_TITLE = 'Todas las series';
const SORT_VALUES = [...sortSelect.options].map((option) => option.value);

// Estado
const filters = {
  genre: '',
  status: '',
  sort: DEFAULT_SORT,
};

// La búsqueda llega por la URL (?q=) desde el buscador del header
let searchQuery = '';

let source = { mode: null, query: '', page: null, shows: [] };

// Catálogo: página pedida, última página cargada y primera página que no existe
const catalog = { page: 0, loadedPage: null, endPage: null };

// Series que cumplen los filtros actuales, en el orden del índice, y hasta dónde se ha recorrido
const stream = { key: null, matches: [], nextIndex: 0, done: false };

let pendingNotice = null;

let activeController = null;
let latestRequestId = 0;
let lastRequest = null;

const hasActiveFilters = () => filters.genre !== '' || filters.status !== '';
const filtersKey = () => `${filters.genre}|${filters.status}`;

function normalizeQuery(value) {
  return value.trim().replace(/\s+/g, ' ');
}

const currentMode = () => (searchQuery.length >= MIN_QUERY_LENGTH ? 'search' : 'catalog');
const isFilteredCatalog = () => currentMode() === 'catalog' && hasActiveFilters();

function matchAllowed(value, allowed) {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  return allowed.find((item) => item.toLowerCase() === lower) ?? null;
}

// URL
function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  // Un solo género; si la URL trae varios (enlaces antiguos), vale el primero reconocido
  const genre = params.getAll('genre')
    .map((value) => matchAllowed(value, KNOWN_GENRES))
    .find(Boolean) ?? '';
  return {
    query: normalizeQuery(params.get('q') ?? ''),
    genre,
    status: matchAllowed(params.get('status'), KNOWN_STATUSES) ?? '',
    sort: matchAllowed(params.get('sort'), SORT_VALUES) ?? DEFAULT_SORT,
    page: parsePageParam(params.get('page')),
  };
}

function parsePageParam(value) {
  if (!value || !/^\d{1,6}$/.test(value)) return 0;
  const page = Number(value);
  return page >= 1 && page <= MAX_PAGE_PARAM ? page - 1 : 0;
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  if (searchQuery.length >= MIN_QUERY_LENGTH) params.set('q', searchQuery);
  else if (catalog.page > 0) params.set('page', String(catalog.page + 1));
  if (filters.genre) params.set('genre', filters.genre);
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

function applyFilters(shows, { genre, status, sort }) {
  const filtered = shows.filter((show) => {
    if (genre && !show.genres.includes(genre)) return false;
    if (status && show.status !== status) return false;
    return true;
  });
  const sorter = SORTERS[sort];
  return sorter ? [...filtered].sort(sorter) : filtered;
}

// Controles
// Opciones de género: en el catálogo, todos los géneros conocidos (el filtro recorre todo el índice);
// en una búsqueda, los presentes en los resultados con su recuento según el estado
function syncGenreOptions() {
  const search = source.mode === 'search';
  const genres = new Set(search ? source.shows.flatMap((show) => show.genres) : KNOWN_GENRES);
  if (filters.genre) genres.add(filters.genre);
  const byStatus = search ? applyFilters(source.shows, { genre: '', status: filters.status, sort: DEFAULT_SORT }) : [];

  const ordered = [...genres].sort((a, b) => nameCollator.compare(translateGenre(a), translateGenre(b)));
  const options = [new Option(search ? `Todos (${byStatus.length})` : 'Todos', '')];
  ordered.forEach((genre) => {
    const label = translateGenre(genre);
    const total = search ? byStatus.filter((show) => show.genres.includes(genre)).length : null;
    options.push(new Option(total === null ? label : `${label} (${total})`, genre));
  });
  genreSelect.replaceChildren(...options);
  genreSelect.value = filters.genre;
}

// Título: búsqueda > género > "Todas las series" (en Favoritos lo pone setView)
function exploreHeading() {
  if (currentMode() === 'search') return `Resultados para "${searchQuery}"`;
  if (!filters.genre) return DEFAULT_TITLE;
  return GENRE_TITLES[filters.genre] ?? `Series de ${translateGenre(filters.genre).toLowerCase()}`;
}

function syncHeading() {
  if (document.documentElement.classList.contains('view-favorites')) return;
  const heading = exploreHeading();
  pageTitle.textContent = heading;
  document.title = brandTitle(heading);
}

// Igual que los géneros: todos los estados en el catálogo, recuentos solo en una búsqueda
function syncStatusOptions() {
  const search = source.mode === 'search';
  // En una búsqueda, los recuentos ignoran el filtro de estado
  const byGenre = search ? applyFilters(source.shows, { genre: filters.genre, status: '', sort: DEFAULT_SORT }) : [];
  const present = new Set(search ? source.shows.map((show) => show.status).filter(Boolean) : KNOWN_STATUSES);
  if (filters.status) present.add(filters.status);

  const ordered = [
    ...KNOWN_STATUSES.filter((status) => present.has(status)),
    ...[...present].filter((status) => !KNOWN_STATUSES.includes(status)).sort(),
  ];

  const options = [new Option(search ? `Todos (${byGenre.length})` : 'Todos', '')];
  ordered.forEach((status) => {
    const label = translateStatus(status);
    const total = search ? byGenre.filter((show) => show.status === status).length : null;
    options.push(new Option(total === null ? label : `${label} (${total})`, status));
  });
  statusSelect.replaceChildren(...options);
  statusSelect.value = filters.status;
  statusScope.textContent = search ? '· recuentos de estos resultados' : '';
}

function syncSortSelect() {
  relevanceOption.textContent = source.mode === 'search' ? 'Relevancia' : 'Orden de TVmaze';
  sortSelect.value = filters.sort;
}

function syncPagination({ loading = false, progress = null } = {}) {
  const canGoBack = catalog.page > 0;
  const canGoForward = isFilteredCatalog()
    ? Boolean(source.filtered && source.page === catalog.page && source.hasNext)
    : catalog.endPage === null || catalog.page + 1 < catalog.endPage;
  let label = `Página ${catalog.page + 1}`;
  if (loading) {
    label = progress === null
      ? `Cargando página ${catalog.page + 1}…`
      : `Buscando series… (página ${progress} del índice)`;
  }
  paginations.forEach((nav) => {
    nav.hidden = currentMode() !== 'catalog';
    nav.setAttribute('aria-busy', String(loading));
    nav.querySelector('[data-page-prev]').disabled = !canGoBack;
    nav.querySelector('[data-page-next]').disabled = !canGoForward;
    nav.querySelector('[data-page-label]').textContent = label;
  });
}

function syncControls() {
  syncHeading();
  syncGenreOptions();
  syncStatusOptions();
  syncSortSelect();
  syncPagination();
  clearButtons.forEach((button) => { button.hidden = !hasActiveFilters(); });
}

function describeSource() {
  return source.mode === 'search'
    ? `resultados para "${source.query}"`
    : `series de la página ${source.page + 1} del índice de TVmaze`;
}

function hideResults() {
  grid.hidden = true;
  grid.removeAttribute('aria-busy');
  grid.replaceChildren();
  count.textContent = '';
}

function showSkeletons() {
  grid.replaceChildren(...Array.from({ length: SKELETON_COUNT }, createSkeletonCard));
  grid.setAttribute('aria-busy', 'true');
  grid.hidden = false;
  count.textContent = '';
  showStatus(statusContainer, null);
}

function showNotice(text, { action = false } = {}) {
  noticeText.textContent = text;
  noticeAction.hidden = !action;
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
  noticeAction.hidden = true;
}

function render() {
  syncControls();
  writeStateToUrl();
  if (!source.mode) return;

  const total = source.shows.length;

  if (pendingNotice) {
    showNotice(pendingNotice);
    pendingNotice = null;
  }

  if (source.filtered) {
    renderFilteredPage();
    return;
  }

  if (total === 0) {
    hideResults();
    emptyTitle.textContent = 'Sin resultados';
    emptyText.textContent = source.mode === 'search'
      ? `No encontramos series para "${source.query}". Prueba con otro título.`
      : `TVmaze no devolvió series en la página ${source.page + 1}.`;
    showStatus(statusContainer, 'empty');
    return;
  }

  const visible = applyFilters(source.shows, filters);

  if (visible.length === 0) {
    hideResults();
    emptyTitle.textContent = 'Ninguna serie coincide';
    emptyText.textContent = source.mode === 'search'
      ? `Ninguno de los ${total} ${describeSource()} cumple los filtros seleccionados.`
      : `Ninguna de las ${total} ${describeSource()} cumple los filtros. Prueba en otra página o cambia los filtros.`;
    showStatus(statusContainer, 'empty');
    return;
  }

  grid.replaceChildren(...visible.map(createSeriesCard));
  grid.removeAttribute('aria-busy');
  grid.hidden = false;
  count.textContent = hasActiveFilters()
    ? `Mostrando ${visible.length} de ${total} ${describeSource()}`
    : `${total} ${describeSource()}`;
  showStatus(statusContainer, null);
}

function renderFilteredPage() {
  const items = applyFilters(source.items, { genre: '', status: '', sort: filters.sort });

  // Combinación muy poco frecuente: se revisó el máximo de páginas sin llenar esta
  if (source.partial) {
    showNotice(items.length === 0
      ? `Aún no hay series con estos filtros en las primeras ${source.scanned} páginas del índice de TVmaze.`
      : `Hay pocas series con estos filtros: se revisaron ${source.scanned} páginas del índice de TVmaze.`, { action: true });
  }

  if (items.length === 0) {
    hideResults();
    if (source.partial) {
      showStatus(statusContainer, null);
      return;
    }
    emptyTitle.textContent = 'Ninguna serie coincide';
    emptyText.textContent = 'No hay series con estos filtros en el índice de TVmaze. Prueba con otros filtros.';
    showStatus(statusContainer, 'empty');
    return;
  }

  grid.replaceChildren(...items.map(createSeriesCard));
  grid.removeAttribute('aria-busy');
  grid.hidden = false;
  count.textContent = `Página ${source.page + 1}: ${items.length} series que cumplen los filtros`;
  showStatus(statusContainer, null);
}

// Carga de datos
function cancelActiveRequest() {
  debouncedPageLoad.cancel();
  activeController?.abort();
  activeController = null;
  latestRequestId += 1;
}

async function load(mode, query = '') {
  cancelActiveRequest();
  const controller = new AbortController();
  activeController = controller;
  const requestId = latestRequestId;
  const page = catalog.page;
  lastRequest = { mode, query };

  hideNotice();
  showSkeletons();
  syncPagination({ loading: mode === 'catalog' });

  try {
    if (mode === 'catalog' && hasActiveFilters()) {
      await loadFilteredPage(page, controller.signal, requestId);
      return;
    }
    const shows = mode === 'search'
      ? await searchShows(query, { signal: controller.signal })
      : await getShowIndex(page, { signal: controller.signal });
    if (requestId !== latestRequestId) return; // respuesta de una solicitud anterior

    if (mode === 'catalog' && shows.length === 0) {
      handleUnavailablePage(page);
      return;
    }
    if (mode === 'catalog') catalog.loadedPage = page;
    source = { mode, query, page: mode === 'catalog' ? page : null, shows };
    render();
  } catch (error) {
    if (error.type === 'aborted' || requestId !== latestRequestId) return;
    if (mode === 'catalog' && error.type === 'not-found') {
      handleUnavailablePage(page);
      return;
    }
    const target = mode === 'search' ? `la búsqueda "${query}"` : `la página ${page + 1} del catálogo`;
    console.error(`[Explorar] Error al cargar ${target}:`, error);
    source = { mode: null, query: '', page: null, shows: [] };
    hideResults();
    syncControls();
    fillErrorMessage(errorMessage, error);
    showStatus(statusContainer, 'error');
  } finally {
    if (activeController === controller) activeController = null;
  }
}

const debouncedPageLoad = debounce(() => load('catalog'), PAGE_DEBOUNCE_MS);

// Catálogo filtrado
const pause = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('Solicitud cancelada'), { type: 'aborted' }));
  }, { once: true });
});

// Tamaño de página: unas 48 series ajustadas a filas completas según las columnas del grid
function filteredPageSize() {
  const tracks = getComputedStyle(grid).gridTemplateColumns;
  const repeat = tracks.match(/repeat\((\d+)/);
  const columns = Math.max(1, repeat ? Number(repeat[1]) : tracks.split(' ').filter(Boolean).length);
  return columns * Math.ceil(FILTERED_TARGET / columns);
}

// Recorre el índice desde donde se quedó hasta reunir `needed` coincidencias (o agotar el presupuesto)
async function fillStream(needed, signal) {
  if (stream.key !== filtersKey()) {
    Object.assign(stream, { key: filtersKey(), matches: [], nextIndex: 0, done: false });
  }
  let fetched = 0;
  while (stream.matches.length < needed && !stream.done) {
    if (catalog.endPage !== null && stream.nextIndex >= catalog.endPage) {
      stream.done = true;
      break;
    }
    if (fetched >= SCAN_BUDGET) break;
    if (fetched > 0) await pause(SCAN_DELAY_MS, signal);
    syncPagination({ loading: true, progress: stream.nextIndex + 1 });

    let shows;
    try {
      shows = await getShowIndex(stream.nextIndex, { signal });
    } catch (error) {
      if (error.type !== 'not-found') throw error;
      shows = [];
    }
    fetched += 1;

    if (shows.length === 0) {
      catalog.endPage = Math.min(catalog.endPage ?? Infinity, stream.nextIndex);
      stream.done = true;
      break;
    }
    stream.matches.push(...applyFilters(shows, { genre: filters.genre, status: filters.status, sort: DEFAULT_SORT }));
    stream.nextIndex += 1;
  }
}

async function loadFilteredPage(page, signal, requestId) {
  const size = filteredPageSize();
  const start = page * size;
  await fillStream(start + size + 1, signal); // una de más para saber si hay página siguiente
  if (requestId !== latestRequestId) return;

  const total = stream.matches.length;
  // Página posterior al final (enlace antiguo o recarga): se muestra la última que existe
  if (page > 0 && stream.done && total <= start) {
    const last = Math.max(0, Math.ceil(total / size) - 1);
    pendingNotice = `La página ${page + 1} no existe con estos filtros. Se muestra la página ${last + 1}.`;
    catalog.page = last;
    await loadFilteredPage(last, signal, requestId);
    return;
  }

  const items = stream.matches.slice(start, start + size);
  const partial = !stream.done && items.length < size;
  source = {
    mode: 'catalog',
    query: '',
    page,
    filtered: true,
    key: stream.key,
    shows: items,
    items,
    partial,
    scanned: stream.nextIndex,
    hasNext: !partial && (total > start + size || (!stream.done && items.length === size)),
  };
  render();
}

// TVmaze responde 404 (o una lista vacía) después de la última página
function handleUnavailablePage(page) {
  catalog.endPage = Math.min(catalog.endPage ?? Infinity, page);
  const fallback = catalog.loadedPage !== null && catalog.loadedPage < page ? catalog.loadedPage : 0;

  if (page === 0) {
    source = { mode: null, query: '', page: null, shows: [] };
    hideResults();
    syncControls();
    fillErrorMessage(errorMessage, { type: 'not-found' });
    showStatus(statusContainer, 'error');
    return;
  }
  pendingNotice = `La página ${page + 1} no está disponible en el índice de TVmaze. Se muestra la página ${fallback + 1}.`;
  catalog.page = fallback;
  load('catalog');
}

function goToPage(page) {
  if (page < 0) return;
  if (isFilteredCatalog()) {
    if (page > catalog.page && !(source.filtered && source.hasNext)) return;
  } else if (catalog.endPage !== null && page >= catalog.endPage) {
    return;
  }
  catalog.page = page;
  cancelActiveRequest();
  hideNotice();
  showSkeletons();
  syncPagination({ loading: true });
  writeStateToUrl();

  if (resultsSection.getBoundingClientRect().top < 0) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultsSection.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  debouncedPageLoad();
}

function updateSource(rawValue, { force = false } = {}) {
  const query = normalizeQuery(rawValue);
  searchQuery = query;
  const mode = query.length >= MIN_QUERY_LENGTH ? 'search' : 'catalog';
  const sameSource = source.mode === mode && (mode === 'catalog'
    ? source.page === catalog.page && Boolean(source.filtered) === hasActiveFilters()
      && (!source.filtered || source.key === filtersKey())
    : source.query.toLowerCase() === query.toLowerCase());

  if (sameSource && !force) {
    render();
    return;
  }
  load(mode, mode === 'search' ? query : '');
}

// Eventos
// En una búsqueda los filtros se aplican en memoria; en el catálogo se vuelve a la página 1
function onFiltersChange() {
  if (currentMode() === 'search') {
    render();
    return;
  }
  catalog.page = 0;
  syncControls();
  writeStateToUrl();
  load('catalog');
}

genreSelect.addEventListener('change', () => {
  filters.genre = genreSelect.value;
  onFiltersChange();
});

statusSelect.addEventListener('change', () => {
  filters.status = statusSelect.value;
  onFiltersChange();
});

noticeAction.addEventListener('click', () => load('catalog'));

sortSelect.addEventListener('change', () => {
  filters.sort = sortSelect.value;
  render();
});

clearButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filters.genre = '';
    filters.status = '';
    onFiltersChange();
  });
});

errorMessage.querySelector('[data-retry]')?.addEventListener('click', () => {
  if (lastRequest) load(lastRequest.mode, lastRequest.query);
});

paginations.forEach((nav) => {
  nav.querySelector('[data-page-prev]').addEventListener('click', () => goToPage(catalog.page - 1));
  nav.querySelector('[data-page-next]').addEventListener('click', () => goToPage(catalog.page + 1));
});

// Estado inicial desde la URL
const initial = readStateFromUrl();
searchQuery = initial.query;
filters.genre = initial.genre;
filters.status = initial.status;
filters.sort = initial.sort;
catalog.page = initial.page;
syncControls();

// Vista de favoritos
const FAVORITES_HASH = '#favoritos';
const FAVORITES_CONCURRENCY = 4; // límite de TVmaze: ~20 solicitudes / 10 s

const exploreSections = [...document.querySelectorAll('[data-explore-view]')];
const favoritesView = document.querySelector('[data-favorites-view]');
const favoritesStatus = favoritesView.querySelector('[data-favorites-status]');
const favoritesGrid = favoritesView.querySelector('[data-favorites-grid]');
const favoritesSummary = document.querySelector('[data-favorites-summary]');
const favoritesNotice = favoritesView.querySelector('[data-favorites-notice]');
const favoritesNoticeText = favoritesView.querySelector('[data-favorites-notice-text]');
const favoritesNoticeAction = favoritesView.querySelector('[data-favorites-notice-action]');
const navExplore = document.querySelector('.site-nav__link[href="explorar.html"]');
const navFavorites = document.querySelector('[data-nav-favorites]');

// La descripción de Favoritos está en el HTML y solo se muestra en esa vista (.view-favorites)
const PAGE_EYEBROWS = { explore: 'Catálogo', favorites: 'Tu colección' };

const favoriteShows = new Map();
let favoritesRequestId = 0;
let currentView = null;

const isFavoritesView = () => window.location.hash === FAVORITES_HASH;

function setView(view) {
  if (view === currentView) return;
  // Al cambiar de vista dentro de la página (Explorar ↔ Favoritos) se vuelve arriba, al título
  if (currentView !== null) window.scrollTo({ top: 0, behavior: 'instant' });
  currentView = view;
  const favorites = view === 'favorites';

  document.documentElement.classList.toggle('view-favorites', favorites);
  exploreSections.forEach((section) => { section.hidden = favorites; });
  favoritesView.hidden = !favorites;

  pageEyebrow.textContent = PAGE_EYEBROWS[view];
  if (favorites) {
    pageTitle.textContent = 'Favoritos';
    document.title = brandTitle('Favoritos');
  } else {
    syncHeading();
  }

  if (favorites) {
    navExplore?.removeAttribute('aria-current');
    navFavorites?.setAttribute('aria-current', 'page');
    loadFavorites();
  } else {
    navFavorites?.removeAttribute('aria-current');
    navExplore?.setAttribute('aria-current', 'page');
    if (!source.mode) updateSource(searchQuery);
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

// Descripción de la cabecera en Favoritos: cuántas series hay guardadas
function updateFavoritesSummary(count) {
  favoritesSummary.textContent = count === 0
    ? 'Las series que guardes se conservan en este navegador.'
    : `${count} ${count === 1 ? 'serie guardada' : 'series guardadas'}. Se conservan en este navegador.`;
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
