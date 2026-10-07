import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { deriveKeys, unwrapVaultKey, encryptText, decryptText } from '../../../src/shared/vault-crypto.js';
import { api } from '../lib/api.js';

const VaultContext = createContext(null);
export const AUTO_LOCK_MS = 15 * 60 * 1000;

// vaultKey hanya hidup di ref ini. Tidak pernah masuk state, storage, atau log.
export function VaultProvider({ children, autoLockMs = AUTO_LOCK_MS, fetcher = api }) {
  const keyRef = useRef(null);
  const timerRef = useRef(null);
  const [status, setStatus] = useState({ unlocked: false, lockAt: null });

  const lock = useCallback(() => {
    keyRef.current = null;
    clearTimeout(timerRef.current);
    setStatus({ unlocked: false, lockAt: null });
  }, []);

  const touch = useCallback(() => {
    if (!keyRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(lock, autoLockMs);
    setStatus({ unlocked: true, lockAt: Date.now() + autoLockMs });
  }, [autoLockMs, lock]);

  const openWithKey = useCallback(
    (vaultKey) => {
      keyRef.current = vaultKey;
      touch();
    },
    [touch],
  );

  const unlock = useCallback(
    async (password) => {
      const params = await fetcher('/auth/params');
      const { wrapKey } = await deriveKeys(password, params.salt, params.iterations);
      const { wrappedVaultKey } = await fetcher('/auth/vault-key');
      openWithKey(await unwrapVaultKey(wrapKey, wrappedVaultKey));
    },
    [fetcher, openWithKey],
  );

  const requireKey = useCallback(() => {
    if (!keyRef.current) throw new Error('Vault terkunci. Unlock dulu pakai master password.');
    touch();
    return keyRef.current;
  }, [touch]);

  const encrypt = useCallback(async (text) => encryptText(requireKey(), text), [requireKey]);
  const decrypt = useCallback(async (payload) => decryptText(requireKey(), payload), [requireKey]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const value = useMemo(
    () => ({ ...status, unlock, lock, openWithKey, encrypt, decrypt, touch }),
    [status, unlock, lock, openWithKey, encrypt, decrypt, touch],
  );
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);
