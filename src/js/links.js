// Enlaces sin la dirección en la barra de estado: el navegador la muestra al pasar el ratón por
// cualquier enlace con href. Al cargar (y con cada enlace que se añade después), el destino pasa a
// data-href y la navegación la hace este script: clic, Intro, rueda del ratón o Ctrl/Cmd/Mayús
// (pestaña nueva). Para el teclado y los lectores de pantalla siguen siendo enlaces
// (role="link", enfocables), y sin JavaScript son enlaces normales.
const LINK_SELECTOR = 'a[href]';
const QUIET_SELECTOR = 'a[data-href]';

function quiet(link) {
  link.dataset.href = link.getAttribute('href');
  link.removeAttribute('href');
  if (!link.hasAttribute('role')) link.setAttribute('role', 'link');
  if (!link.hasAttribute('tabindex')) link.tabIndex = 0;
}

function quietWithin(root) {
  if (root.matches?.(LINK_SELECTOR)) quiet(root);
  root.querySelectorAll?.(LINK_SELECTOR).forEach(quiet);
}

function follow(link, { newTab = false } = {}) {
  const url = new URL(link.dataset.href, document.baseURI).href;
  if (newTab || link.target === '_blank') window.open(url, '_blank', 'noopener');
  else window.location.assign(url);
}

const linkFrom = (event) => (event.target instanceof Element ? event.target.closest(QUIET_SELECTOR) : null);

export function initQuietLinks() {
  quietWithin(document);

  // Enlaces nuevos (tarjetas, hero, programación...) o a los que se les cambia el destino
  new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'attributes') {
        if (record.target.matches(LINK_SELECTOR)) quiet(record.target);
        return;
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) quietWithin(node);
      });
    });
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['href'],
  });

  // Clic: en la misma pestaña, o en una nueva con Ctrl/Cmd/Mayús. Si el propio enlace ya gestionó
  // el clic (preventDefault: pestañas de género, pósteres laterales del hero...), no se navega
  document.addEventListener('click', (event) => {
    const link = linkFrom(event);
    if (!link || event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    follow(link, { newTab: event.ctrlKey || event.metaKey || event.shiftKey });
  });

  // Rueda del ratón: pestaña nueva, como un enlace normal (sin el desplazamiento automático)
  document.addEventListener('mousedown', (event) => {
    if (event.button === 1 && linkFrom(event)) event.preventDefault();
  });
  document.addEventListener('auxclick', (event) => {
    const link = linkFrom(event);
    if (!link || event.defaultPrevented || event.button !== 1) return;
    event.preventDefault();
    follow(link, { newTab: true });
  });

  // Intro activa el enlace con los mismos modificadores (role="link" no lo hace solo)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const link = linkFrom(event);
    if (!link || event.target !== link) return;
    event.preventDefault();
    link.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }));
  });
}
