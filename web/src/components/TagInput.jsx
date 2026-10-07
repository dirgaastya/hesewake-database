import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTags } from '../lib/queries.js';
import { cx } from './ui.jsx';

const normalize = (value) => value.trim().toLowerCase().replace(/^#/, '');

export function TagInput({ value, onChange, id }) {
  const tags = useTags();
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);

  const suggestions = useMemo(() => {
    const term = normalize(draft);
    if (!term) return [];
    const matches = (tags.data ?? []).filter((tag) => tag.name.includes(term) && !value.includes(tag.name)).slice(0, 6);
    const exact = matches.some((tag) => tag.name === term) || value.includes(term);
    return exact ? matches : [...matches, { name: term, create: true }];
  }, [draft, tags.data, value]);

  const add = (name) => {
    const tag = normalize(name);
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft('');
    setActive(0);
  };

  const onKeyDown = (event) => {
    if ((event.key === 'Enter' || event.key === ',') && draft.trim()) {
      event.preventDefault();
      add(suggestions[active]?.name ?? draft);
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    } else if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 focus-within:border-focus focus-within:ring-1 focus-within:ring-focus">
        {value.map((tag) => (
          <span key={tag} className="inline-flex h-[22px] items-center gap-0.5 rounded-xs bg-surface-2 pl-1.5 pr-0.5 font-mono text-xs font-medium">
            <span className="text-fg-subtle">#</span>
            {tag}
            <button type="button" aria-label={`Hapus tag ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))} className="inline-grid size-[18px] place-items-center rounded-xs text-fg-subtle hover:bg-line hover:text-fg">
              <X size={12} strokeWidth={1.5} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft.trim()) add(draft);
          }}
          placeholder={value.length ? '' : 'Tambah tag, Enter untuk simpan'}
          aria-label="Tambah tag"
          className="h-[22px] min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div role="listbox" className="absolute left-0 top-full z-10 mt-1 w-full max-w-80 rounded-md bg-surface py-1 shadow-float">
          {suggestions.map((tag, index) => (
            <div
              key={tag.name}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(tag.name);
              }}
              className={cx('flex h-7 cursor-default items-center justify-between px-3 font-mono text-xs font-medium', index === active && 'bg-accent-soft')}
            >
              <span>{tag.create ? `Buat tag "${tag.name}"` : `#${tag.name}`}</span>
              <span className="text-fg-subtle">{tag.create ? '↵' : tag.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
