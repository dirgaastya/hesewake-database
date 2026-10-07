import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, Link2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { formatBytes } from '../lib/format.js';
import { TYPE_META } from '../lib/types.js';
import { setPendingDraft } from '../lib/draft.js';
import { detectImportKind } from '../lib/import-plan.js';
import { spring, exit } from '../lib/motion.js';
import { useRefresh } from '../lib/queries.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { TagInput } from '../components/TagInput.jsx';
import { Button, MetaLabel, TextInput } from '../components/ui.jsx';

const LINES_PREVIEW = 4;

// capture: { text, guess, secretLike } atau { files }
export function QuickCapture({ capture, onClose }) {
  const refresh = useRefresh();
  const toast = useToast();
  const vault = useVault();
  const requestUnlock = useRequestUnlock();
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef(null);
  const guess = capture?.guess;

  useEffect(() => {
    setTitle(guess?.title ?? '');
    setTags([]);
    setPreview(null);
    setError('');
    setBusy(false);
    if (guess?.type === 'link') {
      api(`/link-preview?url=${encodeURIComponent(guess.metadata.url)}`)
        .then((result) => {
          setPreview(result);
          setTitle((current) => current || result.title);
        })
        .catch(() => {});
    }
  }, [capture, guess]);

  const saveItem = async (override) => {
    const body = override ?? {
      type: guess.type,
      title: title.trim() || preview?.title || guess.title,
      content: guess.content,
      metadata: guess.type === 'link' && preview ? { ...guess.metadata, description: preview.description, image: preview.image } : guess.metadata,
      tags,
    };
    if (!body.title) {
      setError('Isi judul dulu.');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const item = await api('/items', { method: 'POST', body });
      refresh(item.id);
      toast(`${TYPE_META[item.type].label} disimpan.`);
      onClose();
      navigate(`/items/${item.id}${window.location.search}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const saveSecret = async () => {
    if (!title.trim()) {
      setError('Isi judul dulu, misalnya "Password DB staging".');
      titleRef.current?.focus();
      return;
    }
    if (!vault.unlocked && !(await requestUnlock())) return;
    await saveItem({ type: 'secret', title: title.trim(), content: await vault.encrypt(capture.text.trim()), metadata: {}, tags });
  };

  const importFiles = async () => {
    setBusy(true);
    const form = new FormData();
    for (const file of capture.files) form.append('files', file);
    if (tags.length) form.append('tags', tags.join(','));
    try {
      const summary = await api('/import/files', { method: 'POST', form });
      refresh();
      toast(`${capture.files.length} file diproses: ${summary.created} dibuat, ${summary.skipped} duplikat, ${summary.failed.length} gagal.`);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const otherType = () => {
    setPendingDraft({ ...guess, title: title || guess.title, tags });
    onClose();
    navigate('/items/new');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    if (event.key === 'Enter' && !event.shiftKey && event.target.tagName !== 'TEXTAREA' && !event.target.closest('[aria-label="Tambah tag"]')) {
      event.preventDefault();
      if (capture.files) importFiles();
      else if (capture.secretLike) saveSecret();
      else saveItem();
    }
  };

  let body = null;
  if (capture?.files) {
    const total = capture.files.reduce((sum, file) => sum + file.size, 0);
    body = (
      <>
        <MetaLabel items={[`${capture.files.length} file diseret`, formatBytes(total)]} />
        <div className="max-h-48 overflow-y-auto border-t border-line">
          {capture.files.map((file) => (
            <div key={`${file.name}-${file.size}`} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-1.5 text-[13px]">
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-fg-subtle">{detectImportKind(file.name, file.size)}</span>
              <span className="truncate font-mono text-xs">{file.name}</span>
              <span className="text-xs text-fg-subtle">{formatBytes(file.size)}</span>
            </div>
          ))}
        </div>
        <TagInput value={tags} onChange={setTags} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" shortcut="↵" disabled={busy} onClick={importFiles}>
            {busy ? 'Mengimpor…' : `Impor ${capture.files.length} file`}
          </Button>
          <Button variant="ghost" size="sm" shortcut="Esc" onClick={onClose}>
            Batal
          </Button>
        </div>
      </>
    );
  } else if (capture?.secretLike) {
    body = (
      <>
        <MetaLabel items={['Dari clipboard', 'Mirip password']} />
        <p className="m-0 text-[13px] leading-5 text-fg-muted">Teks ini terlihat seperti password atau token. Simpan sebagai secret supaya dienkripsi di browser.</p>
        <TextInput ref={titleRef} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul secret, misalnya Password DB staging" aria-label="Judul" />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" icon={KeyRound} shortcut="↵" disabled={busy} onClick={saveSecret}>
            Simpan sebagai secret
          </Button>
          <Button size="sm" onClick={() => saveItem({ type: 'note', title: title.trim() || 'Catatan', content: capture.text, metadata: {}, tags })}>
            Simpan sebagai catatan
          </Button>
          <Button variant="ghost" size="sm" shortcut="Esc" onClick={onClose}>
            Batal
          </Button>
        </div>
      </>
    );
  } else if (guess) {
    const meta = TYPE_META[guess.type];
    const lines = (guess.content || guess.metadata.error_message || '').split('\n');
    body = (
      <>
        <MetaLabel items={['Dari clipboard', meta.label, lines.length > 1 ? `${lines.length} baris` : null]} />
        {guess.type === 'link' ? (
          <div className="flex min-w-0 items-center gap-3">
            {preview?.image ? (
              <img src={preview.image} alt="" className="size-12 shrink-0 rounded-xs bg-surface-2 object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="grid size-12 shrink-0 place-items-center rounded-xs bg-surface-2 text-fg-subtle">
                <Link2 size={20} strokeWidth={1.5} />
              </span>
            )}
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-semibold">{preview?.title ?? 'Memuat judul…'}</span>
              <span className="truncate text-xs text-fg-subtle">{guess.metadata.url}</span>
            </span>
          </div>
        ) : (
          <pre className="m-0 overflow-hidden whitespace-pre rounded-sm bg-surface-2 px-3 py-2 font-mono text-xs leading-[18px]">{lines.slice(0, LINES_PREVIEW).join('\n')}{lines.length > LINES_PREVIEW ? '\n…' : ''}</pre>
        )}
        <TextInput ref={titleRef} autoFocus value={title} onChange={(e) => { setTitle(e.target.value); setError(''); }} placeholder={`Judul ${meta.label.toLowerCase()}`} aria-label="Judul" invalid={Boolean(error)} />
        <TagInput value={tags} onChange={setTags} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" shortcut="↵" disabled={busy} onClick={() => saveItem()}>
            {busy ? 'Menyimpan…' : `Simpan ${meta.label.toLowerCase()}`}
          </Button>
          <Button size="sm" onClick={otherType}>
            Tipe lain
          </Button>
          <Button variant="ghost" size="sm" shortcut="Esc" onClick={onClose}>
            Batal
          </Button>
        </div>
      </>
    );
  }

  return createPortal(
    <AnimatePresence>
      {capture && (
        <div className="fixed inset-x-0 top-14 z-40 grid justify-items-center px-4" onKeyDown={onKeyDown}>
          <motion.div
            role="dialog"
            aria-label="Simpan dari clipboard"
            className="grid w-full max-w-[480px] gap-3 rounded-md bg-surface p-3 shadow-float"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring.snappy }}
            exit={{ opacity: 0, transition: exit }}
          >
            {body}
            {error && <p className="m-0 text-xs text-danger">{error}</p>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
