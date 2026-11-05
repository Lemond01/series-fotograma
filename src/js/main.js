import { getShowDetails, getShowIndex, getWebSchedule } from './api.js';
import {
  initPage, createElement, createIcon, createSeriesCard, detailUrl, setImage, bindFavoriteButton,
  htmlToText, truncate, translateGenre, formatRating, formatLocalTime,
  getErrorMessage, showStatus, fillErrorMessage,
} from './ui.js';
import { createHeroCarousel, initHeroScroll } from './hero.js';

// Selección editorial (IDs de TVmaze): el carrusel usa series con fondo panorámico real
const HERO_SHOW_IDS = [82, 2993, 335, 5];
const EDITORIAL_SHOW_IDS = [169, 179, 1825, 32, 1371, 919]; // 919: Attack on Titan (anime)
const DISCOVER_MIN_RATING = 8;
const DISCOVER_LIMIT = 14;
const GENRE_HOVER_DELAY_MS = 120; // evita cambios al cruzar la lista con el ratón
const SCHEDULE_LIMIT = 8;
const PREVIEW_SUMMARY_LENGTH = 260;
const PREVIEW_DELAY_MS = 1000; // tiempo con el ratón sobre un póster antes de mostrar su vista previa

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
// Vista previa dentro del póster: lo que antes era la tarjeta destacada, ahora en cada serie.
// Es un atajo para el ratón (aria-hidden, botones fuera del orden de tabulación): con teclado y
// lector de pantalla se usan el enlace y el corazón de la propia tarjeta.
function createPreview(show, position) {
  const preview = createElement('div', 'card-preview');
  preview.setAttribute('aria-hidden', 'true');

  const meta = createElement('ul', 'meta-list card-preview__meta');
  [show.year, show.genres.slice(0, 2).map(translateGenre).join(', ') || null]
    .filter(Boolean)
    .forEach((text) => meta.append(createElement('li', 'meta-list__item', text)));
  if (show.rating !== null) {
    const rating = createElement('li', 'meta-list__item meta-list__item--rating');
    rating.append(createIcon('star', 'icon icon--sm icon--filled'), formatRating(show.rating));
    meta.append(rating);
  }

  const summaryText = htmlToText(show.summary);
  const summary = createElement('p', 'card-preview__summary', summaryText ? truncate(summaryText, PREVIEW_SUMMARY_LENGTH) : 'Sinopsis no disponible.');
  if (summaryText) summary.lang = 'en';

  const actions = createElement('div', 'card-preview__actions');
  const more = createElement('a', 'btn btn--primary', 'Ver ficha');
  more.href = detailUrl(show.id);
  more.tabIndex = -1;
  more.append(createIcon('arrow-right', 'icon icon--sm'));
  const favorite = createElement('button', 'btn btn--secondary btn--favorite');
  favorite.type = 'button';
  favorite.tabIndex = -1;
  favorite.dataset.favoriteToggle = '';
  const label = createElement('span', null, 'Agregar a favoritos');
  label.dataset.favoriteLabel = '';
  favorite.append(createIcon('heart'), label);
  bindFavoriteButton(favorite, show);
  actions.append(more, favorite);

  preview.append(
    createElement('p', 'card-preview__eyebrow', `Elegida · ${String(position).padStart(2, '0')}`),
    createElement('p', 'card-preview__title', show.name),
    meta,
    summary,
    actions,
  );
  return preview;
}

// La vista previa aparece tras PREVIEW_DELAY_MS con el ratón encima y se cierra al salir
function createEditorialCard(show, position) {
  const item = createSeriesCard(show);
  const card = item.querySelector('.series-card');
  card.classList.add('series-card--preview');
  card.append(createPreview(show, position));

  let timer = 0;
  card.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(() => card.classList.add('is-previewing'), PREVIEW_DELAY_MS);
  });
  card.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    card.classList.remove('is-previewing');
  });
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
  render: (shows) => shows.map((show, index) => createEditorialCard(show, index + 1)),
});

