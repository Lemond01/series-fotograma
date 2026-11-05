import {
  createElement, createIcon, detailUrl, htmlToText, truncate,
  translateGenre, formatRating, watchImage,
} from './ui.js';

const IMAGE_WAIT_MS = 2500;
const SUMMARY_LENGTH = 240;
// Pósteres de la derecha (desde lg): 17rem como el de la ficha si caben; si no, lo que quede a la
// derecha del texto, con un mínimo por debajo del cual no se muestran
const TRIO_MAX_CARD = 272;
const TRIO_MIN_CARD = 140;
const TRIO_TEXT_GAP = 48; // aire mínimo entre el texto y los pósteres
const IDLE_MS = 2500; // con el ratón quieto este tiempo, se ocultan los controles

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const trioQuery = window.matchMedia('(min-width: 1024px)');

// Valor en px de una variable CSS escrita en rem o en px (getPropertyValue la devuelve tal cual)
function cssLength(element, name) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const number = parseFloat(value) || 0;
  return value.endsWith('rem') ? number * parseFloat(getComputedStyle(document.documentElement).fontSize) : number;
}

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
  // Sin botón «Ver ficha», el título enlaza a la ficha (con teclado y en móvil es el acceso)
  const title = createElement('h2', 'hero__title');
  const titleLink = createElement('a', 'hero__title-link', show.name);
  titleLink.href = detailUrl(show.id);
  title.append(titleLink);

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

  content.append(createElement('p', 'hero__eyebrow', 'Serie destacada'), title, meta, description);
  slide.append(media, content);
  return slide;
}

