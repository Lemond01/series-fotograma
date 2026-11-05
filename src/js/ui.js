import { isFavorite, toggleFavorite, getFavoritesCount, onFavoritesChange } from './favorites.js';
import { BRAND } from './brand.js';
import { initScrollbars } from './scrollbars.js';
import { initQuietLinks } from './links.js';

const SPRITE_URL = 'assets/icons/sprite.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DESKTOP_NAV_QUERY = '(min-width: 1024px)';
const SEARCH_CLOSE_MS = 400; // algo más que la animación de cierre de .site-search__form

// Ancho aproximado de una tarjeta según el grid (ver .series-grid, .rail y .editorial-grid)
const CARD_IMAGE_SIZES = '(min-width: 1920px) 16vw, (min-width: 1600px) 17vw, (min-width: 1280px) 20vw, (min-width: 768px) 25vw, (min-width: 480px) 33vw, 50vw';

// Header
export function initSiteHeader() {
  const header = document.querySelector('[data-site-header]');
  const toggle = document.querySelector('.site-header__toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  const iconUse = toggle.querySelector('use');

  // Header transparente sobre el hero de Inicio: se vuelve sólido al desplazarse
  if (header?.classList.contains('site-header--overlay')) {
    let ticking = false;
    const update = () => {
      ticking = false;
      header.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  const setOpen = (open) => {
    header?.classList.toggle('is-menu-open', open);
    nav.classList.toggle('site-nav--open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    iconUse?.setAttribute('href', `${SPRITE_URL}#icon-${open ? 'close' : 'menu'}`);
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  window.matchMedia(DESKTOP_NAV_QUERY).addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });

  initSiteSearch(header);
  initSectionLinks(nav, () => setOpen(false));
}

// Búsqueda del header (escritorio): se abre desde la lupa y se cierra con Escape, la X o al hacer clic fuera.
// Abrir y cerrar usan la misma animación en sentidos opuestos (ver .site-search__form).
function initSiteSearch(header) {
  const root = document.querySelector('[data-site-search]');
  const toggle = root?.querySelector('[data-site-search-toggle]');
  const form = root?.querySelector('form');
  const input = form?.querySelector('input');
  if (!toggle || !input) return;

  const close = root.querySelector('[data-site-search-close]');
  const sections = document.querySelector('.site-nav__list--sections');
  const desktop = window.matchMedia(DESKTOP_NAV_QUERY);
  const isOpen = () => root.classList.contains('is-open');
  let clearTimer = 0;

  // Las secciones solo se ocultan si el campo abierto llega a taparlas
  const updateCovering = () => {
    const covering = isOpen() && desktop.matches && sections
      && form.getBoundingClientRect().left < sections.getBoundingClientRect().right + 24;
    header?.classList.toggle('is-search-covering', Boolean(covering));
  };

  const setOpen = (open, { restoreFocus = true } = {}) => {
    clearTimeout(clearTimer);
    root.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    updateCovering();
    if (open) input.focus();
    else if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => setOpen(true));

  // La X vacía el campo, pero después de que termine de cerrarse
  close?.addEventListener('click', () => {
    setOpen(false);
    clearTimer = setTimeout(() => {
      if (!isOpen()) input.value = '';
    }, SEARCH_CLOSE_MS);
  });

  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.stopPropagation();
      setOpen(false);
    }
  });

  // Clic fuera: se cierra (si solo se cambió de ventana, sigue abierta)
  root.addEventListener('focusout', () => {
    setTimeout(() => {
      if (isOpen() && document.hasFocus() && !root.contains(document.activeElement)) {
        setOpen(false, { restoreFocus: false });
      }
    }, 0);
  });

  window.addEventListener('resize', () => {
    if (isOpen()) updateCovering();
  });
  desktop.addEventListener('change', () => {
    if (isOpen()) setOpen(false, { restoreFocus: false });
  });
}

