import { useRef, useState } from 'react';
import { ArrowLeft, Bookmark, File, Folder, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate, useDocumentTitle } from '../lib/router.js';
import { chunkFiles, detectImportKind, folderTags } from '../lib/import-plan.js';
import { formatBytes } from '../lib/format.js';
import { useRefresh } from '../lib/queries.js';
import { useToast } from '../components/Toast.jsx';
import { TagInput } from '../components/TagInput.jsx';
import { Button, Field, MetaLabel, cx } from '../components/ui.jsx';
import { TopBar } from './Workspace.jsx';

const STATUS_CLASS = { created: 'text-success', skipped: 'text-fg-subtle', failed: 'text-danger' };
const STATUS_LABEL = { created: 'Dibuat', skipped: 'Duplikat', failed: 'Gagal' };

// Ambil semua file dari folder yang diseret (DataTransferItem.webkitGetAsEntry), lengkap dengan path relatif.
async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map((file) => ({ file, path: file.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.name.startsWith('.')) return;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, path: `${prefix}${entry.name}` });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}

export function ImportScreen() {
  useDocumentTitle('Impor');
  const refresh = useRefresh();
  const toast = useToast();
  const [tags, setTags] = useState([]);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [bookmarkResult, setBookmarkResult] = useState(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const bookmarkInput = useRef(null);

  const run = async (entries) => {
    const usable = entries.filter(({ path }) => !path.split('/').some((part) => part.startsWith('.') || part === 'node_modules'));
    if (!usable.length) return;
    setResults([]);
    setProgress({ done: 0, total: usable.length });
    const collected = [];
    // Kelompokkan per set tag (dari subfolder) supaya tiap request punya tag yang sama.
    const groups = new Map();
    for (const entry of usable) {
      const key = [...tags, ...folderTags(entry.path.includes('/') ? entry.path : `root/${entry.path}`)].join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    let done = 0;
    for (const [tagKey, group] of groups) {
      const pathOf = new Map(group.map((entry) => [entry.file, entry.path]));
      for (const chunk of chunkFiles(group.map((entry) => entry.file))) {
        const form = new FormData();
        for (const file of chunk) form.append('files', file, file.name);
        if (tagKey) form.append('tags', tagKey);
        try {
          const summary = await api('/import/files', { method: 'POST', form });
          // API memproses file berurutan, jadi hasil ke-i milik file ke-i.
          summary.results.forEach((result, i) => {
            const file = chunk[i];
            const note = result.status === 'failed' ? result.error : `${detectImportKind(file.name, file.size)} · ${formatBytes(file.size)}`;
            collected.push({ path: pathOf.get(file), status: result.status, note, itemId: result.itemId });
          });
        } catch (err) {
          for (const file of chunk) collected.push({ path: pathOf.get(file), status: 'failed', note: err.message });
        }
        done += chunk.length;
        setProgress({ done, total: usable.length });
        setResults([...collected]);
      }
    }
    const totals = { created: 0, skipped: 0, failed: 0 };
    for (const row of collected) totals[row.status]++;
    refresh();
    toast(`${usable.length} file diproses: ${totals.created} dibuat, ${totals.skipped} duplikat, ${totals.failed} gagal.`, {
      action: tags.length ? { label: 'Lihat hasil', onClick: () => navigate(`/?tag=${encodeURIComponent(tags[0])}`) } : undefined,
      duration: 8000,
    });
    setProgress((current) => ({ ...current, finished: true, totals }));
  };

  const fromInput = (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    run(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  };

  const importBookmarks = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    if (tags.length) form.append('tags', tags.join(','));
    try {
      const result = await api('/import/bookmarks', { method: 'POST', form });
      setBookmarkResult(result);
      refresh();
      toast(`Bookmark: ${result.created} link dibuat, ${result.skipped} dilewati.`);
    } catch (err) {
      toast(err.message, { success: false });
    }
  };

  const rows = results;
  const percent = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="grid h-full grid-rows-[48px_minmax(0,1fr)] bg-canvas">
      <TopBar />
      <main className="overflow-y-auto">
        <div className="mx-auto grid max-w-[760px] gap-6 px-6 py-6 max-[560px]:px-4">
          <div className="grid gap-1">
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/')} className="-ml-2 w-fit">
              Kembali ke daftar
            </Button>
            <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">Impor</h1>
            <p className="m-0 text-[13px] text-fg-muted">Masukkan banyak file sekaligus. File yang isinya sama dan link yang sudah ada dilewati, jadi impor boleh diulang.</p>
          </div>

          <Field label="Tag untuk semua file" hint="Opsional. Nama subfolder ikut jadi tag.">
            <TagInput value={tags} onChange={setTags} />
          </Field>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={async (event) => {
              event.preventDefault();
              setOver(false);
              run(await filesFromDrop(event.dataTransfer));
            }}
            className={cx(
              'grid justify-items-center gap-2 rounded-sm border px-6 py-8 text-center transition-colors duration-[120ms]',
              over ? 'border-solid border-focus bg-accent-soft text-fg' : 'border-dashed border-line-strong bg-surface text-fg-muted',
            )}
          >
            <Upload size={20} strokeWidth={1.5} aria-hidden="true" />
            <p className="m-0 text-sm font-semibold text-fg">Tarik file atau folder ke sini</p>
            <p className="m-0 max-w-[52ch] text-xs text-fg-subtle">.sql jadi Query, .md dan .txt jadi Catatan, sisanya jadi File. Isi PDF, Word, dan Excel ikut bisa dicari.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" icon={File} onClick={() => fileInput.current.click()}>
                Pilih file
              </Button>
              <Button size="sm" icon={Folder} onClick={() => folderInput.current.click()}>
                Pilih folder
              </Button>
            </div>
            <input ref={fileInput} type="file" multiple hidden onChange={fromInput} />
            <input ref={folderInput} type="file" multiple hidden webkitdirectory="" directory="" onChange={fromInput} />
          </div>

          {progress && (
            <div className="grid gap-1">
              <MetaLabel items={[progress.finished ? 'Selesai' : `${progress.done} dari ${progress.total} file`, `${percent}%`, progress.totals && `${progress.totals.created} dibuat`, progress.totals && `${progress.totals.skipped} duplikat`]} />
              <div className="h-1 overflow-hidden rounded-xs bg-surface-2" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <span className="block h-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="max-h-80 overflow-y-auto border-t border-line bg-surface">
              {rows.map((row, index) => (
                <div key={`${row.path}-${index}`} className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3 py-1.5 text-[13px]">
                  <span className={cx('font-mono text-[11px] font-medium uppercase tracking-[0.06em]', STATUS_CLASS[row.status])}>{STATUS_LABEL[row.status]}</span>
                  {row.itemId ? (
                    <button type="button" onClick={() => navigate(`/items/${row.itemId}`)} className="truncate text-left font-mono text-xs hover:text-accent-text">
                      {row.path}
                    </button>
                  ) : (
                    <span className="truncate font-mono text-xs">{row.path}</span>
                  )}
                  <span className="whitespace-nowrap text-xs text-fg-subtle">{row.note}</span>
                </div>
              ))}
            </div>
          )}

          <section className="grid gap-2 border-t border-line pt-4">
            <MetaLabel items={['Bookmark browser']} />
            <p className="m-0 text-[13px] text-fg-muted">Chrome atau Edge: buka chrome://bookmarks, menu titik tiga, Export bookmarks. Folder bookmark jadi tag, link yang sudah ada dilewati.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" icon={Bookmark} onClick={() => bookmarkInput.current.click()}>
                Pilih bookmarks.html
              </Button>
              {bookmarkResult && <MetaLabel items={[`${bookmarkResult.created} link dibuat`, `${bookmarkResult.skipped} dilewati`]} />}
            </div>
            <input ref={bookmarkInput} type="file" accept=".html,.htm,text/html" hidden onChange={importBookmarks} />
          </section>
        </div>
      </main>
    </div>
  );
}
