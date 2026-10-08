import { useEffect, useState } from 'react';
import { AppWindow, Maximize2, Minimize2, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const inTauri = () => '__TAURI_INTERNALS__' in window;

export function DesktopTitlebar() {
  const [maximized, setMaximized] = useState(true);
  useEffect(() => {
    if (!inTauri()) return undefined;
    document.getElementById('root')?.classList.add('hdb-desktop');
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => appWindow.isMaximized().then(setMaximized));
    return () => {
      document.getElementById('root')?.classList.remove('hdb-desktop');
      unlisten.then((dispose) => dispose());
    };
  }, []);
  if (!inTauri()) return null;
  const appWindow = getCurrentWindow();
  const stopTitlebarDrag = (event) => event.stopPropagation();
  return (
    <header className="flex h-8 shrink-0 select-none items-center border-b border-line bg-surface pl-3">
      <div data-tauri-drag-region className="flex h-full flex-1 items-center gap-2 overflow-hidden">
        <AppWindow size={13} className="text-accent" aria-hidden="true" />
        <span className="truncate text-xs font-medium text-fg-muted">Hesewake Database</span>
      </div>
      <div className="relative z-10 flex h-full shrink-0">
        <button type="button" aria-label="Minimalkan" title="Minimalkan" onPointerDown={stopTitlebarDrag} onClick={() => appWindow.minimize()} className="grid w-11 place-items-center text-fg-muted hover:bg-surface-2 hover:text-fg"><Minimize2 size={15} /></button>
        <button type="button" aria-label={maximized ? 'Pulihkan ukuran jendela' : 'Maksimalkan'} title={maximized ? 'Pulihkan ukuran jendela' : 'Maksimalkan'} onPointerDown={stopTitlebarDrag} onClick={() => appWindow.toggleMaximize()} className="grid w-11 place-items-center text-fg-muted hover:bg-surface-2 hover:text-fg">{maximized ? <Square size={13} /> : <Maximize2 size={15} />}</button>
        <button type="button" aria-label="Tutup" title="Tutup" onPointerDown={stopTitlebarDrag} onClick={() => appWindow.close()} className="grid w-11 place-items-center text-fg-muted hover:bg-danger hover:text-white"><X size={16} /></button>
      </div>
    </header>
  );
}
