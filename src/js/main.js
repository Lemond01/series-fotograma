import { getShowDetails, getShowIndex, getWebSchedule } from './api.js';
import {
  initPage, createElement, createIcon, createSeriesCard, detailUrl, setImage, bindFavoriteButton,
  htmlToText, truncate, translateGenre, formatRating, formatLocalTime,
  getErrorMessage, showStatus, fillErrorMessage,
} from './ui.js';
import { createHeroCarousel, initHeroScroll } from './hero.js';

// Selección editorial (IDs de TVmaze): el carrusel usa series con fondo panorámico real
const HERO_SHOW_IDS = [82, 2993, 335, 5];
const EDITORIAL_SHOW_IDS = [169, 179, 1825, 32, 1371];
const DISCOVER_MIN_RATING = 8;
const DISCOVER_LIMIT = 14;
const SCHEDULE_LIMIT = 8;
const FEATURE_SUMMARY_LENGTH = 260;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

initPage();

// Hero
async function loadHero() {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;

  const results = await Promise.allSettled(HERO_SHOW_IDS.map((id) => getShowDetails(id, { withImages: true })));
  const shows = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  results
    .filter((r) => r.status === 'rejected')
    .forEach((r) => console.error('[Inicio] Error al cargar una serie destacada:', r.reason));

  if (shows.length === 0) {
    const placeholder = hero.querySelector('[data-hero-placeholder]');
    const skeleton = placeholder.querySelector('[data-hero-skeleton]');
    const { title, text } = getErrorMessage(results[0]?.reason);
    skeleton.replaceWith(createElement('h2', 'hero__title', 'Descubre series de televisión'));
    placeholder.querySelector('[data-hero-message]').textContent = `${title}. ${text}`;
    placeholder.removeAttribute('aria-hidden');
    return;
  }

  const carousel = createHeroCarousel(hero, shows);
  initHeroScroll(hero, {
    edge: document.querySelector('[data-hero-edge]'),
    onPastChange: (past) => carousel.setOffscreen(past),
  });
}

// Secciones con skeletons, reintento y protección contra respuestas antiguas
function createLoadableSection({ grid, status, load, render }) {
  const skeletons = [...grid.children].map((node) => node.cloneNode(true));
  let requestId = 0;

  async function run() {
    const current = ++requestId;
    grid.replaceChildren(...skeletons.map((node) => node.cloneNode(true)));
    grid.setAttribute('aria-busy', 'true');
    grid.hidden = false;
    showStatus(status, null);

    let result;
    try {
      result = await load();
    } catch (error) {
      result = { items: [], error };
    }
    if (current !== requestId) return;
    grid.removeAttribute('aria-busy');

    if (result.items.length === 0) {
      grid.hidden = true;
      grid.replaceChildren();
      fillErrorMessage(status.querySelector('[data-status="error"]'), result.error);
      showStatus(status, 'error');
      return;
    }
    grid.replaceChildren(...render(result.items));
  }

  status.querySelector('[data-retry]')?.addEventListener('click', run);
  return run;
}

