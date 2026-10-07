import { useEffect, useState } from 'react';
import { Check, Library, Plus, X } from 'lucide-react';
import { useCollectionActions, useCollections, useItemCollections } from '../lib/collections.js';
import { useToast } from './Toast.jsx';
import { Dialog } from './Dialog.jsx';
import { Button, Field, IconButton, MetaLabel, TextInput, cx } from './ui.jsx';

export function CollectionNameDialog({ open, onClose, initial = '', title, action, onSubmit }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setName(initial);
      setError('');
    }
  }, [open, initial]);

  const submit = async (event) => {
    event.preventDefault();
    try {
      await onSubmit(name);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="collection-name" variant="primary" disabled={!name.trim()}>
            {action}
          </Button>
        </>
      }
    >
      <form id="collection-name" onSubmit={submit}>
        <Field label="Nama koleksi" htmlFor="collection-name-input" error={error} hint="Misalnya: Release v2.3, Hotfix Oktober, Bridging SatuSehat.">
          <TextInput id="collection-name-input" autoFocus value={name} maxLength={80} invalid={Boolean(error)} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

// Bagian "Koleksi" di pane detail: chip koleksi + dialog pilih/buat koleksi.
export function ItemCollections({ item }) {
  const toast = useToast();
  const actions = useCollectionActions();
  const all = useCollections();
  const mine = useItemCollections(item.id);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  if (all.isError || mine.isError) return null;
  const memberIds = new Set((mine.data ?? []).map((c) => c.id));

  const toggle = async (collection) => {
    try {
      if (memberIds.has(collection.id)) {
        await actions.detach(collection.id, item.id);
        toast(`Dikeluarkan dari "${collection.name}".`);
      } else {
        await actions.add(collection.id, item.id);
        toast(`Masuk ke "${collection.name}".`);
      }
    } catch (err) {
      toast(err.message, { success: false });
    }
  };

  const createAndAdd = async (event) => {
    event.preventDefault();
    try {
      const created = await actions.create(newName);
      await actions.add(created.id, item.id);
      setNewName('');
      toast(`Koleksi "${created.name}" dibuat.`);
    } catch (err) {
      toast(err.message, { success: false });
    }
  };

  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <MetaLabel className="flex-1" items={['Koleksi']} />
        {!item.deletedAt && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setPicking(true)}>
            Tambah ke koleksi
          </Button>
        )}
      </div>
      {(mine.data ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {mine.data.map((collection) => (
            <span key={collection.id} className="inline-flex h-6 items-center gap-1.5 rounded-xs bg-surface-2 pl-2 pr-0.5 text-xs font-medium">
              <Library size={12} strokeWidth={1.5} className="text-fg-subtle" aria-hidden="true" />
              {collection.name}
              <IconButton icon={X} size={12} label={`Keluarkan dari ${collection.name}`} className="size-5" onClick={() => toggle(collection)} />
            </span>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-fg-subtle">Belum masuk koleksi mana pun.</p>
      )}

      <Dialog open={picking} onClose={() => setPicking(false)} title="Tambah ke koleksi" description="Satu item boleh masuk ke beberapa koleksi." width={440}>
        <div className="max-h-64 overflow-y-auto rounded-sm border border-line">
          {(all.data ?? []).map((collection) => {
            const member = memberIds.has(collection.id);
            return (
              <button
                key={collection.id}
                type="button"
                aria-pressed={member}
                onClick={() => toggle(collection)}
                className={cx('flex h-9 w-full items-center gap-3 border-b border-line px-3 text-left text-[13px] last:border-b-0', member ? 'bg-accent-soft' : 'hover:bg-surface-2')}
              >
                <span className={cx('grid size-4 place-items-center rounded-xs border', member ? 'border-accent bg-accent text-on-accent' : 'border-line-strong')}>
                  {member && <Check size={12} strokeWidth={2} />}
                </span>
                <span className="flex-1 truncate">{collection.name}</span>
                <span className="font-mono text-[11px] text-fg-subtle">{collection.count}</span>
              </button>
            );
          })}
          {all.data?.length === 0 && <p className="m-0 px-3 py-3 text-[13px] text-fg-subtle">Belum ada koleksi. Buat yang pertama di bawah.</p>}
        </div>
        <form className="flex gap-2" onSubmit={createAndAdd}>
          <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Koleksi baru" aria-label="Nama koleksi baru" maxLength={80} />
          <Button type="submit" disabled={!newName.trim()} icon={Plus}>
            Buat
          </Button>
        </form>
      </Dialog>
    </section>
  );
}
