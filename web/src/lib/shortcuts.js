import { useEffect, useRef } from 'react';

export function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable || Boolean(target.closest?.('.cm-editor'));
}

// bindings: { 'mod+k': fn, 'mod+shift+p': fn, '/': fn, n: fn }. Shortcut tanpa modifier mati saat sedang mengetik.
export function useShortcuts(bindings, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const combo = `${mod ? 'mod+' : ''}${event.shiftKey && (mod || key.length > 1) ? 'shift+' : ''}${key}`;
      const handler = ref.current[combo];
      if (!handler) return;
      if (!mod && (event.altKey || isTyping(event.target))) return;
      if (document.querySelector('[aria-modal="true"]') && !combo.startsWith('mod+')) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
