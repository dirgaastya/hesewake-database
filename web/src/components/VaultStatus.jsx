import { useEffect, useState } from 'react';
import { useVault } from '../vault/VaultProvider.jsx';
import { useRequestUnlock } from '../vault/UnlockDialog.jsx';
import { cx } from './ui.jsx';

const pad = (n) => String(n).padStart(2, '0');

function useNow(active) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// Status vault di top bar: titik + kata, bukan warna saja. Klik terbuka = kunci, klik terkunci = unlock.
export function VaultStatus({ compact = false }) {
  const vault = useVault();
  const requestUnlock = useRequestUnlock();
  const now = useNow(vault.unlocked);
  const remaining = vault.lockAt ? Math.max(0, vault.lockAt - now) : 0;
  const expiring = vault.unlocked && remaining < 60_000;

  let label = 'Vault terkunci';
  let tone = 'text-fg-muted';
  let dot = 'bg-fg-subtle';
  if (vault.unlocked && expiring) {
    label = `Kunci dalam 0:${pad(Math.ceil(remaining / 1000))}`;
    tone = 'text-warning';
    dot = 'bg-warning';
  } else if (vault.unlocked) {
    const at = new Date(vault.lockAt);
    label = `Vault terbuka · ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    tone = 'text-success';
    dot = 'bg-success';
  }

  return (
    <button
      type="button"
      onClick={() => (vault.unlocked ? vault.lock() : requestUnlock())}
      title={vault.unlocked ? 'Kunci vault sekarang' : 'Unlock vault'}
      className={cx(
        'inline-flex h-6 shrink-0 items-center gap-2 whitespace-nowrap rounded-xs border border-line px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] tabular-nums hover:bg-surface-2',
        tone,
      )}
    >
      <span className={cx('size-1.5 rounded-full', dot)} aria-hidden="true" />
      <span className={cx(compact && 'max-[900px]:sr-only')}>{label}</span>
    </button>
  );
}
