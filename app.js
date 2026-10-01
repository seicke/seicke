// Bookmarks are stored in bookmarks.json next to this page; edit that file to add or change them.
const CONFIG = {
  owner: 'seicke',
  repo: 'seicke',
  branch: 'pages',
  path: 'bookmarks.json',
};

const COLLAPSED_KEY = 'bookmarks.collapsedGroups';

const state = {
  bookmarks: [],
  query: '',
  tag: null,
  grouped: false,
  collapsed: new Set(readCollapsed()),
};

const $ = (sel) => document.querySelector(sel);
const els = {
  list: $('#list'),
  empty: $('#empty'),
  status: $('#status'),
  search: $('#search'),
  tags: $('#tags'),
  count: $('#count'),
  editLink: $('#edit-link'),
  groupToggle: $('#group-toggle'),
};

// --- Collapsed groups (remembered per browser) ----------------------------

function readCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || [];
  } catch {
    return [];
  }
}

function writeCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...state.collapsed]));
  } catch {}
}

// --- Loading -------------------------------------------------------------

function normalize(data) {
  const list = Array.isArray(data) ? data : data?.bookmarks;
  if (!Array.isArray(list)) throw new Error(`${CONFIG.path} has an unexpected format`);
  return list
    .map((b) => ({
      url: String(b.url || '').trim(),
      title: String(b.title || b.url || ''),
      description: String(b.description || ''),
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
    }))
    .filter((b) => safeHref(b.url)); // skip entries without a usable http(s) URL
}

async function loadBookmarks() {
  const res = await fetch(`${CONFIG.path}?t=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Could not load ${CONFIG.path} (${res.status})`);
  return normalize(await res.json());
}

// --- Rendering -----------------------------------------------------------

function safeHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function matches(b) {
  if (state.tag && !b.tags.includes(state.tag)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return [b.title, b.url, b.description, ...b.tags].join(' ').toLowerCase().includes(q);
}

function renderItem(b) {
  const href = safeHref(b.url);
  const host = hostOf(b.url);
  const title = href
    ? el('a', { className: 'title', href, textContent: b.title, target: '_blank', rel: 'noopener noreferrer' })
    : el('span', { className: 'title', textContent: b.title });

  const tags = b.tags.length
    ? el('div', { className: 'item-tags' }, ...b.tags.map((t) => tagButton(t, `#${t}`)))
    : null;

  return el(
    'li',
    { className: 'item' },
    el(
      'div',
      { className: 'item-body' },
      el('div', { className: 'item-head' }, title, el('span', { className: 'host', textContent: host })),
      b.description ? el('p', { className: 'desc', textContent: b.description }) : null,
      tags,
    ),
  );
}

function tagButton(tag, label = tag) {
  return el('button', {
    type: 'button',
    className: 'tag' + (state.tag === tag ? ' active' : ''),
    textContent: label,
    onclick: () => setTag(state.tag === tag ? null : tag),
  });
}

function renderTags() {
  const counts = new Map();
  for (const b of state.bookmarks) for (const t of b.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const sorted = [...counts.keys()].sort((a, b) => a.localeCompare(b));

  els.tags.replaceChildren(
    ...(sorted.length
      ? [
          el('button', { type: 'button', className: 'tag' + (state.tag ? '' : ' active'), textContent: 'All', onclick: () => setTag(null) }),
          ...sorted.map((t) => tagButton(t, `${t} ${counts.get(t)}`)),
        ]
      : []),
  );
}

// A bookmark appears under each of its tags; with a tag filter active, only that group is shown.
function groupByTag(items) {
  const groups = new Map();
  for (const b of items) {
    const tags = state.tag ? [state.tag] : b.tags.length ? b.tags : [null];
    for (const t of tags) {
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(b);
    }
  }
  return [...groups].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
}

// Groups are expanded while searching so no match is hidden; collapsing is remembered otherwise.
function renderGroup(tag, bookmarks, list) {
  const key = tag ?? '';
  const searching = Boolean(state.query.trim());
  const group = el(
    'details',
    { className: 'group', open: searching || !state.collapsed.has(key) },
    el(
      'summary',
      { className: 'group-title' },
      el('h2', { textContent: tag ?? 'Untagged' }),
      el('span', { className: 'group-count', textContent: bookmarks.length }),
    ),
    list,
  );
  group.addEventListener('toggle', () => {
    if (searching) return;
    if (group.open) state.collapsed.delete(key);
    else state.collapsed.add(key);
    writeCollapsed();
  });
  return group;
}

function render() {
  const items = state.bookmarks.filter(matches);
  const listOf = (bookmarks) => el('ul', { className: 'list' }, ...bookmarks.map(renderItem));
  els.list.replaceChildren(
    ...(state.grouped
      ? groupByTag(items).map(([tag, bookmarks]) => renderGroup(tag, bookmarks, listOf(bookmarks)))
      : [listOf(items)]),
  );
  els.empty.hidden = items.length > 0;
  els.count.textContent = `${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'}`;
  renderTags();
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function setTag(tag) {
  state.tag = tag;
  writeHash();
  render();
}

function setGrouped(grouped) {
  state.grouped = grouped;
  writeHash();
  render();
}

// The view is kept in the URL hash (e.g. #tag=web&group=tag) so it can be shared.
function writeHash() {
  const params = new URLSearchParams();
  if (state.tag) params.set('tag', state.tag);
  if (state.grouped) params.set('group', 'tag');
  const hash = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (hash ? `#${hash}` : ''));
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.tag = params.get('tag');
  state.grouped = params.get('group') === 'tag';
  els.groupToggle.checked = state.grouped;
}

// --- Init ----------------------------------------------------------------

function bindEvents() {
  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea')) {
      e.preventDefault();
      els.search.focus();
    }
  });
  els.groupToggle.addEventListener('change', () => setGrouped(els.groupToggle.checked));
  window.addEventListener('hashchange', () => {
    readHash();
    render();
  });
}

async function init() {
  els.editLink.href = `https://github.com/${CONFIG.owner}/${CONFIG.repo}/edit/${CONFIG.branch}/${CONFIG.path}`;
  readHash();
  bindEvents();
  try {
    state.bookmarks = await loadBookmarks();
  } catch (err) {
    setStatus(err.message, true);
  }
  render();
}

init();