// Póster de la columna derecha (desde lg): anterior, actual o siguiente. Es un enlace a la ficha
// (el central la abre al hacer clic). La columna es decorativa para el teclado y los lectores de
// pantalla: ahí el acceso es el título
function createTrioCard(show) {
  const card = createElement('a', 'hero__trio-card');
  card.href = detailUrl(show.id);
  card.tabIndex = -1;
  const poster = createElement('div', 'hero__trio-poster media');
  if (show.image) {
    const img = createElement('img', 'media__img');
    // loading antes de src: mientras la columna no se muestre, no se descargan
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    if (show.image.original !== show.image.medium) {
      img.sizes = `${TRIO_MAX_CARD}px`;
      img.srcset = `${show.image.medium} 210w, ${show.image.original} 680w`;
    }
    img.src = show.image.medium;
    poster.append(img);
    watchImage(img);
  } else {
    poster.classList.add('media--empty');
  }
  card.append(poster);
  return card;
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
  const trio = root.querySelector('[data-hero-trio]');
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
  const cards = shows.map(createTrioCard);

  let index = 0;
  let playing = !reducedMotion.matches;
  let focusPaused = false; // foco de teclado dentro del hero
  let offscreen = false;
  let timer = null;
  let remaining = interval; // tiempo que le queda a la serie actual
  let startedAt = 0;
  let changeToken = 0;

  dotsEl.replaceChildren(...dots);

  const firstImage = slides[0].querySelector('.hero__image');
  if (firstImage) firstImage.fetchPriority = 'high';
  slides.forEach((slide, i) => {
    slide.classList.toggle('is-active', i === 0);
    slide.inert = i !== 0;
  });
  slidesEl.replaceChildren(...slides);
  controls.hidden = total < 2;
  if (total > 1) trio.replaceChildren(...cards);

  // Los pósteres no pisan nunca el texto (que no se mueve): miden lo que quede entre el texto más
  // ancho de las diapositivas y el margen derecho, hasta 17rem. Si no llegan al mínimo, no se muestran
  // y el progreso vuelve a los indicadores (.has-trio)
  const aside = trio.parentElement;
  function fitTrio() {
    let size = 0;
    if (total > 1 && trioQuery.matches) {
      let textRight = 0;
      const range = document.createRange();
      slides.forEach((slide) => {
        slide.querySelectorAll('.hero__eyebrow, .hero__title, .meta-list, .hero__description').forEach((element) => {
          range.selectNodeContents(element);
          for (const rect of range.getClientRects()) textRight = Math.max(textRight, rect.right);
        });
      });
      const gap = cssLength(aside, '--trio-gap');
      size = Math.floor(Math.min(TRIO_MAX_CARD, (aside.getBoundingClientRect().right - textRight - TRIO_TEXT_GAP - gap * 2) / 3));
    }
    const visible = size >= TRIO_MIN_CARD;
    root.classList.toggle('has-trio', visible);
    if (!visible) return;
    root.style.setProperty('--trio-card', `${size}px`);
    trio.querySelectorAll('img').forEach((img) => {
      if (img.srcset) img.sizes = `${size}px`;
      img.loading = 'eager'; // también los ocultos a los lados, para que entren ya cargados
    });
  }

  let fitFrame = 0;
  const requestFit = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitTrio);
  };
  fitTrio();
  document.fonts?.ready.then(fitTrio);
  window.addEventListener('resize', requestFit);
  trioQuery.addEventListener('change', fitTrio);

  const canPlay = () => playing && !focusPaused && !offscreen && !document.hidden && total > 1;

  // Posición de cada póster respecto a la serie actual: -1 anterior, 0 actual, 1 siguiente. El resto
  // queda oculto a un lado (-2 o 2), el de salida según el sentido del cambio. Con dos series solo
  // se ven la actual y la siguiente
  function positionOf(i, direction) {
    const offset = (i - index + total) % total;
    if (offset === 0 || offset === 1) return offset;
    if (offset === total - 1) return -1;
    return direction > 0 ? -2 : 2;
  }

  // Mueve los pósteres a su nueva posición. Los que aparecen (estaban ocultos o dan la vuelta)
  // parten de fuera, por su lado, sin transición; después todos se animan a la vez
  function placeTrio(direction, { instant = false } = {}) {
    const moves = cards.map((card, i) => ({ card, from: Number(card.dataset.pos), to: positionOf(i, direction) }));
    moves.forEach(({ card, from, to }) => {
      const appears = Math.abs(to) <= 1 && (Math.abs(from) > 1 || (to - from) * direction > 0);
      if (instant) {
        card.classList.add('is-instant');
        card.dataset.pos = String(to);
      } else if (appears) {
        card.classList.add('is-instant');
        card.dataset.pos = String(to === 0 ? 2 * direction : 2 * Math.sign(to));
      }
    });
    void trio.offsetWidth; // fija la posición de partida antes de animar
    moves.forEach(({ card, to }) => {
      card.classList.remove('is-instant');
      card.dataset.pos = String(to);
    });
  }

  // Serie nueva: el temporizador empieza de cero
  function restart() {
    clearTimeout(timer);
    timer = null;
    remaining = interval;
    sync();
  }

  // Pausa o reanuda sin reiniciar: en pausa (foco de teclado en el hero, pestaña oculta, hero fuera
  // de vista) el temporizador guarda lo que le falta y, al reanudar, sigue desde ahí
  function sync() {
    if (canPlay()) {
      if (timer) return;
      startedAt = performance.now();
      timer = setTimeout(() => {
        timer = null;
        goTo(index + 1);
      }, remaining);
    } else if (timer) {
      clearTimeout(timer);
      timer = null;
      remaining = Math.max(remaining - (performance.now() - startedAt), 0);
    }
  }

  async function goTo(target, { announce = false } = {}) {
    const next = (target + total) % total;
    const step = (next - index + total) % total;
    const direction = step > total / 2 ? -1 : 1; // por el camino más corto
    const token = ++changeToken;
    clearTimeout(timer);
    timer = null;
    remaining = interval; // si se reanuda mientras carga, no debe saltar a la siguiente enseguida
    await loadSlideImages(slides[next]);
    if (token !== changeToken) return; // hubo otro cambio mientras cargaba

    slides[index].classList.remove('is-active');
    slides[index].inert = true;
    slides[next].classList.add('is-active');
    slides[next].inert = false;
    index = next;

    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    if (total > 1) placeTrio(direction);
    if (announce) status.textContent = `${index + 1} de ${total}: ${shows[index].name}`;

    loadSlideImages(slides[(index + 1) % total]);
    restart();
  }

  // Sin botón de pausa, cambiar de serie a mano no detiene el autoplay: sigue desde la nueva serie
  // (con teclado, queda en pausa mientras el foco esté en el hero)
  function userGoTo(target) {
    goTo(target, { announce: true });
  }

  root.querySelector('[data-hero-prev]').addEventListener('click', () => userGoTo(index - 1));
  root.querySelector('[data-hero-next]').addEventListener('click', () => userGoTo(index + 1));
  // Con el ratón, el póster central abre la ficha (es un enlace) y los de los lados ponen su serie
  // en el centro (con teclado y lectores de pantalla, las flechas y los indicadores hacen lo mismo)
  cards.forEach((card) => card.addEventListener('click', (event) => {
    const position = Number(card.dataset.pos);
    if (position !== -1 && position !== 1) return;
    event.preventDefault();
    userGoTo(index + position);
  }));

  // Con ratón y sin pósteres, los controles se ocultan si el ratón se queda quieto y vuelven al
  // moverlo (.is-idle); con pósteres, las flechas solo se ven con el ratón encima (CSS). En pantallas
  // táctiles siempre están a la vista
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let idleTimer = 0;
  let lastWake = 0;
  const wake = () => {
    const now = performance.now();
    if (!root.classList.contains('is-idle') && now - lastWake < 200) return;
    lastWake = now;
    root.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (finePointer.matches) idleTimer = setTimeout(() => root.classList.add('is-idle'), IDLE_MS);
  };
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') wake();
  }, { passive: true });
  wake();

  // El ratón no pausa el carrusel (ni encima de los pósteres ni al hacer clic en las flechas). Solo
  // se pausa mientras el foco de teclado está dentro del hero, para poder leer o usar los controles
  root.addEventListener('focusin', (event) => {
    if (!event.target.matches(':focus-visible')) return;
    focusPaused = true;
    sync();
  });
  root.addEventListener('focusout', (event) => {
    if (root.contains(event.relatedTarget)) return;
    focusPaused = false;
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', (event) => {
    playing = !event.matches;
    restart();
  });

  dots[0].setAttribute('aria-current', 'true');
  if (total > 1) placeTrio(1, { instant: true });
  loadSlideImages(slides[0]).then(() => {
    if (total > 1) loadSlideImages(slides[1]);
    restart();
  });

  return {
    setOffscreen(value) {
      offscreen = value;
      sync();
    },
  };
}

// Transición vinculada al scroll: el hero se desvanece mientras el contenido sube sobre él.
// El progreso se escribe solo en el hero (y la opacidad del borde), nunca en todo el documento.
export function initHeroScroll(hero, { edge, content, onPastChange } = {}) {
  let ticking = false;
  let past = false;
  let lastValue = '';
  let overlap = 0;

  // Desde lg el contenido asoma sobre el final del hero (margen negativo), así que lo tapa antes
  const measure = () => {
    overlap = content ? Math.max(-parseFloat(getComputedStyle(content).marginTop) || 0, 0) : 0;
  };

  const update = () => {
    ticking = false;
    const distance = Math.max((hero.offsetHeight - overlap) * 0.9, 1);
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
  window.addEventListener('resize', () => {
    measure();
    request();
  });
  measure();
  update();
}
