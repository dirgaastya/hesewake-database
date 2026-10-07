import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FolderInput, Lock, LogOut, Moon, Plus, Search, Settings, Sun, SunMoon, Trash2, Unlock } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { padId } from '../lib/format.js';
import { TYPE_META } from '../lib/types.js';
import { setPendingDraft } from '../lib/draft.js';
import { useTheme } from '../lib/theme.jsx';
import { spring, exit } from '../lib/motion.js';
import { copyText, buildCurl } from '../lib/clipboard.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { useToast } from '../components/Toast.jsx';
import { TYPE_ICON } from '../components/icons.js';
import { Kbd, MetaLabel, TypeStamp } from '../components/ui.jsx';

const NEW_TYPES = ['query', 'note', 'link', 'command', 'error_solution', 'secret', 'worklog', 'file'];

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const itemClass =
  'flex h-8 cursor-default items-center gap-3 px-3 text-[13px] text-fg data-[selected=true]:bg-accent-soft [&_svg]:text-fg-muted';

export function CommandPalette({ open, mode, onClose }) {
  const [text, setText] = useState('');
  const vault = useVault();
  const requestUnlock = useRequestUnlock();
  const toast = useToast();
  const theme = useTheme();
  const client = useQueryClient();
  const commandMode = mode === 'commands' || text.startsWith('>');
  const term = commandMode ? text.replace(/^>\s*/, '') : text;
  const debounced = useDebounced(term, 120);

  useEffect(() => {
    if (open) setText(mode === 'commands' ? '>' : '');
  }, [open, mode]);

  const results = useQuery({
    queryKey: ['palette', debounced],
    queryFn: () => api(`/items?${new URLSearchParams(debounced ? { q: debounced, limit: '12' } : { limit: '8' })}`),
    enabled: open && !commandMode,
  });

  const run = (fn) => () => {
    onClose();
    fn();
  };

  const commands = useMemo(
    () => [
      ...NEW_TYPES.map((type) => ({
        id: `new-${type}`,
        label: `Buat ${TYPE_META[type].label.toLowerCase()} baru`,
        icon: TYPE_ICON[type] ?? Plus,
        shortcut: type === 'query' ? 'N' : null,
        action: () => {
          setPendingDraft({ type, metadata: type === 'query' ? { language: 'sql' } : {} });
          navigate('/items/new');
        },
      })),
      { id: 'import', label: 'Impor file atau bookmark', icon: FolderInput, action: () => navigate('/import') },
      { id: 'archive', label: 'Lihat arsip', icon: Archive, action: () => navigate('/?view=archived') },
      { id: 'trash', label: 'Lihat trash', icon: Trash2, action: () => navigate('/?view=trash') },
      vault.unlocked
        ? { id: 'lock', label: 'Kunci vault sekarang', icon: Lock, action: () => vault.lock() }
        : { id: 'unlock', label: 'Unlock vault', icon: Unlock, action: () => requestUnlock() },
      { id: 'theme-light', label: 'Tema terang', icon: Sun, action: () => theme.choose('light') },
      { id: 'theme-dark', label: 'Tema gelap', icon: Moon, action: () => theme.choose('dark') },
      { id: 'theme-system', label: 'Tema ikut sistem', icon: SunMoon, action: () => theme.choose('system') },
      { id: 'settings', label: 'Pengaturan dan perangkat', icon: Settings, action: () => navigate('/settings') },
      {
        id: 'logout',
        label: 'Keluar dari perangkat ini',
        icon: LogOut,
        action: async () => {
          await api('/auth/logout', { method: 'POST' });
          vault.lock();
          client.clear();
          window.location.assign('/');
        },
      },
    ],
    [vault, requestUnlock, theme, client],
  );

  const visibleCommands = commands.filter((command) => command.label.toLowerCase().includes(term.trim().toLowerCase()));

  const copyItem = async (item) => {
    if (item.type === 'secret' || item.type === 'file') return navigate(`/items/${item.id}`);
    const full = await api(`/items/${item.id}`);
    const content = full.type === 'link' ? full.metadata.url : full.type === 'api_request' ? buildCurl(full.metadata) : full.content;
    await copyText(content);
    toast(`"${full.title}" disalin.`);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid justify-items-center px-4 pt-[14vh]">
          <motion.div className="fixed inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.2 } }} exit={{ opacity: 0, transition: exit }} onClick={onClose} />
          <motion.div
            className="relative h-fit w-full max-w-[560px] overflow-hidden rounded-md bg-surface shadow-float"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring.smooth }}
            exit={{ opacity: 0, scale: 0.98, transition: exit }}
          >
            <Command
              label="Command palette"
              shouldFilter={false}
              loop
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onClose();
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !commandMode) {
                  event.preventDefault();
                  const selected = document.querySelector('[cmdk-item][data-selected="true"]')?.getAttribute('data-value');
                  const item = results.data?.find((candidate) => `item-${candidate.id}` === selected);
                  if (item) run(() => copyItem(item))();
                }
              }}
            >
              <div className="flex h-11 items-center gap-2 border-b border-line px-3 text-fg-subtle">
                <Search size={16} strokeWidth={1.5} aria-hidden="true" />
                <Command.Input autoFocus value={text} onValueChange={setText} placeholder={commandMode ? 'Ketik perintah…' : 'Cari item, atau ketik > untuk perintah'} className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
                <Kbd>Esc</Kbd>
              </div>
              <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto pb-1">
                {!commandMode && (
                  <Command.Group heading={<MetaLabel className="px-3 pb-1 pt-3" items={[debounced ? 'Item' : 'Terakhir diubah', results.data ? `${results.data.length} hasil` : null]} />}>
                    {(results.data ?? []).map((item) => (
                      <Command.Item key={item.id} value={`item-${item.id}`} onSelect={run(() => navigate(`/items/${item.id}`))} className={itemClass}>
                        <TypeStamp type={item.type} />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <span className="font-mono text-[11px] font-medium text-fg-subtle">{padId(item.id)}</span>
                      </Command.Item>
                    ))}
                    {results.data?.length === 0 && <p className="m-0 px-3 py-2 text-[13px] text-fg-subtle">Tidak ada yang cocok. Ketik &gt; untuk menjalankan perintah.</p>}
                  </Command.Group>
                )}
                {(commandMode || term) && visibleCommands.length > 0 && (
                  <Command.Group heading={<MetaLabel className="px-3 pb-1 pt-3" items={['Perintah']} />}>
                    {visibleCommands.map((command) => (
                      <Command.Item key={command.id} value={command.id} onSelect={run(command.action)} className={itemClass}>
                        <command.icon size={16} strokeWidth={1.5} aria-hidden="true" />
                        <span className="flex-1">{command.label}</span>
                        {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
              <div className="flex flex-wrap gap-4 border-t border-line px-3 py-2 text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> pilih</span>
                <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> buka</span>
                {!commandMode && <span className="inline-flex items-center gap-1"><Kbd>Ctrl ↵</Kbd> salin isi</span>}
                <span className="inline-flex items-center gap-1"><Kbd>&gt;</Kbd> perintah</span>
              </div>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

