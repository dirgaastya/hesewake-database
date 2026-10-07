import { useEffect, useMemo, useState } from 'react';
import { History, Lock, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useItem, useRefresh, useVersions } from '../lib/queries.js';
import { diffLines } from '../lib/diff.js';
import { formatDateTime } from '../lib/format.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, EmptyState, IconButton, MetaLabel, SkeletonRows, cx } from '../components/ui.jsx';

function describeChange(version, newer) {
  const changes = [];
  if (version.title !== newer.title) changes.push('judul');
  if (version.content !== newer.content) changes.push('isi');
  if (JSON.stringify(version.metadata) !== JSON.stringify(newer.metadata)) changes.push('detail');
  if (JSON.stringify(version.tags) !== JSON.stringify(newer.tags)) changes.push('tag');
  if (!changes.length) return 'Tanpa perubahan isi';
  const text = changes.join(', ');
  return `${text[0].toUpperCase()}${text.slice(1)} berubah`;
}

function snapshotText(entry) {
  const meta = Object.entries(entry.metadata ?? {}).map(([key, value]) => `${key}: ${value}`);
  return [`# ${entry.title}`, ...meta, entry.tags?.length ? `tag: ${entry.tags.join(', ')}` : null, '', entry.content ?? ''].filter((line) => line !== null).join('\n');
}

// Isi versi yang bisa dibaca. Item biasa langsung dipakai; secret didekripsi dulu di browser.
// Hasil dekripsi disimpan bersama entries sumbernya supaya hasil lama tidak pernah dipakai untuk daftar baru.
function useReadable(entries, encrypted) {
  const { unlocked, decrypt } = useVault();
  const [decrypted, setDecrypted] = useState({ source: null, value: null });
  useEffect(() => {
    if (!encrypted || !unlocked) return undefined;
    let cancelled = false;
    // decrypt stabil (useCallback), jadi effect ini tidak berulang walau status vault diperbarui.
    Promise.all(entries.map(async (entry) => ({ ...entry, content: entry.content ? await decrypt(entry.content).catch(() => '(tidak bisa dibuka)') : '' }))).then((value) => {
      if (!cancelled) setDecrypted({ source: entries, value });
    });
    return () => {
      cancelled = true;
    };
  }, [entries, encrypted, unlocked, decrypt]);
  if (!encrypted) return entries;
  return unlocked && decrypted.source === entries ? decrypted.value : null;
}

export function VersionHistory({ itemId, onClose }) {
  const item = useItem(itemId);
  const versions = useVersions(itemId);
  const refresh = useRefresh();
  const toast = useToast();
  const requestUnlock = useRequestUnlock();
  const [selected, setSelected] = useState(0);
  useShortcuts({ Escape: onClose });

  const entries = useMemo(() => (item.data && versions.data ? [{ ...item.data, id: 'current', createdAt: item.data.updatedAt }, ...versions.data] : []), [item.data, versions.data]);
  const readable = useReadable(entries, item.data?.encrypted);

  if (item.isPending || versions.isPending) return <SkeletonRows count={3} />;
  if (versions.data.length === 0) {
    return (
      <EmptyState meta={['Riwayat']} title="Belum ada versi lama" actions={<Button onClick={onClose}>Kembali</Button>}>
        Versi tersimpan otomatis setiap kali judul, isi, detail, atau tag item ini diedit.
      </EmptyState>
    );
  }

  const index = Math.min(Math.max(selected, 1), entries.length - 1);
  const version = entries[index];

  const restore = async () => {
    try {
      await api(`/items/${itemId}/versions/${version.id}/restore`, { method: 'POST' });
      refresh(itemId);
      toast(`Versi ${formatDateTime(version.createdAt)} dikembalikan.`);
      onClose();
    } catch (err) {
      toast(err.message, { success: false });
    }
  };

  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)] max-[560px]:grid-cols-1">
      <div className="min-h-0 overflow-y-auto border-r border-line bg-surface" role="listbox" aria-label="Versi">
        <div className="flex h-9 items-center justify-between border-b border-line pl-3 pr-1">
          <MetaLabel items={['Riwayat', `${versions.data.length} versi`]} />
          <IconButton icon={X} label="Tutup (Esc)" onClick={onClose} />
        </div>
        {entries.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={i === index}
            disabled={i === 0}
            onClick={() => setSelected(i)}
            className={cx('grid w-full gap-0.5 border-b border-line px-3 py-2 text-left', i === index ? 'bg-accent-soft' : 'hover:bg-surface-2', i === 0 && 'cursor-default')}
          >
            <span className="font-mono text-xs font-medium tabular-nums">{i === 0 ? 'Sekarang' : formatDateTime(entry.createdAt)}</span>
            <span className="text-xs text-fg-muted">{i === 0 ? 'Versi aktif' : describeChange(entry, entries[i - 1])}</span>
          </button>
        ))}
      </div>
      <div className="grid min-w-0 content-start gap-3 overflow-y-auto bg-canvas px-4 py-3">
        <MetaLabel items={[formatDateTime(version.createdAt), 'dibanding sekarang']} />
        {readable ? (
          <pre className="m-0 overflow-x-auto rounded-sm bg-surface-2 py-2 font-mono text-[13px] leading-5">
            {diffLines(snapshotText(readable[index]), snapshotText(readable[0])).map((line, i) => (
              <span
                key={i}
                className={cx(
                  'block whitespace-pre px-3',
                  line.kind === 'add' && 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)]',
                  line.kind === 'del' && 'bg-danger-soft text-fg-muted',
                )}
              >
                <span className={cx(line.kind === 'add' && 'text-success', line.kind === 'del' && 'text-danger')}>{line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}</span>
                {line.text}
              </span>
            ))}
          </pre>
        ) : (
          <div className="flex items-center gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-[13px]">
            <span className="flex-1 text-fg-subtle">Unlock vault untuk melihat perbedaan isi secret.</span>
            <Button size="sm" icon={Lock} onClick={requestUnlock}>
              Unlock vault
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={History} onClick={restore}>
            Kembalikan versi ini
          </Button>
          <span className="text-xs text-fg-subtle">Isi sekarang tetap tersimpan sebagai versi, jadi langkah ini bisa dibatalkan.</span>
        </div>
      </div>
    </div>
  );
}