// Enlaces a secciones de Inicio: cierran el menú móvil y marcan la sección visible
function initSectionLinks(nav, closeMenu) {
  const list = nav.querySelector('.site-nav__list--sections');
  if (!list) return;

  const home = list.querySelector('[aria-current="page"]');
  const links = [...list.querySelectorAll('a[href*="#"]')]
    .filter((link) => link.pathname === location.pathname && link.hash);
  const targets = new Map();
  links.forEach((link) => {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) targets.set(target.closest('section') ?? target, link);
  });

  const header = document.querySelector('[data-site-header]');
  const sections = [...targets.keys()];
  let active;
  let ticking = false;
  let holding = false;
  let releaseTimer = 0;

  const setActive = (section) => {
    if (section === active) return;
    active = section;
    targets.forEach((link, key) => {
      if (key === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  // Activa la última sección cuyo inicio ya pasó una línea cercana al header
  // (o la última de todas al llegar al final de la página)
  const update = () => {
    ticking = false;
    if (holding) return;
    const line = (header?.offsetHeight ?? 0) + window.innerHeight * 0.25;
    const root = document.documentElement;
    let next = null;
    if (window.scrollY + window.innerHeight >= root.scrollHeight - 2) {
      next = sections.at(-1);
    } else {
      for (const section of sections) {
        if (section.getBoundingClientRect().top > line) break;
        next = section;
      }
    }
    setActive(next);
  };

  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  // Tras un clic, la marca va directa al destino y el seguimiento espera a que el scroll se detenga
  const release = (delay) => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      holding = false;
      request();
    }, delay);
  };

  const hold = (section) => {
    setActive(section);
    holding = true;
    release(400);
  };

  // En Inicio, «Inicio» sube al principio en lugar de recargar la página
  home?.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closeMenu();
    hold(null);
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo({ top: 0 });
  });

  targets.forEach((link, section) => {
    link.addEventListener('click', () => {
      closeMenu();
      hold(section);
    });
  });
  if (targets.size === 0) return;

  window.addEventListener('scroll', () => {
    if (holding) release(150);
    else request();
  }, { passive: true });
  window.addEventListener('resize', request);
  update();
}

function markImageEmpty(img) {
  img.hidden = true;
  img.parentElement?.classList.add('is-empty');
}

// Imágenes
export function watchImage(img) {
  if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
    markImageEmpty(img);
    return;
  }
  img.addEventListener('error', () => markImageEmpty(img), { once: true });
}

export function initImageFallbacks(root = document) {
  root.querySelectorAll('img[data-fallback]').forEach(watchImage);
}

export function setImage(img, url, alt = '') {
  if (!img) return;
  img.parentElement?.classList.remove('is-empty');
  if (!url) {
    img.removeAttribute('src');
    markImageEmpty(img);
    return;
  }
  img.hidden = false;
  img.alt = alt;
  img.src = url;
  watchImage(img);
}

function syncBrand() {
  document.querySelectorAll('[data-brand-name]').forEach((node) => {
    node.textContent = BRAND.name;
  });
}

export function initPage() {
  syncBrand();
  initScrollbars();
  initSiteHeader();
  initImageFallbacks();
  initFavoriteButtons();
  // Al final: los enlaces de secciones del menú leen su destino (href) al iniciarse
  initQuietLinks();
}

// Favoritos
const FAVORITE_SELECTOR = '[data-favorite-toggle]';

// El nombre accesible indica la acción; el estado visual va en .is-active
export function syncFavoriteButton(button) {
  const id = button.dataset.showId;
  if (!id) return;
  const active = isFavorite(id);
  button.classList.toggle('is-active', active);
  const label = button.querySelector('[data-favorite-label]');
  if (label) {
    label.textContent = active ? 'Quitar de favoritos' : 'Agregar a favoritos';
  } else {
    const name = button.dataset.showName;
    button.setAttribute('aria-label', active ? `Quitar ${name} de favoritos` : `Agregar ${name} a favoritos`);
  }
}

export function bindFavoriteButton(button, show) {
  if (!button) return;
  button.dataset.showId = show.id;
  button.dataset.showName = show.name;
  syncFavoriteButton(button);
}

function syncFavoritesCount() {
  const count = getFavoritesCount();
  document.querySelectorAll('[data-favorites-count]').forEach((badge) => {
    // Se lee "Favoritos (3 guardadas)"; visualmente solo el número
    badge.replaceChildren(
      createElement('span', 'u-visually-hidden', ' ('),
      String(count),
      createElement('span', 'u-visually-hidden', count === 1 ? ' guardada)' : ' guardadas)'),
    );
    badge.hidden = count === 0;
  });
}

