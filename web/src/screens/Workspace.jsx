import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Library, Menu, Plus, Search, Trash2, X } from 'lucide-react';
import { navigate, useDocumentTitle, useLocation } from '../lib/router.js';
import { useItems } from '../lib/queries.js';
import { api } from '../lib/api.js';
import { toItemsQuery } from '../lib/search-query.js';
import { effectiveFilters, listStateToSearch, readListState } from '../lib/workspace-url.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { easeSheet } from '../lib/motion.js';
import { useCollectionActions, useCollections } from '../lib/collections.js';
import { useToast } from '../components/Toast.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { CollectionNameDialog } from '../components/CollectionDialogs.jsx';
import { useMedia } from '../lib/useMedia.js';
import { Button, EmptyState, IconButton, Kbd, MetaLabel, SkeletonRows, cx } from '../components/ui.jsx';
import { ItemRow } from '../components/ItemRow.jsx';
import { VaultStatus } from '../components/VaultStatus.jsx';
import { Sidebar } from './Sidebar.jsx';
import { ItemDetail } from './ItemDetail.jsx';
import { ItemForm } from './ItemForm.jsx';
import { VersionHistory } from './VersionHistory.jsx';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';

const LIMIT = 100;

export function TopBar({ onMenu, search, onSearch, searchRef }) {
  return (
    <header className="col-span-full flex h-12 items-center gap-3 border-b border-line bg-surface px-3">
      {onMenu && <IconButton icon={Menu} label="Menu" onClick={onMenu} className="min-[761px]:hidden" />}
      <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="w-[196px] shrink-0 font-mono text-[13px] font-semibold tracking-[0.02em] text-fg no-underline max-[760px]:w-auto">
        hesewake<span className="font-medium text-fg-subtle">/db</span>
      </a>
      {onSearch && (
        <label className="flex h-8 min-w-0 max-w-[520px] flex-1 items-center gap-2 rounded-sm border border-line bg-surface pl-3 pr-2 text-fg-subtle hover:border-line-strong focus-within:border-focus focus-within:ring-1 focus-within:ring-focus">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (onSearch(''), e.currentTarget.blur())}
            placeholder="Cari… type:query tag:simrs"
            aria-label="Cari item"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
          />
          {search ? <IconButton icon={X} size={14} label="Hapus pencarian" onClick={() => onSearch('')} /> : <Kbd>/</Kbd>}
        </label>
      )}
      <div className="ml-auto flex items-center gap-2">
        <VaultStatus compact />
        <Button variant="primary" size="sm" icon={Plus} shortcut="N" onClick={() => navigate(`/items/new${window.location.search}`)} className="max-[600px]:px-2 [&>span]:max-[600px]:hidden">
          <span>Item baru</span>
        </Button>
      </div>
    </header>
  );
}

function CollectionActions({ collection, onDeleted }) {
  const actions = useCollectionActions();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
        Ganti nama
      </Button>
      <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
        Hapus koleksi
      </Button>
      <CollectionNameDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        initial={collection.name}
        title="Ganti nama koleksi"
        action="Simpan"
        onSubmit={async (name) => {
          await actions.rename(collection.id, name);
          toast('Nama koleksi diganti.');
        }}
      />
      <Dialog
        open={deleting}
        role="alertdialog"
        onClose={() => setDeleting(false)}
        title={`Hapus koleksi "${collection.name}"?`}
        description="Hanya koleksinya yang dihapus. Item di dalamnya tetap ada."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              Batal
            </Button>
            <Button
              variant="danger-solid"
              onClick={async () => {
                setDeleting(false);
                await actions.remove(collection.id);
                toast('Koleksi dihapus.');
                onDeleted();
              }}
            >
              Hapus koleksi
            </Button>
          </>
        }
      />
    </div>
  );
}

