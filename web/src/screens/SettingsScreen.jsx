import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Laptop, LogOut, Smartphone } from 'lucide-react';
import { newSalt, deriveKeys, rewrapVaultKey, KDF_ITERATIONS } from '../../../src/shared/vault-crypto.js';
import { api } from '../lib/api.js';
import { navigate, useDocumentTitle } from '../lib/router.js';
import { relativeTime, formatDate } from '../lib/format.js';
import { useTheme } from '../lib/theme.jsx';
import { useShake } from '../lib/useShake.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { useToast } from '../components/Toast.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { Button, Field, MetaLabel, TextInput, cx } from '../components/ui.jsx';
import { TopBar } from './Workspace.jsx';

const MIN_PASSWORD = 10;

function ThemePicker() {
  const theme = useTheme();
  const options = [
    ['system', 'Ikut sistem'],
    ['light', 'Terang'],
    ['dark', 'Gelap'],
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-sm bg-surface-2 p-0.5">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme.preference === value}
          onClick={() => theme.choose(value)}
          className={cx('h-7 rounded-xs px-3 text-[13px] font-medium', theme.preference === value ? 'bg-surface text-fg shadow-float' : 'text-fg-muted hover:text-fg')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DeviceList() {
  const client = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api('/auth/sessions') });

  const revoke = async (session) => {
    await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
    client.invalidateQueries({ queryKey: ['sessions'] });
    toast(`${session.device} dikeluarkan.`);
  };

  return (
    <div className="rounded-sm border border-line bg-surface">
      {(sessions.data ?? []).map((session) => {
        const Icon = /Android|iPhone/.test(session.device) ? Smartphone : Laptop;
        const daysToExpire = Math.ceil((new Date(session.expiresAt) - Date.now()) / 86400000);
        return (
          <div key={session.id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0 [grid-template-areas:'icon_name_action'_'icon_meta_action']">
            <Icon size={16} strokeWidth={1.5} className="text-fg-muted [grid-area:icon]" aria-hidden="true" />
            <span className="truncate text-[13px] font-semibold [grid-area:name]">{session.device}</span>
            <MetaLabel
              className="[grid-area:meta]"
              items={[
                session.current ? 'Perangkat ini' : `Terakhir ${relativeTime(session.lastSeenAt)}`,
                `Masuk ${formatDate(session.createdAt)}`,
                daysToExpire < 30 && !session.current ? { text: `Kedaluwarsa ${daysToExpire} hari lagi`, tone: 'warning' } : null,
              ]}
            />
            {!session.current && (
              <Button variant="danger" size="sm" className="[grid-area:action]" onClick={() => revoke(session)}>
                Keluarkan
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChangePassword({ open, onClose }) {
  const toast = useToast();
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, shake] = useShake();

  const reset = () => {
    setCurrent('');
    setNext('');
    setRepeat('');
    setError('');
    setBusy(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD) return setError(`Password baru minimal ${MIN_PASSWORD} karakter.`);
    if (next !== repeat) return setError('Kedua password baru tidak sama.');
    setBusy(true);
    setError('');
    try {
      const params = await api('/auth/params');
      const old = await deriveKeys(current, params.salt, params.iterations);
      const { wrappedVaultKey } = await api('/auth/vault-key');
      const salt = newSalt();
      const fresh = await deriveKeys(next, salt);
      const rewrapped = await rewrapVaultKey(old.wrapKey, wrappedVaultKey, fresh.wrapKey);
      await api('/auth/password', { method: 'POST', body: { currentAuthKey: old.authKey, salt, iterations: KDF_ITERATIONS, authKey: fresh.authKey, wrappedVaultKey: rewrapped } });
      client.invalidateQueries({ queryKey: ['sessions'] });
      toast('Master password diganti. Perangkat lain sudah dikeluarkan.');
      reset();
      onClose();
    } catch (err) {
      setError(/salah/i.test(err.message) ? 'Master password lama salah.' : err.message);
      setBusy(false);
      shake();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Ganti master password"
      description="Secret tidak perlu dienkripsi ulang. Setelah diganti, semua perangkat lain keluar dan harus login dengan password baru."
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Batal
          </Button>
          <Button type="submit" form="change-password" variant="primary" disabled={busy || !current || !next}>
            {busy ? 'Mengganti…' : 'Ganti password'}
          </Button>
        </>
      }
    >
      <form id="change-password" ref={scope} className="grid gap-3" onSubmit={submit}>
        <Field label="Master password lama" htmlFor="pw-current">
          <TextInput id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Master password baru" htmlFor="pw-next" hint={`Minimal ${MIN_PASSWORD} karakter.`}>
          <TextInput id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Ulangi password baru" htmlFor="pw-repeat" error={error}>
          <TextInput id="pw-repeat" type="password" autoComplete="new-password" value={repeat} invalid={Boolean(error)} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function SettingsScreen() {
  useDocumentTitle('Pengaturan');
  const vault = useVault();
  const client = useQueryClient();
  const [changing, setChanging] = useState(false);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    vault.lock();
    client.clear();
    window.location.assign('/');
  };

  return (
    <div className="grid h-full grid-rows-[48px_minmax(0,1fr)] bg-canvas">
      <TopBar />
      <main className="overflow-y-auto">
        <div className="mx-auto grid max-w-[640px] gap-8 px-6 py-6 max-[560px]:px-4">
          <div className="grid gap-1">
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/')} className="-ml-2 w-fit">
              Kembali ke daftar
            </Button>
            <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">Pengaturan</h1>
          </div>

          <section className="grid gap-2">
            <MetaLabel items={['Tampilan']} />
            <ThemePicker />
          </section>

          <section className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <MetaLabel className="flex-1" items={['Perangkat yang login']} />
              <Button size="sm" icon={KeyRound} onClick={() => setChanging(true)}>
                Ganti master password
              </Button>
            </div>
            <DeviceList />
            <p className="m-0 text-xs text-fg-subtle">Login bertahan 30 hari per perangkat. Keluarkan perangkat yang hilang atau sudah tidak dipakai.</p>
          </section>

          <section className="grid gap-2 border-t border-line pt-4">
            <MetaLabel items={['Sesi ini']} />
            <div>
              <Button variant="danger" icon={LogOut} onClick={logout}>
                Keluar dari perangkat ini
              </Button>
            </div>
          </section>
        </div>
      </main>
      <ChangePassword open={changing} onClose={() => setChanging(false)} />
    </div>
  );
}