function syncAllFavoriteButtons(id) {
  const selector = id ? `${FAVORITE_SELECTOR}[data-show-id="${id}"]` : FAVORITE_SELECTOR;
  document.querySelectorAll(selector).forEach(syncFavoriteButton);
}

let favoritesInitialized = false;

function initFavoriteButtons() {
  if (favoritesInitialized) return;
  favoritesInitialized = true;

  // Delegación: cubre también las tarjetas creadas después
  document.addEventListener('click', (event) => {
    const button = event.target.closest(FAVORITE_SELECTOR);
    if (!button?.dataset.showId) return;
    event.preventDefault();
    toggleFavorite(button.dataset.showId);
  });

  onFavoritesChange((change) => {
    syncAllFavoriteButtons(change.external ? null : change.id);
    syncFavoritesCount();
  });

  syncFavoritesCount();
}

// Componentes
export function createIcon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE_URL}#icon-${name}`);
  svg.append(use);
  return svg;
}

export function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

export const detailUrl = (id) => `detalle.html?id=${encodeURIComponent(id)}`;

export function createSkeletonCard() {
  const item = createElement('li', 'series-card series-card--skeleton');
  item.setAttribute('aria-hidden', 'true');
  item.append(
    createElement('span', 'series-card__poster skeleton skeleton--poster'),
    createElement('span', 'skeleton skeleton--line'),
    createElement('span', 'skeleton skeleton--line skeleton--short'),
  );
  return item;
}

export function createSeriesCard(show) {
  const item = document.createElement('li');
  const card = createElement('article', 'series-card');
  card.dataset.showId = show.id;

  const link = createElement('a', 'series-card__link');
  link.href = detailUrl(show.id);

  const poster = createElement('div', 'series-card__poster media');
  if (show.image) {
    const img = createElement('img', 'series-card__img media__img');
    // loading antes de src: si no, la imagen se descarga aunque esté fuera de pantalla
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `Póster de ${show.name}`;
    img.width = 210;
    img.height = 295;
    if (show.image.original !== show.image.medium) {
      img.sizes = CARD_IMAGE_SIZES;
      img.srcset = `${show.image.medium} 210w, ${show.image.original} 680w`;
    }
    img.src = show.image.medium;
    poster.append(img);
    watchImage(img);
  } else {
    poster.classList.add('media--empty');
  }

  const body = createElement('div', 'series-card__body');
  body.append(createElement('h3', 'series-card__title', show.name));

  const metaParts = [show.year, show.genres[0] ? translateGenre(show.genres[0]) : null].filter(Boolean);
  if (metaParts.length) {
    const meta = createElement('p', 'series-card__meta');
    metaParts.forEach((part, index) => {
      if (index > 0) meta.append(' · ');
      meta.append(createElement('span', index === 0 && show.year ? 'series-card__year' : 'series-card__genre', part));
    });
    body.append(meta);
  }

  link.append(poster, body);
  card.append(link);

  if (show.rating !== null) {
    const rating = createElement('p', 'series-card__rating');
    rating.append(
      createElement('span', 'u-visually-hidden', 'Calificación: '),
      createIcon('star', 'icon icon--sm icon--filled'),
      formatRating(show.rating),
    );
    card.append(rating);
  }

  const favorite = createElement('button', 'series-card__favorite');
  favorite.type = 'button';
  favorite.dataset.favoriteToggle = '';
  favorite.append(createIcon('heart'));
  bindFavoriteButton(favorite, show);
  card.append(favorite);

  item.append(card);
  return item;
}

