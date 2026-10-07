import { useEffect, useSyncExternalStore } from 'react';

const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to, { replace = false } = {}) {
  if (to === snapshot()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  emit();
}

export function useLocation() {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const url = new URL(value, window.location.origin);
  return { pathname: url.pathname, search: url.searchParams };
}

// Rute: "/" daftar, "/items/:id" daftar + detail, "/import", "/settings".
export function matchRoute(pathname) {
  const item = pathname.match(/^\/items\/(\d+)(?:\/(edit|history))?$/);
  if (item) return { screen: 'workspace', itemId: Number(item[1]), mode: item[2] ?? 'view' };
  if (pathname === '/items/new') return { screen: 'workspace', itemId: null, mode: 'new' };
  if (pathname === '/import') return { screen: 'import' };
  if (pathname === '/settings') return { screen: 'settings' };
  return { screen: 'workspace', itemId: null, mode: 'view' };
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Hesewake` : 'Hesewake';
  }, [title]);
}
