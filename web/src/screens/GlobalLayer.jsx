import { useEffect, useState } from 'react';
import { guessCapture, looksLikeSecret } from '../lib/capture.js';
import { isTyping, useShortcuts } from '../lib/shortcuts.js';
import { CommandPalette } from './CommandPalette.jsx';
import { QuickCapture } from './QuickCapture.jsx';

// Lapisan yang aktif di semua layar: command palette, tempel cepat, dan seret file.
export function GlobalLayer() {
  const [palette, setPalette] = useState(null);
  const [capture, setCapture] = useState(null);
  const [dragging, setDragging] = useState(false);

  useShortcuts({
    'mod+k': () => setPalette((current) => (current === 'items' ? null : 'items')),
    'mod+shift+p': () => setPalette((current) => (current === 'commands' ? null : 'commands')),
  });

  useEffect(() => {
    const blocked = (target) => isTyping(target) || document.querySelector('[aria-modal="true"], [aria-label="Simpan dari clipboard"]');

    const onPaste = (event) => {
      if (blocked(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        setCapture({ files });
        return;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      setCapture(looksLikeSecret(text) ? { text, secretLike: true } : { text, guess: guessCapture(text) });
    };

    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
    const onDragOver = (event) => {
      if (!hasFiles(event) || window.location.pathname === '/import') return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event) => {
      setDragging(false);
      if (!hasFiles(event) || window.location.pathname === '/import') return;
      event.preventDefault();
      const files = [...event.dataTransfer.files];
      if (files.length) setCapture({ files });
    };

    document.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <>
      <CommandPalette open={palette !== null} mode={palette} onClose={() => setPalette(null)} />
      <QuickCapture capture={capture} onClose={() => setCapture(null)} />
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-30 grid place-items-center rounded-md border border-dashed border-focus bg-accent-soft">
          <p className="m-0 text-sm font-semibold">Lepaskan untuk mengimpor file</p>
        </div>
      )}
    </>
  );
}
