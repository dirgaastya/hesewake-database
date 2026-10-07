import { useState } from 'react';
import { motion } from 'motion/react';
import { Archive, FolderInput, Inbox, Pin, Plus, Settings, Trash2, Library } from 'lucide-react';
import { useCollectionActions } from '../lib/collections.js';
import { useToast } from '../components/Toast.jsx';
import { CollectionNameDialog } from '../components/CollectionDialogs.jsx';
import { useTags } from '../lib/queries.js';
import { TYPE_META, TYPE_ORDER } from '../lib/types.js';
import { VIEWS } from '../lib/workspace-url.js';
import { spring } from '../lib/motion.js';
import { TYPE_ICON } from '../components/icons.js';
import { IconButton, MetaLabel, cx } from '../components/ui.jsx';

const VIEW_ICON = { all: Inbox, pinned: Pin, archived: Archive, trash: Trash2 };

function NavItem({ active, icon: Icon, children, count, onClick, hash }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px]',
        active ? 'font-semibold text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {active && <motion.span layoutId="nav-highlight" className="absolute inset-0 rounded-sm bg-accent-soft" transition={spring.snappy} />}
      <span className="relative flex min-w-0 flex-1 items-center gap-2">
        {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />}
        {hash && <span className="font-mono text-fg-subtle">#</span>}
        <span className="truncate">{children}</span>
      </span>
      {count != null && <span className={cx('relative font-mono text-[11px] font-medium tabular-nums', active ? 'text-accent-text' : 'text-fg-subtle')}>{count}</span>}
    </button>
  );
}

export function Sidebar({ state, onChange, onNavigate, collections = [] }) {
  const tags = useTags();
  const actions = useCollectionActions();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const pick = (patch) => onChange({ ...state, view: 'all', type: '', tag: '', collection: '', ...patch });

  return (
    <nav aria-label="Navigasi" className="grid h-full content-start gap-px overflow-y-auto bg-surface p-2">
      {Object.entries(VIEWS).map(([key, label]) => (
        <NavItem key={key} icon={VIEW_ICON[key]} active={!state.type && !state.tag && !state.collection && state.view === key} onClick={() => pick({ view: key })}>
          {label}
        </NavItem>
      ))}

      <div className="flex items-center justify-between pb-1 pl-2 pr-0.5 pt-4">
        <MetaLabel items={['Koleksi']} />
        <IconButton icon={Plus} size={14} label="Koleksi baru" onClick={() => setCreating(true)} />
      </div>
      {collections.length === 0 && <p className="m-0 px-2 text-xs text-fg-subtle">Kelompokkan item lintas tipe, misalnya per rilis.</p>}
      {collections.length > 0 && (
        <>
          {collections.map((collection) => (
            <NavItem
              key={collection.id}
              icon={Library}
              count={collection.count}
              active={state.collection === String(collection.id)}
              onClick={() => pick({ collection: String(collection.id) })}
            >
              {collection.name}
            </NavItem>
          ))}
        </>
      )}

      <MetaLabel className="px-2 pb-1 pt-4" items={['Tipe']} />
      {TYPE_ORDER.map((type) => (
        <NavItem key={type} icon={TYPE_ICON[type]} active={state.type === type} onClick={() => pick({ type })}>
          {TYPE_META[type].label}
        </NavItem>
      ))}

      {tags.data?.length > 0 && (
        <>
          <MetaLabel className="px-2 pb-1 pt-4" items={['Tag']} />
          {tags.data.map((tag) => (
            <NavItem key={tag.name} hash count={tag.count} active={state.tag === tag.name} onClick={() => pick({ tag: tag.name })}>
              {tag.name}
            </NavItem>
          ))}
        </>
      )}

      <div className="mt-4 grid gap-px border-t border-line pt-2">
        <NavItem icon={FolderInput} onClick={() => onNavigate('/import')}>
          Impor
        </NavItem>
        <NavItem icon={Settings} onClick={() => onNavigate('/settings')}>
          Pengaturan
        </NavItem>
      </div>
      <CollectionNameDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Koleksi baru"
        action="Buat koleksi"
        onSubmit={async (name) => {
          const created = await actions.create(name);
          toast(`Koleksi "${created.name}" dibuat.`);
          pick({ collection: String(created.id) });
        }}
      />
    </nav>
  );
}
