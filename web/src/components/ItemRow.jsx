import { forwardRef } from 'react';
import { Lock, Pin } from 'lucide-react';
import { TypeStamp, cx } from './ui.jsx';
import { formatBytes, padId, shortAge, daysLeft } from '../lib/format.js';

// Snippet FTS memakai [kata] sebagai penanda hasil cocok.
export function highlightSnippet(snippet) {
  const parts = String(snippet).split(/\[([^\]]*)\]/);
  return parts.map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part));
}

function snippetFor(item) {
  if (item.snippet) return { node: highlightSnippet(item.snippet), mono: true };
  if (item.encrypted) return { node: '••••••••••••', mono: true };
  if (item.type === 'link') return { node: item.metadata.url, mono: false };
  if (item.type === 'file' && item.file) return { node: `${item.file.name} · ${formatBytes(item.file.size)}`, mono: false };
  if (item.type === 'error_solution') return { node: item.metadata.error_message, mono: true };
  if (item.type === 'api_request') return { node: `${item.metadata.method} ${item.metadata.url}`, mono: true };
  const firstLine = (item.content ?? '').split('\n').find((line) => line.trim()) ?? '';
  const mono = ['query', 'command', 'config', 'schema'].includes(item.type);
  return { node: firstLine, mono };
}

function asideFor(item, trashDays) {
  if (item.deletedAt) return `TRASH · ${daysLeft(item.deletedAt, trashDays)} HARI LAGI`;
  const parts = [];
  if (item.archived) parts.push('ARSIP');
  if (item.ticketId) parts.push(`T-${item.ticketId}`);
  parts.push(shortAge(item.updatedAt));
  return parts.join(' · ');
}

export const ItemRow = forwardRef(function ItemRow({ item, selected, onSelect, trashDays = 30 }, ref) {
  const snippet = snippetFor(item);
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(item.id)}
      onKeyDown={(event) => event.key === 'Enter' && onSelect(item.id)}
      className={cx(
        'grid cursor-default grid-cols-[48px_84px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2',
        '[grid-template-areas:"id_stamp_title_aside"_"._._snip_snip"] max-[560px]:grid-cols-[72px_minmax(0,1fr)_auto] max-[560px]:[grid-template-areas:"stamp_title_aside"_"._snip_snip"]',
        'transition-colors duration-[120ms] ease-out',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <span className="font-mono text-xs font-medium leading-5 text-fg-subtle tabular-nums [grid-area:id] max-[560px]:hidden">{padId(item.id)}</span>
      <span className="[grid-area:stamp]">
        <TypeStamp type={item.type} />
      </span>
      <span
        className={cx(
          'min-w-0 truncate text-sm leading-5 [grid-area:title]',
          item.deletedAt ? 'font-medium text-fg-muted line-through decoration-line-strong' : item.archived ? 'font-medium text-fg-muted' : 'font-semibold',
        )}
      >
        {item.title}
      </span>
      <span className="inline-flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-medium leading-5 tracking-[0.04em] text-fg-subtle tabular-nums [grid-area:aside]">
        {item.pinned && <Pin size={12} strokeWidth={1.5} aria-label="Disematkan" />}
        {item.encrypted && <Lock size={12} strokeWidth={1.5} aria-label="Terenkripsi" />}
        {asideFor(item, trashDays)}
      </span>
      {snippet.node && (
        <span className={cx('min-w-0 truncate text-fg-muted [grid-area:snip]', snippet.mono ? 'font-mono text-xs leading-[18px]' : 'text-[13px] leading-[18px]')}>{snippet.node}</span>
      )}
    </div>
  );
});