function ListPane({ state, items, isPending, isFetching, selectedId, onSelect, filters, collection, onCollectionDeleted }) {
  const listRef = useRef(null);
  const toast = useToast();
  const collectionActions = useCollectionActions();
  const collections = useCollections();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pickingCollection, setPickingCollection] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const searching = Boolean(filters.text);
  const isTrash = state.view === 'trash';
  const selectedCount = selectedIds.size;

  useEffect(() => setSelectedIds(new Set()), [state.view, state.type, state.tag, state.collection, state.q]);

  const toggleItem = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelectedIds((current) => (current.size === items.length ? new Set() : new Set(items.map((item) => item.id))));
  const addToCollection = async (collectionId, name) => {
    setBusy(true);
    try {
      await collectionActions.addMany(collectionId, [...selectedIds]);
      toast(`${selectedCount} item ditambahkan ke "${name}".`);
      setPickingCollection(false);
      setSelectedIds(new Set());
    } catch (err) {
      toast(err.message, { success: false });
    } finally {
      setBusy(false);
    }
  };
  const deleteSelected = async () => {
    setBusy(true);
    try {
      await api(isTrash ? '/items/batch/purge' : '/items/batch/trash', { method: 'POST', body: { itemIds: [...selectedIds] } });
      toast(isTrash ? `${selectedCount} item dihapus permanen.` : `${selectedCount} item dipindahkan ke trash.`);
      setConfirmTrash(false);
      setSelectedIds(new Set());
    } catch (err) {
      toast(err.message, { success: false });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const meta = [
    collection?.name,
    isPending ? 'Memuat' : `${items.length}${items.length === LIMIT ? '+' : ''} item`,
    searching ? 'Urut: relevansi' : 'Urut: terakhir diubah',
    isFetching && !isPending ? 'Memperbarui' : null,
  ];

  let body;
  if (isPending) body = <SkeletonRows />;
  else if (!items.length) {
    body = searching ? (
      <EmptyState meta={['0 hasil']} title={`Tidak ada yang cocok dengan "${filters.text}"`}>
        Coba kata yang lebih pendek, hapus filter, atau cari di arsip dan trash (tambahkan is:arsip atau is:trash).
      </EmptyState>
    ) : state.view === 'trash' ? (
      <EmptyState meta={['Trash']} title="Trash kosong">Item yang dihapus menunggu di sini selama 30 hari sebelum hilang permanen.</EmptyState>
    ) : state.view === 'archived' ? (
      <EmptyState meta={['Arsip']} title="Belum ada yang diarsip">Arsipkan item yang jarang dipakai supaya daftar utama tetap ringkas.</EmptyState>
    ) : (
      <EmptyState
        meta={['0 item']}
        title="Belum ada item"
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/import')}>Impor folder</Button>
            <Button shortcut="N" onClick={() => navigate(`/items/new${listStateToSearch(state)}`)}>Item baru</Button>
          </>
        }
      >
        Tempel URL, query, atau teks di mana saja untuk menyimpannya. Punya banyak dokumen? Impor satu folder sekaligus.
      </EmptyState>
    );
  } else {
    body = (
      <div ref={listRef} role="listbox" aria-label="Daftar item">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} selected={item.id === selectedId} checked={selectedIds.has(item.id)} onCheckedChange={toggleItem} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line pl-3 pr-1">
        <MetaLabel items={meta} />
        {selectedCount > 0 ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-[11px] text-fg-subtle">{selectedCount} dipilih</span>
            <Button size="sm" variant="ghost" icon={Library} onClick={() => setPickingCollection(true)}>Ke koleksi</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmTrash(true)}>Hapus</Button>
            <IconButton icon={X} label="Batalkan pilihan" onClick={() => setSelectedIds(new Set())} />
          </div>
        ) : collection ? <CollectionActions collection={collection} onDeleted={onCollectionDeleted} /> : null}
      </div>
      {!isPending && items.length > 0 && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-xs text-fg-subtle">
          <button type="button" role="checkbox" aria-checked={selectedCount === items.length} aria-label="Pilih semua item" onClick={toggleAll} className={cx('grid size-4 place-items-center rounded-xs border', selectedCount === items.length ? 'border-accent bg-accent text-on-accent' : 'border-line-strong hover:border-accent')}>
            {selectedCount === items.length && <Check size={12} strokeWidth={2} aria-hidden="true" />}
          </button>
          Pilih semua {items.length} item
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      <Dialog open={pickingCollection} onClose={() => !busy && setPickingCollection(false)} title="Tambah item ke koleksi" description={`${selectedCount} item akan dimasukkan ke koleksi yang dipilih.`} width={440}>
        <div className="max-h-64 overflow-y-auto rounded-sm border border-line">
          {(collections.data ?? []).map((entry) => (
            <button key={entry.id} type="button" disabled={busy} onClick={() => addToCollection(entry.id, entry.name)} className="flex h-9 w-full items-center gap-3 border-b border-line px-3 text-left text-[13px] last:border-b-0 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45">
              <Library size={14} strokeWidth={1.5} className="text-fg-subtle" aria-hidden="true" />
              <span className="flex-1 truncate">{entry.name}</span><span className="font-mono text-[11px] text-fg-subtle">{entry.count}</span>
            </button>
          ))}
          {collections.data?.length === 0 && <p className="m-0 px-3 py-3 text-[13px] text-fg-subtle">Belum ada koleksi. Buat koleksi terlebih dahulu dari sidebar.</p>}
        </div>
      </Dialog>
      <Dialog
        open={confirmTrash}
        role="alertdialog"
        onClose={() => !busy && setConfirmTrash(false)}
        title={isTrash ? `Hapus permanen ${selectedCount} item?` : `Hapus ${selectedCount} item?`}
        description={isTrash ? 'Item dan file lampirannya akan dihapus permanen dan tidak dapat dipulihkan.' : 'Item akan dipindahkan ke trash dan masih bisa dipulihkan selama 30 hari.'}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmTrash(false)}>Batal</Button>
            <Button variant="danger-solid" disabled={busy} onClick={deleteSelected}>{isTrash ? 'Hapus permanen' : 'Pindahkan ke trash'}</Button>
          </>
        }
      />
    </section>
  );
}

