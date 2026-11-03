import { getShowDetails, getWebSchedule } from './api.js';
import {
  initPage, createElement, createIcon, createSeriesCard, detailUrl, setImage, bindFavoriteButton,
  htmlToText, truncate, translateGenre, formatRating, formatLocalTime,
  getErrorMessage, showStatus, fillErrorMessage,
} from './ui.js';

// Selección editorial (IDs de TVmaze)
const FEATURED_SHOW_ID = 169;
const DISCOVER_SHOW_IDS = [82, 2993, 335, 431, 305, 179];
const SCHEDULE_LIMIT = 8;
const HERO_SUMMARY_LENGTH = 220;

initPage();

async function loadHero() {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;

  const title = hero.querySelector('[data-hero-title]');
  const meta = hero.querySelector('[data-hero-meta]');
  const description = hero.querySelector('[data-hero-description]');
  const actions = hero.querySelector('[data-hero-actions]');

  try {
    const show = await getShowDetails(FEATURED_SHOW_ID);

    setImage(hero.querySelector('[data-hero-image]'), show.image?.original, '');
    title.textContent = show.name;

    meta.replaceChildren();
    const metaItems = [
      show.year,
      show.genres.slice(0, 2).map(translateGenre).join(' · ') || null,
    ].filter(Boolean).map((text) => createElement('li', 'meta-list__item', text));
    if (show.rating !== null) {
      const rating = createElement('li', 'meta-list__item meta-list__item--rating');
      rating.append(
        createIcon('star', 'icon icon--sm icon--filled'),
        createElement('span', 'u-visually-hidden', 'Calificación: '),
        formatRating(show.rating),
      );
      metaItems.push(rating);
    }
    meta.append(...metaItems);

    const summary = htmlToText(show.summary);
    description.textContent = summary ? truncate(summary, HERO_SUMMARY_LENGTH) : 'Sinopsis no disponible.';
    description.lang = 'en'; // sinopsis de TVmaze en inglés

    hero.querySelector('[data-hero-link]').href = detailUrl(show.id);
    bindFavoriteButton(hero.querySelector('[data-favorite-toggle]'), show);
    actions.hidden = false;
  } catch (error) {
    console.error('[Inicio] Error al cargar la serie destacada:', error);
    const { title: errorTitle, text } = getErrorMessage(error);
    title.textContent = 'Descubre series de televisión';
    meta.replaceChildren();
    description.textContent = `${errorTitle}. ${text}`;
  } finally {
    hero.removeAttribute('aria-busy');
  }
}

const discoverGrid = document.querySelector('[data-discover-grid]');
const discoverStatus = document.querySelector('[data-discover-status]');
const discoverSkeletons = discoverGrid ? [...discoverGrid.children].map((node) => node.cloneNode(true)) : [];
let discoverRequestId = 0;

function showDiscoverSkeletons() {
  discoverGrid.replaceChildren(...discoverSkeletons.map((node) => node.cloneNode(true)));
  discoverGrid.setAttribute('aria-busy', 'true');
  discoverGrid.hidden = false;
  showStatus(discoverStatus, null);
}

async function loadDiscover() {
  const grid = discoverGrid;
  const status = discoverStatus;
  if (!grid) return;

  const requestId = ++discoverRequestId;
  showDiscoverSkeletons();

  const results = await Promise.allSettled(DISCOVER_SHOW_IDS.map((id) => getShowDetails(id)));
  if (requestId !== discoverRequestId) return; // hay un intento más reciente

  const shows = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failures = results.filter((r) => r.status === 'rejected');
  failures.forEach((r) => console.error('[Inicio] Error al cargar una serie de la selección:', r.reason));

  grid.removeAttribute('aria-busy');

  if (shows.length === 0) {
    grid.hidden = true;
    grid.replaceChildren();
    fillErrorMessage(status.querySelector('[data-status="error"]'), failures[0]?.reason);
    showStatus(status, 'error');
    return;
  }

  grid.replaceChildren(...shows.map(createSeriesCard));
}

document.querySelector('[data-discover-status] [data-retry]')?.addEventListener('click', loadDiscover);

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

loadHero();
loadDiscover();
loadSchedule();
