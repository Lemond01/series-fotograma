// Barras de desplazamiento discretas: pista transparente y pulgar visible solo mientras se usan.
// Ninguna cambia el tamaño de la página al aparecer o desaparecer.

const HIDE_DELAY = 1000;
const INSET = 4; // margen superior e inferior de la pista (ver .page-scrollbar)
const MIN_THUMB = 48;

export function initScrollbars() {
  initInnerScrollbars();
  initPageScrollbar();
}

// Zonas con scroll propio (galería, menú móvil): el grosor es fijo y solo cambia el color
function initInnerScrollbars() {
  const timers = new WeakMap();
  document.addEventListener('scroll', (event) => {
    const element = event.target;
    if (!(element instanceof Element)) return;
    if (!element.classList.contains('is-scrolling')) element.classList.add('is-scrolling');
    clearTimeout(timers.get(element));
    timers.set(element, setTimeout(() => element.classList.remove('is-scrolling'), HIDE_DELAY));
  }, { capture: true, passive: true });
}

// Página: la barra nativa se oculta y se dibuja una flotante sobre el contenido.
// Solo con ratón (la clase la pone el script del <head> antes del primer pintado,
// para que el ancho de la página no cambie); en táctil el sistema ya usa barras flotantes.
function initPageScrollbar() {
  const root = document.documentElement;
  if (!root.classList.contains('has-page-scrollbar')) return;

  const bar = document.createElement('div');
  bar.className = 'page-scrollbar';
  bar.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('div');
  thumb.className = 'page-scrollbar__thumb';
  bar.append(thumb);
  document.body.append(bar);

  let metrics = { scrollable: 0, track: 0, thumb: 0 };
  let thumbHeight = 0;
  let hideTimer = 0;
  let ticking = false;
  let drag = null;

  const layout = () => {
    ticking = false;
    const view = window.innerHeight;
    const scrollable = root.scrollHeight - view;
    bar.classList.toggle('is-disabled', scrollable <= 1);
    if (scrollable <= 1) return;

    const track = view - INSET * 2;
    const size = Math.round(Math.max(track * (view / root.scrollHeight), MIN_THUMB));
    metrics = { scrollable, track, thumb: size };
    if (size !== thumbHeight) {
      thumbHeight = size;
      thumb.style.height = `${size}px`;
    }
    const offset = (track - size) * Math.min(Math.max(window.scrollY / scrollable, 0), 1);
    thumb.style.transform = `translateY(${offset.toFixed(1)}px)`;
  };

  const request = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(layout);
    }
  };

  const show = () => {
    bar.classList.add('is-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!drag && !bar.matches(':hover')) bar.classList.remove('is-visible');
    }, HIDE_DELAY);
  };

  window.addEventListener('scroll', () => {
    request();
    show();
  }, { passive: true });
  window.addEventListener('resize', request);
  new ResizeObserver(request).observe(document.body);
  bar.addEventListener('pointerenter', show);
  bar.addEventListener('pointerleave', show);

  // Arrastrar el pulgar
  thumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { y: event.clientY, top: window.scrollY };
    thumb.setPointerCapture(event.pointerId);
    bar.classList.add('is-dragging');
    show();
  });
  thumb.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const ratio = metrics.scrollable / Math.max(metrics.track - metrics.thumb, 1);
    window.scrollTo({ top: drag.top + (event.clientY - drag.y) * ratio, behavior: 'instant' });
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    bar.classList.remove('is-dragging');
    show();
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);

  // Clic en la pista: avanza o retrocede una pantalla
  bar.addEventListener('pointerdown', (event) => {
    if (event.target !== bar || event.button !== 0) return;
    const direction = event.clientY < thumb.getBoundingClientRect().top ? -1 : 1;
    window.scrollBy({ top: direction * window.innerHeight * 0.85 });
  });

  layout();
}