export function Workspace({ route }) {
  const { search } = useLocation();
  const state = readListState(search);
  const filters = effectiveFilters(state);
  const queryString = useMemo(() => {
    const base = toItemsQuery(filters, { limit: LIMIT });
    return filters.collection ? `${base}&collection=${filters.collection}` : base;
  }, [filters]);
  const items = useItems(queryString);
  const collections = useCollections();
  const [menuOpen, setMenuOpen] = useState(false);
  const narrow = useMedia('(max-width: 1100px)');
  const [draft, setDraft] = useState(state.q);
  const searchRef = useRef(null);
  const list = items.data ?? [];
  const selectedId = route.itemId;
  const detailOpen = route.mode === 'new' || selectedId != null;

  useDocumentTitle(state.q ? `Cari "${state.q}"` : null);

  // Ketik → URL diperbarui setelah jeda singkat supaya tidak memukul API tiap huruf.
  useEffect(() => setDraft(state.q), [state.q]);
  useEffect(() => {
    if (draft === state.q) return undefined;
    const timer = setTimeout(() => {
      const next = listStateToSearch({ ...state, q: draft });
      navigate(`${window.location.pathname}${next}`, { replace: true });
    }, 180);
    return () => clearTimeout(timer);
  }, [draft, state]);

  const suffix = listStateToSearch(state);
  const select = (id) => navigate(`/items/${id}${suffix}`);
  const closeDetail = () => navigate(`/${suffix}`);
  const changeState = (next) => {
    setMenuOpen(false);
    navigate(`/${listStateToSearch({ ...next, q: state.q })}`);
  };
  const move = (delta) => {
    if (!list.length) return;
    const index = list.findIndex((item) => item.id === selectedId);
    const next = list[Math.min(list.length - 1, Math.max(0, index === -1 ? 0 : index + delta))];
    select(next.id);
  };

  useShortcuts({
    '/': () => searchRef.current?.focus(),
    n: () => navigate(`/items/new${suffix}`),
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    j: () => move(1),
    k: () => move(-1),
    e: () => selectedId && navigate(`/items/${selectedId}/edit${suffix}`),
    h: () => selectedId && navigate(`/items/${selectedId}/history${suffix}`),
    // Form dan riwayat menangani Esc sendiri (konfirmasi buang perubahan, kembali ke detail).
    Escape: () => route.mode === 'view' && detailOpen && closeDetail(),
  });

  let detail = null;
  if (route.mode === 'new') detail = <ItemForm key="new" initialType={state.type} onDone={(item) => (item ? select(item.id) : closeDetail())} />;
  else if (selectedId != null && route.mode === 'edit') detail = <ItemForm key={`edit-${selectedId}`} itemId={selectedId} onDone={() => select(selectedId)} />;
  else if (selectedId != null && route.mode === 'history') detail = <VersionHistory key={`history-${selectedId}`} itemId={selectedId} onClose={() => select(selectedId)} />;
  else if (selectedId != null) detail = <ItemDetail key={selectedId} itemId={selectedId} suffix={suffix} onClose={closeDetail} />;
  if (detail) detail = <ErrorBoundary resetKey={`${selectedId}-${route.mode}`}>{detail}</ErrorBoundary>;

  return (
    <div className="grid h-full grid-rows-[48px_minmax(0,1fr)] bg-canvas">
      <TopBar onMenu={() => setMenuOpen((open) => !open)} search={draft} onSearch={setDraft} searchRef={searchRef} />
      <div className="relative grid min-h-0 grid-cols-[220px_minmax(0,1fr)_minmax(420px,44%)] max-[1100px]:grid-cols-[220px_minmax(0,1fr)] max-[760px]:grid-cols-[minmax(0,1fr)]">
        <div
          className={cx(
            'min-h-0 border-r border-line max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:left-0 max-[760px]:z-30 max-[760px]:w-[260px] max-[760px]:shadow-float',
            menuOpen ? '' : 'max-[760px]:hidden',
          )}
        >
          <Sidebar state={state} onChange={changeState} onNavigate={(to) => navigate(to)} collections={collections.data ?? []} />
        </div>
        <ListPane
          state={state}
          filters={filters}
          items={list}
          isPending={items.isPending}
          isFetching={items.isFetching}
          selectedId={selectedId}
          onSelect={select}
          collection={(collections.data ?? []).find((c) => String(c.id) === state.collection)}
          onCollectionDeleted={() => changeState({ ...state, collection: '' })}
        />
        {!narrow && (
          <div className="min-h-0 overflow-hidden bg-canvas">
            {detail ?? (
              <EmptyState meta={['Detail']} title="Pilih item">
                Pilih item di daftar, atau tekan ↑ ↓ untuk berpindah. Tekan N untuk membuat item baru.
              </EmptyState>
            )}
          </div>
        )}
        <AnimatePresence>
          {narrow && detail && (
            <motion.div
              key="detail-sheet"
              className="absolute inset-y-0 right-0 z-20 w-full max-w-[640px] overflow-hidden border-l border-line bg-canvas shadow-float"
              initial={{ x: '100%' }}
              animate={{ x: 0, transition: { duration: 0.32, ease: easeSheet } }}
              exit={{ x: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            >
              {detail}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
