import { getShowDetails, getShowEpisodes } from './api.js';
import {
  initPage, createElement, createIcon, setImage, htmlToParagraphs, htmlToText, truncate, bindFavoriteButton,
  translateGenre, translateStatus, translateLanguage, translateDays,
  formatRating, formatDate, showStatus, fillErrorMessage,
} from './ui.js';

const EPISODE_SUMMARY_LENGTH = 240;
const NOT_AVAILABLE = 'No disponible';
const SHOW_ERROR_MESSAGES = {
  'not-found': ['No encontramos esta serie', 'Es posible que el enlace sea incorrecto o que la serie ya no exista en TVmaze.'],
};

initPage();

const pageStatus = document.querySelector('[data-detail-status]');
const content = document.querySelector('[data-detail-content]');
const episodesStatus = document.querySelector('[data-episodes-status]');
const seasonsContainer = document.querySelector('[data-seasons]');
const episodesSummary = document.querySelector('[data-episodes-summary]');
const field = (name) => content.querySelector(`[data-field="${name}"]`);

const showId = parseShowId(new URLSearchParams(window.location.search).get('id'));

if (showId === null) {
  showInvalidId();
} else {
  loadPage();
}

pageStatus.querySelector('[data-retry]')?.addEventListener('click', loadPage);
episodesStatus.querySelector('[data-retry]')?.addEventListener('click', () => loadEpisodes(settle(getShowEpisodes(showId))));

