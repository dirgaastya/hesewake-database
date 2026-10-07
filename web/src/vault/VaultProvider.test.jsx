import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { newSalt, deriveKeys, createVaultKey, encryptText } from '../../../src/shared/vault-crypto.js';
import { VaultProvider, useVault } from './VaultProvider.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function makeServer(password) {
  const salt = newSalt();
  const { wrapKey } = await deriveKeys(password, salt, 1000);
  const { vaultKey, wrappedVaultKey } = await createVaultKey(wrapKey);
  const fetcher = async (path) => (path === '/auth/params' ? { salt, iterations: 1000 } : { wrappedVaultKey });
  return { fetcher, vaultKey };
}

function renderVault(props) {
  const ref = {};
  function Probe() {
    Object.assign(ref, useVault());
    return null;
  }
  render(
    <VaultProvider {...props}>
      <Probe />
    </VaultProvider>,
  );
  return ref;
}

describe('VaultProvider', () => {
  test('unlock dengan password benar lalu dekripsi secret dari perangkat lain', async () => {
    const { fetcher, vaultKey } = await makeServer('kuda-laut-2026');
    const secret = await encryptText(vaultKey, 'Stg#rsud-2026!pg');
    const vault = renderVault({ fetcher });
    expect(vault.unlocked).toBe(false);
    await expect(vault.decrypt(secret)).rejects.toThrow(/Vault terkunci/);

    await act(() => vault.unlock('kuda-laut-2026'));
    expect(vault.unlocked).toBe(true);
    expect(await vault.decrypt(secret)).toBe('Stg#rsud-2026!pg');
    const mine = await vault.encrypt('baru');
    expect(mine).toMatch(/^v1\./);
  });

  test('password salah ditolak', async () => {
    const { fetcher } = await makeServer('kuda-laut-2026');
    const vault = renderVault({ fetcher });
    await expect(act(() => vault.unlock('salah-total'))).rejects.toThrow(/Master password salah/);
    expect(vault.unlocked).toBe(false);
  });

  test('terkunci otomatis setelah idle, aktivitas memperpanjang', async () => {
    const { fetcher, vaultKey } = await makeServer('kuda-laut-2026');
    const secret = await encryptText(vaultKey, 'x');
    const vault = renderVault({ fetcher, autoLockMs: 1000 });
    await act(() => vault.unlock('kuda-laut-2026'));
    vi.useFakeTimers();
    act(() => vault.touch());
    act(() => vi.advanceTimersByTime(900));
    await act(() => vault.decrypt(secret));
    act(() => vi.advanceTimersByTime(900));
    expect(vault.unlocked).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(vault.unlocked).toBe(false);
  });

  test('tidak menyimpan apa pun di storage browser', async () => {
    const { fetcher } = await makeServer('kuda-laut-2026');
    const vault = renderVault({ fetcher });
    await act(() => vault.unlock('kuda-laut-2026'));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