// Populares: series con 8 o más de una muestra del índice de TVmaze (ordenadas por puntuación)
function pickDiscover(shows) {
  const shown = new Set([...HERO_SHOW_IDS, ...EDITORIAL_SHOW_IDS]);
  return shows
    .filter((show) => show.image && show.rating !== null && show.rating >= DISCOVER_MIN_RATING && !shown.has(show.id))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, DISCOVER_LIMIT);
}

const discoverGrid = document.querySelector('[data-discover-grid]');
const loadDiscover = discoverGrid && createLoadableSection({
  grid: discoverGrid,
  status: document.querySelector('[data-discover-status]'),
  async load() {
    return { items: pickDiscover(await getShowIndex(0)) };
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
// Solo se activa si el ratón lleva un rato sobre la galería sin que la página se haya movido:
// al bajar por la página, que la galería quede bajo el cursor no la «captura».
// Además, cada gesto de rueda pertenece entero a la galería o a la página, nunca a las dos.
function initRailWheel(viewport) {
  const STEP_THRESHOLD = 50; // px acumulados para dar un paso (trackpad)
  const NOTCH = 100; // una muesca de rueda ≈ 100 px; si llegan agrupadas se avanzan varias tarjetas
  const GESTURE_GAP = 300; // ms sin eventos para dar un gesto por terminado
  const DWELL_MS = 1000; // tiempo con el ratón sobre la galería, y la página quieta, antes de que la rueda la mueva
  let accumulated = 0;
  let hoverStart = null;
  let lastPageScroll = -Infinity;
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

  // Espera: cuenta desde que el ratón entró en la galería o desde el último desplazamiento de la página
  const isArmed = (now) => hoverStart !== null && now - Math.max(hoverStart, lastPageScroll) >= DWELL_MS;

  const startHover = (event) => {
    if (event.pointerType === 'mouse' && hoverStart === null) hoverStart = event.timeStamp;
  };
  viewport.addEventListener('pointerenter', startHover);
  viewport.addEventListener('pointermove', startHover, { passive: true });
  viewport.addEventListener('pointerleave', () => { hoverStart = null; });
  window.addEventListener('scroll', (event) => { lastPageScroll = event.timeStamp; }, { passive: true });

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
    // vertical, tras la espera y con recorrido disponible → galería; si no → página;
    // horizontal (trackpad) → desplazamiento nativo de la galería
    if (isNewGesture(event)) {
      accumulated = 0;
      if (!vertical) gesture.owner = 'native';
      else if (!isArmed(event.timeStamp)) gesture.owner = 'page';
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

// Géneros: pestañas (pasar el ratón, tocar o flechas) con una vista previa de pósteres.
// Sin JavaScript siguen siendo enlaces a Explorar; con él, un clic sobre el género ya elegido lleva allí.
const genrePicker = document.querySelector('[data-genre-picker]');
if (genrePicker) initGenrePicker(genrePicker);

function initGenrePicker(root) {
  const tablist = root.querySelector('[data-genre-tabs]');
  const tabs = [...tablist.querySelectorAll('[data-genre]')];
  const panel = root.querySelector('[data-genre-panel]');
  const grid = root.querySelector('[data-genre-grid]');
  const status = root.querySelector('[data-genre-status]');
  const skeleton = grid.firstElementChild.cloneNode(true);
  const verticalQuery = window.matchMedia('(min-width: 768px)');

  let shows = null; // series del índice, cuando ya se han cargado
  let current = 0;
  let hoverTimer = 0;
  let shownCount = 0; // pósteres (o skeletons) en la rejilla

  // Los pósteres miden lo mismo que en Populares (lo fija el CSS), así que caben más o menos según
  // el ancho: se muestra una fila completa; con tres columnas o menos (móvil y tablet), dos filas
  const posterCount = () => {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    return columns <= 3 ? columns * 2 : columns;
  };

  tablist.setAttribute('role', 'tablist');
  const syncOrientation = () => tablist.setAttribute('aria-orientation', verticalQuery.matches ? 'vertical' : 'horizontal');
  syncOrientation();
  verticalQuery.addEventListener('change', syncOrientation);
  panel.setAttribute('role', 'tabpanel');
  tabs.forEach((tab, index) => {
    tab.id = `genre-tab-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
  });

  // Las mejor puntuadas del género con póster, sin repetir las del hero, Nuestra selección ni Populares
  // (si no llegan, se completa con las que ya aparecen en otras secciones)
  const pickShows = (genre, count) => {
    const used = new Set([...HERO_SHOW_IDS, ...EDITORIAL_SHOW_IDS, ...pickDiscover(shows).map((show) => show.id)]);
    const ranked = shows
      .filter((show) => show.image && show.genres.includes(genre))
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    const fresh = ranked.filter((show) => !used.has(show.id));
    const rest = ranked.filter((show) => used.has(show.id));
    return [...fresh, ...rest].slice(0, count);
  };

  const renderSkeletons = () => {
    shownCount = posterCount();
    grid.replaceChildren(...Array.from({ length: shownCount }, () => skeleton.cloneNode(true)));
  };

  const renderPosters = ({ animate }) => {
    if (!shows) return;
    shownCount = posterCount();
    grid.replaceChildren(...pickShows(tabs[current].dataset.genre, shownCount).map(createSeriesCard));
    grid.removeAttribute('aria-busy');
    if (animate && !reducedMotion.matches) {
      grid.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  };

  const select = (index, { focus = false, animate = true } = {}) => {
    const changed = index !== current;
    current = index;
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tabs[index].id);
    if (focus) {
      tabs[index].focus();
      tabs[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (changed || animate === false) renderPosters({ animate: changed && animate });
  };

  // Con el ratón basta con pasar por encima (tras una breve pausa). Solo cuenta si el ratón se mueve
  // de verdad: con el cursor quieto, el contenido que se desplaza debajo no cambia el género
  // (ni pisa lo elegido con el teclado)
  let lastPointer = null;
  let hoverTarget = null;
  tabs.forEach((tab, index) => {
    tab.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const moved = !lastPointer || lastPointer.x !== event.clientX || lastPointer.y !== event.clientY;
      lastPointer = { x: event.clientX, y: event.clientY };
      if (!moved || index === current || index === hoverTarget) return;
      hoverTarget = index;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        hoverTarget = null;
        select(index);
      }, GENRE_HOVER_DELAY_MS);
    });
    tab.addEventListener('pointerleave', () => {
      clearTimeout(hoverTimer);
      hoverTarget = null;
    });
    // Clic o toque: si el género no estaba elegido, lo muestra; si ya lo estaba, abre Explorar
    tab.addEventListener('click', (event) => {
      if (tab.getAttribute('aria-selected') === 'true') return;
      event.preventDefault();
      clearTimeout(hoverTimer);
      select(index);
    });
  });

  // Teclado: flechas (en ambos sentidos), Inicio y Fin; Enter abre el género en Explorar
  const STEPS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  tablist.addEventListener('keydown', (event) => {
    let next = null;
    if (event.key in STEPS) next = (current + STEPS[event.key] + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    clearTimeout(hoverTimer);
    hoverTarget = null;
    select(next, { focus: true });
  });

  // Si al cambiar el ancho caben otras columnas, se rehace la rejilla (sin animación). Se atiende solo
  // al ancho, y el cambio se aplica en el siguiente fotograma para no encadenar avisos del observador
  let lastWidth = 0;
  let resizeFrame = 0;
  new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (width === lastWidth) return;
    lastWidth = width;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (grid.hidden || posterCount() === shownCount) return;
      if (shows) renderPosters({ animate: false });
      else renderSkeletons();
    });
  }).observe(root);

  async function load() {
    grid.hidden = false;
    grid.setAttribute('aria-busy', 'true');
    renderSkeletons();
    showStatus(status, null);
    try {
      shows = await getShowIndex(0);
      renderPosters({ animate: false });
    } catch (error) {
      console.error('[Inicio] Error al cargar los géneros:', error);
      grid.hidden = true;
      fillErrorMessage(status.querySelector('[data-status="error"]'), error);
      showStatus(status, 'error');
    }
  }

  status.querySelector('[data-retry]')?.addEventListener('click', load);
  select(0, { animate: false });
  load();
}

// Estrenos: programación web de hoy
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
