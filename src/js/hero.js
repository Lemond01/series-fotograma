import {
  createElement, createIcon, detailUrl, bindFavoriteButton, htmlToText, truncate,
  translateGenre, formatRating,
} from './ui.js';

const SPRITE_URL = 'assets/icons/sprite.svg';
const IMAGE_WAIT_MS = 2500;
const SUMMARY_LENGTH = 240;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const pad = (n) => String(n).padStart(2, '0');

// Diapositivas
function createSlide(show, index, total) {
  const slide = createElement('article', 'hero__slide');
  slide.setAttribute('role', 'group');
  slide.setAttribute('aria-roledescription', 'diapositiva');
  slide.setAttribute('aria-label', `${index + 1} de ${total}: ${show.name}`);

  // Sin fondo panorámico se usa el póster desenfocado, nunca estirado
  const media = createElement('div', 'hero__media');
  const image = createElement('img', 'hero__image');
  image.alt = '';
  image.decoding = 'async';
  image.dataset.src = show.backdrop?.url ?? show.image?.original ?? '';
  media.append(image);
  if (!show.backdrop) {
    media.classList.add('hero__media--poster');
    if (show.image) {
      const poster = createElement('img', 'hero__poster');
      poster.alt = `Póster de ${show.name}`;
      poster.decoding = 'async';
      poster.dataset.src = show.image.original;
      media.append(poster);
    }
  }

  const content = createElement('div', 'container hero__content');
  const title = createElement('h2', 'hero__title', show.name);

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

  const summary = htmlToText(show.summary);
  const description = createElement('p', 'hero__description', summary ? truncate(summary, SUMMARY_LENGTH) : 'Sinopsis no disponible.');
  if (summary) description.lang = 'en';

  const actions = createElement('div', 'hero__actions');
  const link = createElement('a', 'btn btn--primary', 'Ver ficha');
  link.href = detailUrl(show.id);
  link.append(createIcon('arrow-right', 'icon icon--sm'));
  const favorite = createElement('button', 'btn btn--secondary btn--favorite');
  favorite.type = 'button';
  favorite.dataset.favoriteToggle = '';
  favorite.append(createIcon('heart'), createElement('span', null, 'Agregar a favoritos'));
  favorite.lastChild.dataset.favoriteLabel = '';
  bindFavoriteButton(favorite, show);
  actions.append(link, favorite);

  content.append(createElement('p', 'hero__eyebrow', 'Serie destacada'), title, meta, description, actions);
  slide.append(media, content);
  return slide;
}

// Carga una diapositiva bajo demanda; resuelve al cargar, fallar o agotar la espera
function loadSlideImages(slide) {
  const pending = [...slide.querySelectorAll('img[data-src]')].map((img) => {
    const src = img.dataset.src;
    img.removeAttribute('data-src');
    if (!src) {
      img.hidden = true;
      return Promise.resolve();
    }
    // decode() espera a que la imagen esté decodificada: así no se decodifica en pleno scroll
    img.src = src;
    return img.decode().catch(() => {
      if (!img.naturalWidth) img.hidden = true;
    });
  });
  const timeout = new Promise((resolve) => { setTimeout(resolve, IMAGE_WAIT_MS); });
  return Promise.race([Promise.all(pending), timeout]);
}