// Selección editorial
function createFeature(show, position) {
  const item = createElement('li', 'editorial-grid__feature');
  const article = createElement('article', 'feature');
  article.dataset.showId = show.id;

  const media = createElement('a', 'feature__media media');
  media.href = detailUrl(show.id);
  media.tabIndex = -1;
  media.setAttribute('aria-hidden', 'true');
  if (show.image) {
    const img = createElement('img', 'media__img feature__img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 680;
    img.height = 1000;
    media.append(img);
    setImage(img, show.image.original, '');
  } else {
    media.classList.add('media--empty');
  }

  const body = createElement('div', 'feature__body');
  const title = createElement('h3', 'feature__title');
  const link = createElement('a', null, show.name);
  link.href = detailUrl(show.id);
  title.append(link);

  const meta = createElement('ul', 'meta-list');
  [show.year, show.genres.slice(0, 2).map(translateGenre).join(', ') || null]
    .filter(Boolean)
    .forEach((text) => meta.append(createElement('li', 'meta-list__item', text)));
  if (show.rating !== null) {
    const rating = createElement('li', 'meta-list__item meta-list__item--rating');
    rating.append(
      createIcon('star', 'icon icon--sm icon--filled'),
      createElement('span', 'u-visually-hidden', 'Puntuación: '),
      formatRating(show.rating),
    );
    meta.append(rating);
  }

  const summaryText = htmlToText(show.summary);
  const summary = createElement('p', 'feature__summary', summaryText ? truncate(summaryText, FEATURE_SUMMARY_LENGTH) : 'Sinopsis no disponible.');
  if (summaryText) summary.lang = 'en';

  const actions = createElement('div', 'feature__actions');
  const more = createElement('a', 'btn btn--primary', 'Ver ficha');
  more.href = detailUrl(show.id);
  const favorite = createElement('button', 'btn btn--secondary btn--favorite');
  favorite.type = 'button';
  favorite.dataset.favoriteToggle = '';
  const label = createElement('span', null, 'Agregar a favoritos');
  label.dataset.favoriteLabel = '';
  favorite.append(createIcon('heart'), label);
  bindFavoriteButton(favorite, show);
  actions.append(more, favorite);

  body.append(createElement('p', 'feature__eyebrow', `Elegida · ${String(position).padStart(2, '0')}`), title, meta, summary, actions);
  article.append(media, body);
  item.append(article);
  return item;
}

const editorialGrid = document.querySelector('[data-editorial-grid]');
const loadEditorial = editorialGrid && createLoadableSection({
  grid: editorialGrid,
  status: document.querySelector('[data-editorial-status]'),
  async load() {
    const results = await Promise.allSettled(EDITORIAL_SHOW_IDS.map((id) => getShowDetails(id)));
    const failures = results.filter((r) => r.status === 'rejected');
    failures.forEach((r) => console.error('[Inicio] Error al cargar una serie de la selección:', r.reason));
    return { items: results.filter((r) => r.status === 'fulfilled').map((r) => r.value), error: failures[0]?.reason };
  },
  render: ([first, ...rest]) => [createFeature(first, 1), ...rest.map(createSeriesCard)],
});

// Descubre más series: muestra del índice de TVmaze (no es un ranking)
const discoverGrid = document.querySelector('[data-discover-grid]');
const loadDiscover = discoverGrid && createLoadableSection({
  grid: discoverGrid,
  status: document.querySelector('[data-discover-status]'),
  async load() {
    const shown = new Set([...HERO_SHOW_IDS, ...EDITORIAL_SHOW_IDS]);
    const shows = (await getShowIndex(0))
      .filter((show) => show.image && show.rating !== null && show.rating >= DISCOVER_MIN_RATING && !shown.has(show.id))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, DISCOVER_LIMIT);
    return { items: shows };
  },
  render: (shows) => {
    queueMicrotask(updateRailButtons);
    return shows.map(createSeriesCard);
  },
});

// Galería horizontal
const rail = document.querySelector('[data-rail]');
const railPrev = document.querySelector('[data-rail-prev]');
const railNext = document.querySelector('[data-rail-next]');

function updateRailButtons() {
  if (!rail) return;
  const max = rail.scrollWidth - rail.clientWidth - 2;
  railPrev.disabled = rail.scrollLeft <= 2;
  railNext.disabled = rail.scrollLeft >= max;
}

if (rail) {
  const scrollRail = (direction) => rail.scrollBy({
    left: direction * rail.clientWidth * 0.8,
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
  });
  railPrev.addEventListener('click', () => scrollRail(-1));
  railNext.addEventListener('click', () => scrollRail(1));
  rail.addEventListener('scroll', updateRailButtons, { passive: true });
  window.addEventListener('resize', updateRailButtons);
  updateRailButtons();
  initRailWheel(rail);
}

// Rueda vertical sobre la galería: avanza o retrocede tarjeta a tarjeta.
// Cada gesto de rueda (eventos seguidos sin pausas largas) pertenece a la galería o a la página,
// nunca a las dos: así la página no se mueve mientras la galería se desplaza, ni al revés.
function initRailWheel(viewport) {
  const STEP_THRESHOLD = 50; // px acumulados para dar un paso (trackpad)
  const NOTCH = 100; // una muesca de rueda ≈ 100 px; si llegan agrupadas se avanzan varias tarjetas
  const GESTURE_GAP = 300; // ms sin eventos para dar un gesto por terminado
  let accumulated = 0;
  let target = null;
  let settleTimer = 0;
  const gesture = { owner: null, last: -Infinity };

  // Posiciones de alineación de cada tarjeta (las del final se juntan en el máximo)
  const snapPositions = () => {
    const max = viewport.scrollWidth - viewport.clientWidth;
    const origin = viewport.getBoundingClientRect().left - viewport.scrollLeft;
    const padding = parseFloat(getComputedStyle(viewport).scrollPaddingLeft) || 0;
    const positions = [...viewport.querySelectorAll('[data-discover-grid] > li')]
      .map((item) => Math.round(item.getBoundingClientRect().left - origin - padding))
      .map((left) => Math.min(Math.max(left, 0), max));
    return [...new Set(positions)].sort((a, b) => a - b);
  };

  const positionsAhead = (direction) => {
    const current = target ?? viewport.scrollLeft;
    return direction > 0
      ? snapPositions().filter((left) => left > current + 1)
      : snapPositions().filter((left) => left < current - 1).reverse();
  };

  const toPixels = (delta, mode) => {
    if (mode === 1) return delta * 16;
    if (mode === 2) return delta * viewport.clientHeight;
    return delta;
  };

  const isNewGesture = (event) => event.timeStamp - gesture.last >= GESTURE_GAP;

  // Rueda fuera de la galería: el gesto es de la página
  window.addEventListener('wheel', (event) => {
    if (viewport.contains(event.target)) return;
    if (isNewGesture(event)) gesture.owner = 'page';
    gesture.last = event.timeStamp;
  }, { passive: true });

  viewport.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { target = null; }, 200);
  }, { passive: true });

  viewport.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    const vertical = Math.abs(event.deltaY) > Math.abs(event.deltaX);

    // El primer evento decide a quién pertenece el gesto completo:
    // vertical con recorrido disponible → galería; vertical en un extremo → página;
    // horizontal (trackpad) → desplazamiento nativo de la galería
    if (isNewGesture(event)) {
      accumulated = 0;
      if (!vertical) gesture.owner = 'native';
      else gesture.owner = positionsAhead(Math.sign(event.deltaY)).length > 0 ? 'rail' : 'page';
    }
    gesture.last = event.timeStamp;
    if (gesture.owner !== 'rail') return;

    // Gesto de la galería: la página nunca se mueve, aunque se llegue al extremo a mitad de gesto
    event.preventDefault();
    const delta = vertical ? event.deltaY : event.deltaX;
    const direction = Math.sign(delta);
    if (!direction) return;
    if (Math.sign(accumulated) !== direction) accumulated = 0;
    accumulated += toPixels(delta, event.deltaMode);
    if (Math.abs(accumulated) < STEP_THRESHOLD) return;

    const steps = Math.max(1, Math.round(Math.abs(accumulated) / NOTCH));
    accumulated = 0;
    const ahead = positionsAhead(direction);
    if (ahead.length === 0) return;
    target = ahead[Math.min(steps, ahead.length) - 1];
    viewport.scrollTo({ left: target, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }, { passive: false });
}