function parseShowId(value) {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

function showInvalidId() {
  const errorElement = pageStatus.querySelector('[data-status="error"]');
  errorElement.querySelector('[data-error-title]').textContent = 'Serie no especificada';
  errorElement.querySelector('[data-error-text]').textContent =
    'El enlace no incluye un identificador de serie válido. Busca una serie en Explorar para ver su ficha.';
  errorElement.querySelector('[data-retry]').hidden = true;
  showStatus(pageStatus, 'error');
  document.title = 'Serie no encontrada — Series Atlas';
}

async function loadPage() {
  showStatus(pageStatus, 'loading');
  content.hidden = true;

  const detailsRequest = getShowDetails(showId);
  const episodesResult = settle(getShowEpisodes(showId));

  let show;
  try {
    show = await detailsRequest;
  } catch (error) {
    console.error(`[Detalle] Error al cargar la serie ${showId}:`, error);
    fillErrorMessage(pageStatus.querySelector('[data-status="error"]'), error, SHOW_ERROR_MESSAGES);
    pageStatus.querySelector('[data-retry]').hidden = error.type === 'not-found';
    showStatus(pageStatus, 'error');
    document.title = 'Serie no disponible — Series Atlas';
    return;
  }

  renderShow(show);
  showStatus(pageStatus, null);
  content.hidden = false;
  loadEpisodes(episodesResult);
}

function settle(promise) {
  return promise.then((value) => ({ value }), (error) => ({ error }));
}

async function loadEpisodes(resultPromise) {
  showStatus(episodesStatus, 'loading');
  seasonsContainer.replaceChildren();

  const { value: episodes, error } = await resultPromise;
  if (error) {
    console.error(`[Detalle] Error al cargar los episodios de la serie ${showId}:`, error);
    fillErrorMessage(episodesStatus.querySelector('[data-status="error"]'), error);
    showStatus(episodesStatus, 'error');
    return;
  }
  renderSeasons(episodes);
}

function renderShow(show) {
  document.title = `${show.name} — Series Atlas`;

  setImage(field('backdrop'), show.image?.original, '');
  setImage(field('image'), show.image?.original, `Póster de ${show.name}`);
  field('name').textContent = show.name;
  bindFavoriteButton(content.querySelector('[data-favorite-toggle]'), show);

  renderMeta(show);
  renderGenres(show.genres);
  renderSummary(show.summary);
  renderFacts(show);
}

function renderMeta(show) {
  const items = [];

  if (show.year) {
    const endYear = show.ended ? show.ended.slice(0, 4) : null;
    let years = show.year;
    if (endYear && endYear !== show.year) years = `${show.year}–${endYear}`;
    else if (show.status === 'Running') years = `${show.year}–`;
    items.push(createElement('li', 'meta-list__item', years));
  }

  const status = translateStatus(show.status);
  if (status) {
    const modifier = show.status === 'Running' ? ' meta-list__item--live' : '';
    items.push(createElement('li', `meta-list__item${modifier}`, status));
  }

  if (show.runtime) items.push(createElement('li', 'meta-list__item', `${show.runtime} min`));

  if (show.rating !== null) {
    const rating = createElement('li', 'meta-list__item meta-list__item--rating');
    rating.append(
      createIcon('star', 'icon icon--sm icon--filled'),
      createElement('span', 'u-visually-hidden', 'Calificación: '),
      `${formatRating(show.rating)} / 10`,
    );
    items.push(rating);
  }

  field('meta').replaceChildren(...items);
}

function renderGenres(genres) {
  const list = field('genres');
  list.replaceChildren(...genres.map((genre) => createElement('li', 'tag', translateGenre(genre))));
  list.hidden = genres.length === 0;
}

function renderSummary(summaryHtml) {
  const container = field('summary');
  const paragraphs = htmlToParagraphs(summaryHtml);
  if (paragraphs.length === 0) {
    container.replaceChildren(createElement('p', null, 'TVmaze no tiene una sinopsis para esta serie.'));
    container.removeAttribute('lang');
    return;
  }
  container.lang = 'en'; // sinopsis de TVmaze en inglés
  container.replaceChildren(...paragraphs.map((text) => createElement('p', null, text)));
}

function renderFacts(show) {
  const schedule = [translateDays(show.scheduleDays), show.scheduleTime].filter(Boolean).join(' · ');
  const values = {
    premiered: formatDate(show.premiered),
    ended: formatDate(show.ended),
    status: translateStatus(show.status),
    network: show.network,
    language: translateLanguage(show.language),
    runtime: show.runtime ? `${show.runtime} min` : null,
    schedule: schedule || null,
  };

  Object.entries(values).forEach(([name, value]) => {
    field(name).textContent = value ?? NOT_AVAILABLE;
  });
  content.querySelector('[data-fact="ended"]').hidden = !values.ended;
}

function groupBySeason(episodes) {
  const seasons = new Map();
  episodes.forEach((episode) => {
    const key = episode.season ?? 0;
    if (!seasons.has(key)) seasons.set(key, []);
    seasons.get(key).push(episode);
  });
  return [...seasons.entries()]
    .sort(([a], [b]) => (a === 0) - (b === 0) || a - b)
    .map(([season, list]) => ({
      season,
      episodes: list.sort((x, y) => (x.number ?? Infinity) - (y.number ?? Infinity)),
    }));
}

function renderSeasons(episodes) {
  if (episodes.length === 0) {
    episodesSummary.textContent = '';
    showStatus(episodesStatus, 'empty');
    return;
  }

  const seasons = groupBySeason(episodes);
  const seasonWord = seasons.length === 1 ? 'temporada' : 'temporadas';
  const episodeWord = episodes.length === 1 ? 'episodio' : 'episodios';
  episodesSummary.textContent =
    `${seasons.length} ${seasonWord} · ${episodes.length} ${episodeWord}. Despliega una temporada para ver sus episodios.`;

  const elements = seasons.map(createSeason);
  seasonsContainer.replaceChildren(...elements);

  if (elements[0]) elements[0].open = true;
  showStatus(episodesStatus, null);
}

function createSeason({ season, episodes }) {
  const details = createElement('details', 'season');

  const summary = createElement('summary', 'season__header');
  const title = createElement('span', 'season__title', season === 0 ? 'Sin temporada' : `Temporada ${season}`);
  const years = [...new Set(episodes.map((e) => e.airdate?.slice(0, 4)).filter(Boolean))];
  const yearText = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0];
  const meta = createElement('span', 'season__meta',
    [`${episodes.length} ${episodes.length === 1 ? 'episodio' : 'episodios'}`, yearText].filter(Boolean).join(' · '));
  summary.append(title, meta, createIcon('chevron-down', 'icon season__chevron'));

  const list = createElement('ol', 'episode-list season__episodes');
  details.append(summary, list);

  // Los episodios se generan al abrir la temporada
  details.addEventListener('toggle', () => {
    if (details.open && list.childElementCount === 0) {
      list.append(...episodes.map(createEpisode));
    }
  });

  return details;
}

function createEpisode(episode) {
  const item = createElement('li', 'episode');

  const thumb = createElement('div', 'episode__thumb media');
  if (episode.image) {
    const img = createElement('img', 'media__img');
    img.loading = 'lazy';
    img.decoding = 'async';
    thumb.append(img);
    setImage(img, episode.image.medium, '');
  } else {
    thumb.classList.add('media--empty');
  }

  const body = createElement('div', 'episode__body');
  const number = episode.number !== null ? `Episodio ${episode.number}` : 'Episodio especial';
  body.append(
    createElement('p', 'episode__number', number),
    createElement('h3', 'episode__title', episode.name),
  );

  const meta = [formatDate(episode.airdate), episode.runtime ? `${episode.runtime} min` : null].filter(Boolean);
  if (meta.length) body.append(createElement('p', 'episode__meta', meta.join(' · ')));

  const summaryText = htmlToText(episode.summary);
  if (summaryText) {
    const summary = createElement('p', 'episode__summary', truncate(summaryText, EPISODE_SUMMARY_LENGTH));
    summary.lang = 'en';
    body.append(summary);
  }

  item.append(thumb, body);
  return item;
}
