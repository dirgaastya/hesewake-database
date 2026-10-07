import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { padId } from '../lib/format.js';
import { useToast } from './Toast.jsx';
import { Dialog } from './Dialog.jsx';
import { Button, IconButton, MetaLabel, TextInput, TypeStamp } from './ui.jsx';

function LinkPicker({ open, onClose, item, onPick }) {
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['link-picker', q],
    queryFn: () => api(`/items?${new URLSearchParams(q ? { q, limit: '20' } : { limit: '20' })}`),
    enabled: open,
  });
  return (
    <Dialog open={open} onClose={onClose} title="Tautkan item" description="Pilih item yang berhubungan, misalnya query yang dipakai di solusi error ini." width={520}>
      <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul atau isi" aria-label="Cari item untuk ditautkan" />
      <div className="max-h-72 overflow-y-auto rounded-sm border border-line">
        {(results.data ?? [])
          .filter((candidate) => candidate.id !== item.id)
          .map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onPick(candidate)}
              className="flex h-9 w-full items-center gap-3 border-b border-line px-3 text-left text-[13px] last:border-b-0 hover:bg-surface-2"
            >
              <TypeStamp type={candidate.type} />
              <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
              <span className="font-mono text-[11px] text-fg-subtle">{padId(candidate.id)}</span>
            </button>
          ))}
        {results.data?.length === 0 && <p className="m-0 px-3 py-3 text-[13px] text-fg-subtle">Tidak ada yang cocok.</p>}
      </div>
    </Dialog>
  );
}

// Relasi dua arah antar item (GET /api/items/:id/links).
export function RelatedItems({ item, suffix }) {
  const client = useQueryClient();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const links = useQuery({ queryKey: ['links', item.id], queryFn: () => api(`/items/${item.id}/links`), retry: false });
  if (links.isError) return null;

  const refresh = () => client.invalidateQueries({ queryKey: ['links'] });
  const add = async (target) => {
    setPicking(false);
    try {
      await api(`/items/${item.id}/links`, { method: 'POST', body: { targetId: target.id } });
      refresh();
      toast(`Ditautkan ke "${target.title}".`);
    } catch (err) {
      toast(err.message, { success: false });
    }
  };
  const remove = async (target) => {
    await api(`/items/${item.id}/links/${target.id}`, { method: 'DELETE' });
    refresh();
    toast('Tautan dilepas.');
  };

  const list = links.data ?? [];
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <MetaLabel className="flex-1" items={['Terkait', `${list.length}`]} />
        {!item.deletedAt && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setPicking(true)}>
            Tautkan
          </Button>
        )}
      </div>
      {list.length > 0 && (
        <div className="rounded-sm border border-line bg-surface">
          {list.map((related) => (
            <div key={related.id} className="flex h-9 items-center gap-3 border-b border-line pl-3 pr-1 last:border-b-0">
              <TypeStamp type={related.type} />
              <button type="button" onClick={() => navigate(`/items/${related.id}${suffix}`)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent-text">
                {related.title}
              </button>
              <IconButton icon={X} size={14} label="Lepas tautan" onClick={() => remove(related)} />
            </div>
          ))}
        </div>
      )}
      {list.length === 0 && (
        <p className="m-0 flex items-center gap-2 text-[13px] text-fg-subtle">
          <Link2 size={14} strokeWidth={1.5} aria-hidden="true" /> Belum ada item terkait.
        </p>
      )}
      <LinkPicker open={picking} onClose={() => setPicking(false)} item={item} onPick={add} />
    </section>
  );
}