// Programación web
async function loadSchedule() {
  const board = document.querySelector('[data-schedule]');
  if (!board) return;

  const noticeText = board.querySelector('[data-schedule-notice-text]');
  const list = board.querySelector('[data-schedule-list]');

  try {
    const episodes = await getWebSchedule();
    const groups = groupByShow(episodes).slice(0, SCHEDULE_LIMIT);

    if (groups.length === 0) {
      noticeText.textContent = 'TVmaze no tiene estrenos web registrados para hoy.';
      list.hidden = true;
      return;
    }

    noticeText.textContent = `${groups.length} de ${countShows(episodes)} series con estrenos hoy, ordenadas por hora de emisión.`;
    list.replaceChildren(...groups.map(createScheduleItem));
  } catch (error) {
    console.error('[Inicio] Error al cargar la programación web:', error);
    const { title, text } = getErrorMessage(error);
    noticeText.textContent = `${title}. ${text}`;
    list.hidden = true;
  } finally {
    board.removeAttribute('aria-busy');
  }
}

const countShows = (episodes) => new Set(episodes.map((episode) => episode.show.id)).size;

function groupByShow(episodes) {
  const groups = new Map();
  episodes.forEach((episode) => {
    const group = groups.get(episode.show.id);
    if (group) {
      group.episodes.push(episode);
    } else {
      groups.set(episode.show.id, { show: episode.show, episodes: [episode] });
    }
  });

  const firstAirtime = (group) => Math.min(...group.episodes.map((e) => Date.parse(e.airstamp) || Infinity));
  return [...groups.values()].sort((a, b) => firstAirtime(a) - firstAirtime(b));
}

function createScheduleItem({ show, episodes }) {
  const [first] = episodes;
  const item = createElement('li', 'schedule__item');

  const time = createElement('time', 'schedule__time', formatLocalTime(first.airstamp) ?? '—');
  if (first.airstamp) time.dateTime = first.airstamp;

  const thumb = createElement('div', 'schedule__thumb media');
  const imageUrl = first.image?.medium ?? show.image?.medium;
  if (imageUrl) {
    const img = createElement('img', 'media__img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    thumb.append(img);
    setImage(img, imageUrl, '');
  } else {
    thumb.classList.add('media--empty', 'media--compact');
  }

  const text = createElement('div', 'schedule__text');
  const link = createElement('a', 'schedule__show', show.name);
  link.href = detailUrl(show.id);

  const details = [
    episodes.length > 1
      ? `${episodes.length} episodios`
      : formatEpisodeCode(first),
    first.name !== 'Sin título' && episodes.length === 1 ? first.name : null,
    show.network,
  ].filter(Boolean).join(' · ');

  text.append(link, createElement('p', 'schedule__episode', details));
  item.append(time, thumb, text);
  return item;
}

function formatEpisodeCode({ season, number }) {
  if (season === null || number === null) return 'Episodio especial';
  return `T${season} · E${number}`;
}

// Arranque
loadHero();
loadEditorial?.();
loadDiscover?.();
loadSchedule();
