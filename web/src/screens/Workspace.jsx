import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, Plus, Search, X } from 'lucide-react';
import { navigate, useDocumentTitle, useLocation } from '../lib/router.js';
import { useItems } from '../lib/queries.js';
import { toItemsQuery } from '../lib/search-query.js';
import { effectiveFilters, listStateToSearch, readListState } from '../lib/workspace-url.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { easeSheet } from '../lib/motion.js';
import { useCollections } from '../lib/collections.js';
import { useMedia } from '../lib/useMedia.js';
import { Button, EmptyState, IconButton, Kbd, MetaLabel, SkeletonRows, cx } from '../components/ui.jsx';
import { ItemRow } from '../components/ItemRow.jsx';
import { VaultStatus } from '../components/VaultStatus.jsx';
import { Sidebar } from './Sidebar.jsx';
import { ItemDetail } from './ItemDetail.jsx';
import { ItemForm } from './ItemForm.jsx';
import { VersionHistory } from './VersionHistory.jsx';

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

function ListPane({ state, items, isPending, isFetching, selectedId, onSelect, filters }) {
  const listRef = useRef(null);
  const searching = Boolean(filters.text);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const meta = [
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
            <Button shortcut="N" onClick={() => navigate('/items/new')}>Item baru</Button>
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
          <ItemRow key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <MetaLabel items={meta} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
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
  if (route.mode === 'new') detail = <ItemForm key="new" onDone={(item) => (item ? select(item.id) : closeDetail())} />;
  else if (selectedId != null && route.mode === 'edit') detail = <ItemForm key={`edit-${selectedId}`} itemId={selectedId} onDone={() => select(selectedId)} />;
  else if (selectedId != null && route.mode === 'history') detail = <VersionHistory key={`history-${selectedId}`} itemId={selectedId} onClose={() => select(selectedId)} />;
  else if (selectedId != null) detail = <ItemDetail key={selectedId} itemId={selectedId} suffix={suffix} onClose={closeDetail} />;

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
        <ListPane state={state} filters={filters} items={list} isPending={items.isPending} isFetching={items.isFetching} selectedId={selectedId} onSelect={select} />
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
