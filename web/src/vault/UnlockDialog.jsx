import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useVault } from './VaultProvider.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { Button, Field, MetaLabel, TextInput } from '../components/ui.jsx';
import { useShake } from '../lib/useShake.js';

const UnlockContext = createContext(null);

// requestUnlock() membuka dialog dan resolve true kalau berhasil, false kalau dibatalkan.
export function UnlockProvider({ children }) {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef(null);
  const inputRef = useRef(null);
  const [scope, shake] = useShake();

  const finish = (result) => {
    setOpen(false);
    setPassword('');
    setError('');
    setBusy(false);
    resolver.current?.(result);
    resolver.current = null;
  };

  const requestUnlock = useCallback(() => {
    if (vault.unlocked) return Promise.resolve(true);
    setOpen(true);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, [vault.unlocked]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await vault.unlock(password);
      finish(true);
    } catch (err) {
      setError(/Master password salah/.test(err.message) ? 'Master password salah. Coba lagi atau cek Caps Lock.' : err.message);
      setBusy(false);
      shake();
      inputRef.current?.select();
    }
  };

  return (
    <UnlockContext.Provider value={requestUnlock}>
      {children}
      <Dialog
        open={open}
        onClose={() => finish(false)}
        title="Unlock vault"
        description="Masukkan master password untuk membuka secret di perangkat ini."
        initialFocusRef={inputRef}
      >
        <form id="unlock-form" className="grid gap-3" onSubmit={submit}>
          <div ref={scope}>
            <Field label="Master password" htmlFor="unlock-password" error={error}>
              <TextInput ref={inputRef} id="unlock-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={Boolean(error)} />
            </Field>
          </div>
          <MetaLabel items={['Terkunci lagi setelah 15 menit tidak dipakai']} />
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => finish(false)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" icon={Lock} shortcut="↵" disabled={busy || !password}>
              {busy ? 'Membuka…' : 'Unlock'}
            </Button>
          </div>
        </form>
      </Dialog>
    </UnlockContext.Provider>
  );
}

export const useRequestUnlock = () => useContext(UnlockContext);