// Carrusel con crossfade
export function createHeroCarousel(root, shows, { interval = 7000 } = {}) {
  const slidesEl = root.querySelector('[data-hero-slides]');
  const controls = root.querySelector('[data-hero-controls]');
  const dotsEl = root.querySelector('[data-hero-dots]');
  const currentEl = root.querySelector('[data-hero-current]');
  const totalEl = root.querySelector('[data-hero-total]');
  const toggle = root.querySelector('[data-hero-toggle]');
  const status = root.querySelector('[data-hero-status]');

  const total = shows.length;
  const slides = shows.map((show, i) => createSlide(show, i, total));
  const dots = shows.map((show, i) => {
    const dot = createElement('button', 'hero__dot');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Mostrar ${i + 1} de ${total}: ${show.name}`);
    dot.addEventListener('click', () => userGoTo(i));
    return dot;
  });

  let index = 0;
  let playing = !reducedMotion.matches;
  let hoverPaused = false;
  let offscreen = false;
  let timer = null;
  let changeToken = 0;

  root.style.setProperty('--hero-interval', `${interval}ms`);
  totalEl.textContent = pad(total);
  dotsEl.replaceChildren(...dots);

  const firstImage = slides[0].querySelector('.hero__image');
  if (firstImage) firstImage.fetchPriority = 'high';
  slides.forEach((slide, i) => {
    slide.classList.toggle('is-active', i === 0);
    slide.inert = i !== 0;
  });
  slidesEl.replaceChildren(...slides);
  controls.hidden = total < 2;

  const canPlay = () => playing && !hoverPaused && !offscreen && !document.hidden && total > 1;

  function syncToggle() {
    toggle.setAttribute('aria-label', playing ? 'Pausar el carrusel' : 'Reproducir el carrusel');
    toggle.querySelector('use')?.setAttribute('href', `${SPRITE_URL}#icon-${playing ? 'pause' : 'play'}`);
  }

  // Reinicia el temporizador y la barra de progreso del indicador activo
  function schedule() {
    clearTimeout(timer);
    root.classList.remove('is-playing');
    if (!canPlay()) return;
    void root.offsetWidth;
    root.classList.add('is-playing');
    timer = setTimeout(() => goTo(index + 1), interval);
  }

  async function goTo(target, { announce = false } = {}) {
    const next = (target + total) % total;
    const token = ++changeToken;
    clearTimeout(timer);
    await loadSlideImages(slides[next]);
    if (token !== changeToken) return; // hubo otro cambio mientras cargaba

    slides[index].classList.remove('is-active');
    slides[index].inert = true;
    slides[next].classList.add('is-active');
    slides[next].inert = false;
    index = next;

    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    currentEl.textContent = pad(index + 1);
    if (announce) status.textContent = `${index + 1} de ${total}: ${shows[index].name}`;

    loadSlideImages(slides[(index + 1) % total]);
    schedule();
  }

  // La interacción con los controles detiene la reproducción automática
  function userGoTo(target) {
    playing = false;
    syncToggle();
    goTo(target, { announce: true });
  }

  root.querySelector('[data-hero-prev]').addEventListener('click', () => userGoTo(index - 1));
  root.querySelector('[data-hero-next]').addEventListener('click', () => userGoTo(index + 1));
  toggle.addEventListener('click', () => {
    playing = !playing;
    syncToggle();
    schedule();
  });

  // Pausa temporal mientras el foco o el puntero están en los controles
  root.addEventListener('focusin', () => { hoverPaused = true; schedule(); });
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) { hoverPaused = false; schedule(); }
  });
  controls.addEventListener('pointerenter', () => { hoverPaused = true; schedule(); });
  controls.addEventListener('pointerleave', () => { hoverPaused = root.contains(document.activeElement); schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', (event) => {
    if (event.matches) { playing = false; syncToggle(); schedule(); }
  });

  dots[0].setAttribute('aria-current', 'true');
  syncToggle();
  loadSlideImages(slides[0]).then(() => {
    if (total > 1) loadSlideImages(slides[1]);
    schedule();
  });

  return {
    setOffscreen(value) {
      offscreen = value;
      schedule();
    },
  };
}

// Transición vinculada al scroll: el hero se desvanece mientras el contenido sube sobre él.
// El progreso se escribe solo en el hero (y la opacidad del borde), nunca en todo el documento.
export function initHeroScroll(hero, { edge, onPastChange } = {}) {
  let ticking = false;
  let past = false;
  let lastValue = '';

  const update = () => {
    ticking = false;
    const distance = Math.max(hero.offsetHeight * 0.9, 1);
    const progress = Math.min(Math.max(window.scrollY / distance, 0), 1);
    const value = progress.toFixed(3);
    if (value === lastValue) return;
    lastValue = value;
    hero.style.setProperty('--hero-progress', value);
    if (edge) edge.style.opacity = Math.min(Math.max((progress - 0.15) * 3, 0), 1).toFixed(3);
    const isPast = progress >= 0.995;
    if (isPast !== past) {
      past = isPast;
      hero.classList.toggle('is-past', past);
      onPastChange?.(past);
    }
  };

  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();
}
