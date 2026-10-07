import { useState } from 'react';
import { Lock } from 'lucide-react';
import { newSalt, deriveKeys, createVaultKey, unwrapVaultKey, KDF_ITERATIONS } from '../../../src/shared/vault-crypto.js';
import { api } from '../lib/api.js';
import { deviceName, isLocalHost } from '../lib/device.js';
import { useShake } from '../lib/useShake.js';
import { useVault } from '../vault/VaultProvider.jsx';
import { Button, Field, MetaLabel, TextInput } from '../components/ui.jsx';

const MIN_PASSWORD = 10;

function Frame({ title, description, children }) {
  return (
    <main className="min-h-full bg-canvas px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-[380px] gap-6">
        <p className="m-0 font-mono text-[13px] font-semibold tracking-[0.02em]">
          hesewake<span className="font-medium text-fg-subtle">/db</span>
        </p>
        <div className="grid gap-1">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">{title}</h1>
          {description && <p className="m-0 text-[13px] leading-5 text-fg-muted">{description}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

function SetupForm({ onDone }) {
  const vault = useVault();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Master password minimal ${MIN_PASSWORD} karakter.`);
    if (password !== repeat) return setError('Kedua password tidak sama.');
    setBusy(true);
    setError('');
    try {
      const salt = newSalt();
      const { authKey, wrapKey } = await deriveKeys(password, salt);
      const { vaultKey, wrappedVaultKey } = await createVaultKey(wrapKey);
      await api('/auth/setup', { method: 'POST', body: { salt, iterations: KDF_ITERATIONS, authKey, wrappedVaultKey, device: deviceName() } });
      vault.openWithKey(vaultKey);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Frame title="Buat master password" description="Satu password untuk login di semua perangkat dan membuka secret. Server tidak pernah menyimpan password ini.">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Master password" htmlFor="setup-password" hint={`Minimal ${MIN_PASSWORD} karakter. Kalimat panjang lebih kuat dan lebih mudah diingat.`}>
          <TextInput id="setup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="Ulangi master password" htmlFor="setup-repeat" error={error}>
          <TextInput id="setup-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} invalid={Boolean(error)} />
        </Field>
        <p className="m-0 rounded-sm border border-line bg-surface px-3 py-2 text-[13px] leading-5 text-fg-muted">
          Master password <b className="font-semibold text-fg">tidak bisa di-reset</b>. Kalau lupa, semua secret ikut hilang. Simpan di tempat aman.
        </p>
        <Button type="submit" variant="primary" disabled={busy} className="justify-center">
          {busy ? 'Menyiapkan…' : 'Buat akun'}
        </Button>
      </form>
    </Frame>
  );
}

function LoginForm({ onDone }) {
  const vault = useVault();
  const [password, setPassword] = useState('');
  const [device, setDevice] = useState(deviceName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, shake] = useShake();

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const params = await api('/auth/params');
      const { authKey, wrapKey } = await deriveKeys(password, params.salt, params.iterations);
      const { wrappedVaultKey } = await api('/auth/login', { method: 'POST', body: { authKey, device } });
      vault.openWithKey(await unwrapVaultKey(wrapKey, wrappedVaultKey));
      onDone();
    } catch (err) {
      setError(err.status === 401 ? 'Master password salah. Coba lagi atau cek Caps Lock.' : err.message);
      setBusy(false);
      shake();
    }
  };

  return (
    <Frame title="Masuk" description="Masukkan master password untuk membuka hesewake di perangkat ini.">
      <form className="grid gap-4" onSubmit={submit}>
        <div ref={scope}>
          <Field label="Master password" htmlFor="login-password" error={error}>
            <TextInput id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={Boolean(error)} autoFocus />
          </Field>
        </div>
        <Field label="Nama perangkat" htmlFor="login-device" hint="Muncul di daftar perangkat di Pengaturan.">
          <TextInput id="login-device" value={device} onChange={(e) => setDevice(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" icon={Lock} disabled={busy || !password} className="justify-center">
          {busy ? 'Memeriksa…' : 'Masuk'}
        </Button>
        <MetaLabel items={['Vault terkunci lagi setelah 15 menit tidak dipakai']} />
      </form>
    </Frame>
  );
}

export function AuthScreen({ status, onDone }) {
  if (status.hasAccount) return <LoginForm onDone={onDone} />;
  if (isLocalHost()) return <SetupForm onDone={onDone} />;
  return (
    <Frame title="Akun belum dibuat" description="Buat akun dulu dari laptop server lewat http://127.0.0.1:4321, lalu buka lagi halaman ini." />
  );
}