// DOMParser no ejecuta scripts; solo se usa textContent
export function htmlToParagraphs(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = doc.body.querySelectorAll('p, li');
  const texts = blocks.length
    ? [...blocks].map((node) => node.textContent)
    : [doc.body.textContent];
  return texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export const htmlToText = (html) => htmlToParagraphs(html).join(' ');

export function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

// Traducciones
const GENRES = {
  Action: 'Acción', Adult: 'Adultos', Adventure: 'Aventura', Anime: 'Anime', Children: 'Infantil',
  Comedy: 'Comedia', Crime: 'Crimen', DIY: 'Bricolaje', Drama: 'Drama', Espionage: 'Espionaje',
  Family: 'Familiar', Fantasy: 'Fantasía', Food: 'Gastronomía', History: 'Historia', Horror: 'Terror',
  Legal: 'Legal', Medical: 'Médico', Music: 'Música', Mystery: 'Misterio', Nature: 'Naturaleza',
  Romance: 'Romance', 'Science-Fiction': 'Ciencia ficción', Sports: 'Deportes',
  Supernatural: 'Sobrenatural', Thriller: 'Thriller', Travel: 'Viajes', War: 'Bélico', Western: 'Western',
};

const STATUSES = {
  Running: 'En emisión', Ended: 'Finalizada', 'To Be Determined': 'Por determinar', 'In Development': 'En desarrollo',
};

const LANGUAGES = {
  English: 'Inglés', Spanish: 'Español', French: 'Francés', German: 'Alemán', Italian: 'Italiano',
  Portuguese: 'Portugués', Japanese: 'Japonés', Korean: 'Coreano', Chinese: 'Chino', Russian: 'Ruso',
  Swedish: 'Sueco', Norwegian: 'Noruego', Danish: 'Danés', Dutch: 'Neerlandés', Turkish: 'Turco',
  Hindi: 'Hindi', Arabic: 'Árabe', Polish: 'Polaco', Finnish: 'Finés', Hebrew: 'Hebreo', Thai: 'Tailandés',
};

const DAYS = {
  Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves',
  Friday: 'Viernes', Saturday: 'Sábado', Sunday: 'Domingo',
};

export const KNOWN_GENRES = Object.keys(GENRES);

export const translateGenre = (genre) => GENRES[genre] ?? genre;

// «Series de drama», «Series de ciencia ficción»… (los géneros que en español son adjetivos llevan su forma)
const GENRE_TITLES = {
  Adult: 'Series para adultos', Children: 'Series infantiles', Family: 'Series familiares',
  Legal: 'Series legales', Medical: 'Series médicas', Supernatural: 'Series sobrenaturales',
  War: 'Series bélicas', Western: 'Series del oeste',
};
export const genreTitle = (genre) => GENRE_TITLES[genre] ?? `Series de ${translateGenre(genre).toLowerCase()}`;
export const translateStatus = (status) => (status ? STATUSES[status] ?? status : null);
export const translateLanguage = (language) => (language ? LANGUAGES[language] ?? language : null);
export const translateDays = (days) => days.map((day) => DAYS[day] ?? day).join(', ');

const ratingFormatter = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatRating = (rating) => ratingFormatter.format(rating);

const dateFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export function formatDate(isoDate) {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

const timeFormatter = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
export function formatLocalTime(airstamp) {
  if (!airstamp) return null;
  const date = new Date(airstamp);
  return Number.isNaN(date.getTime()) ? null : timeFormatter.format(date);
}

// Mensajes de error
const ERROR_MESSAGES = {
  network: ['Sin conexión con TVmaze', 'Comprueba tu conexión a internet e inténtalo de nuevo.'],
  timeout: ['TVmaze está tardando demasiado', 'La solicitud superó el tiempo de espera. Inténtalo de nuevo.'],
  'not-found': ['Contenido no encontrado', 'TVmaze no encontró el recurso solicitado.'],
  'rate-limit': ['Demasiadas solicitudes', 'TVmaze limita el número de consultas. Espera unos segundos e inténtalo de nuevo.'],
  invalid: ['Respuesta inesperada', 'TVmaze devolvió datos con un formato que no pudimos interpretar.'],
  http: ['No pudimos cargar los datos', 'TVmaze respondió con un error. Inténtalo de nuevo más tarde.'],
};

export function getErrorMessage(error, overrides = {}) {
  const [title, text] = overrides[error?.type] ?? ERROR_MESSAGES[error?.type] ?? ERROR_MESSAGES.http;
  return { title, text };
}

export function showStatus(container, name) {
  container?.querySelectorAll('[data-status]').forEach((element) => {
    element.hidden = element.dataset.status !== name;
  });
}

export function fillErrorMessage(element, error, overrides) {
  if (!element) return;
  const { title, text } = getErrorMessage(error, overrides);
  const titleElement = element.querySelector('[data-error-title]');
  const textElement = element.querySelector('[data-error-text]');
  if (titleElement) titleElement.textContent = title;
  if (textElement) textElement.textContent = text;
}

// Utilidades
export function debounce(fn, delay) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
