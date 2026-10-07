import { parseSearch } from './search-query.js';

export const VIEWS = {
  all: 'Semua',
  pinned: 'Disematkan',
  archived: 'Arsip',
  trash: 'Trash',
};

// State daftar disimpan di query string supaya tetap ada saat pindah item, refresh, atau back.
export function readListState(search) {
  return {
    q: search.get('q') ?? '',
    view: VIEWS[search.get('view')] ? search.get('view') : 'all',
    type: search.get('type') ?? '',
    tag: search.get('tag') ?? '',
    collection: search.get('collection') ?? '',
  };
}

export function listStateToSearch(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.view && state.view !== 'all') params.set('view', state.view);
  if (state.type) params.set('type', state.type);
  if (state.tag) params.set('tag', state.tag);
  if (state.collection) params.set('collection', state.collection);
  const text = params.toString();
  return text ? `?${text}` : '';
}

// Gabungkan filter sidebar dengan operator yang diketik; operator di kotak search menang.
export function effectiveFilters(state) {
  const parsed = parseSearch(state.q);
  return {
    ...parsed,
    type: parsed.type ?? (state.type || undefined),
    tag: parsed.tag ?? (state.tag || undefined),
    archived: parsed.archived || state.view === 'archived',
    trashed: parsed.trashed || state.view === 'trash',
    pinned: parsed.pinned || state.view === 'pinned',
    collection: state.collection || undefined,
  };
}
