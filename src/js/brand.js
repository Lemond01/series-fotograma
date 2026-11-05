// Marca (nombre provisional): cambiar aquí actualiza los títulos y los elementos [data-brand-name]
export const BRAND = {
  name: 'Fotograma',
  tagline: 'Series para descubrir',
};

export function pageTitle(section) {
  return section ? `${section} — ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`;
}
