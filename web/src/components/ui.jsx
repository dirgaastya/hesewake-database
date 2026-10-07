import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { typeMeta } from '../lib/types.js';

const cx = (...parts) => parts.filter(Boolean).join(' ');
export { cx };

const BUTTON_VARIANT = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-fg hover:bg-line',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-transparent text-danger hover:bg-danger-soft',
  'danger-solid': 'bg-danger text-canvas hover:brightness-95',
};

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, shortcut, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex shrink-0 select-none items-center gap-2 whitespace-nowrap rounded-sm font-medium',
        'transition-[background-color,color,transform] duration-[120ms] ease-out active:scale-[0.97] active:duration-[80ms]',
        'disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
        BUTTON_VARIANT[variant],
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.5} aria-hidden="true" />}
      {children}
      {shortcut && (
        <Kbd className="-mr-1" onAccent={variant === 'primary'}>
          {shortcut}
        </Kbd>
      )}
    </button>
  );
});

export const IconButton = forwardRef(function IconButton({ icon: Icon, label, className, size = 16, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-6 shrink-0 place-items-center rounded-xs text-fg-muted transition-[background-color,color,transform] duration-[120ms]',
        'hover:bg-surface-2 hover:text-fg active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <Icon size={size} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
});

export function Kbd({ children, onAccent = false, className }) {
  return (
    <kbd
      className={cx(
        'inline-grid h-[18px] min-w-[18px] place-items-center rounded-xs border border-b-2 px-1 font-mono text-[11px] font-medium leading-none',
        onAccent ? 'border-white/40 bg-transparent text-on-accent' : 'border-line bg-surface text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const CATEGORY_BG = {
  catatan: 'bg-cat-catatan',
  kode: 'bg-cat-kode',
  error: 'bg-cat-error',
  kerja: 'bg-cat-kerja',
  referensi: 'bg-cat-referensi',
  secret: 'bg-cat-secret',
};

export function TypeStamp({ type, className }) {
  const meta = typeMeta(type);
  return (
    <span
      title={meta.label}
      className={cx(
        'inline-flex h-[18px] items-center gap-[5px] whitespace-nowrap rounded-xs border border-line bg-surface pl-1 pr-[5px]',
        'font-mono text-[10.5px] font-medium uppercase leading-none tracking-[0.06em] text-fg-muted',
        className,
      )}
    >
      <span className={cx('size-[7px] rounded-[1px]', CATEGORY_BG[meta.category])} aria-hidden="true" />
      {meta.code}
    </span>
  );
}

// items: Array<string | { text, tone: 'warning' | 'danger' | 'success' }>
export function MetaLabel({ items, className, as: Tag = 'p' }) {
  const tones = { warning: 'text-warning', danger: 'text-danger', success: 'text-success' };
  return (
    <Tag className={cx('m-0 flex flex-wrap items-center gap-x-2 font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-fg-subtle tabular-nums', className)}>
      {items.filter(Boolean).map((item, index) => {
        const text = typeof item === 'string' ? item : item.text;
        const tone = typeof item === 'string' ? null : tones[item.tone];
        return (
          <span key={`${index}-${text}`} className={cx('inline-flex items-center gap-2', tone)}>
            {index > 0 && <span className="text-line-strong" aria-hidden="true">·</span>}
            {text}
          </span>
        );
      })}
    </Tag>
  );
}

export function Field({ label, required, hint, error, children, htmlFor, className }) {
  return (
    <div className={cx('grid gap-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-fg-muted">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

const inputBase =
  'w-full rounded-sm border bg-surface text-[13px] text-fg placeholder:text-fg-subtle transition-[border-color] duration-[120ms] hover:border-line-strong focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus';

export const TextInput = forwardRef(function TextInput({ invalid, mono, className, ...props }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-8 px-3', mono && 'font-mono', invalid ? 'border-danger' : 'border-line', className)} {...props} />;
});

export const TextArea = forwardRef(function TextArea({ invalid, mono = true, className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(inputBase, 'min-h-24 resize-y px-3 py-2 leading-5', mono ? 'font-mono' : 'text-sm leading-[22px]', invalid ? 'border-danger' : 'border-line', className)}
      {...props}
    />
  );
});

export function Select({ options, className, ...props }) {
  return (
    <div className={cx('relative grid', className)}>
      <select className={cx(inputBase, 'h-8 appearance-none border-line pl-3 pr-8')} {...props}>
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value;
          const label = typeof option === 'string' ? option : option.label;
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>
      <ChevronDown size={14} strokeWidth={1.5} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
    </div>
  );
}

export function Banner({ tone = 'info', icon: Icon, children, action }) {
  const color = `var(--${tone})`;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className="flex items-start gap-3 border-b px-3 py-2 text-[13px] leading-5 text-fg"
      style={{
        background: `color-mix(in srgb, ${color} 10%, var(--surface))`,
        borderColor: `color-mix(in srgb, ${color} 25%, var(--line))`,
      }}
    >
      {Icon && <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ meta, title, children, actions }) {
  return (
    <section className="grid max-w-[460px] content-start justify-items-start gap-2 px-6 py-8">
      {meta && <MetaLabel items={meta} />}
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {children && <p className="m-0 text-[13px] leading-5 text-fg-muted">{children}</p>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

export function SkeletonRows({ count = 4 }) {
  return (
    <div aria-busy="true" aria-label="Memuat">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid grid-cols-[48px_84px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3">
          <span className="h-2.5 w-8 rounded-xs bg-surface-2" />
          <span className="h-2.5 w-14 rounded-xs bg-surface-2" />
          <span className="h-2.5 rounded-xs bg-surface-2" style={{ width: `${[72, 54, 64, 48][i % 4]}%` }} />
        </div>
      ))}
    </div>
  );
}

export function useFieldId(prefix) {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}
