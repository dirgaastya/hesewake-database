import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIPHERTEXT_PATTERN } from '../src/items/types.js';
import {
  KDF_ITERATIONS, toBase64Url, fromBase64Url, newSalt, deriveKeys,
  createVaultKey, unwrapVaultKey, rewrapVaultKey, encryptText, decryptText,
} from '../src/shared/vault-crypto.js';

const FAST = 1000; // iterasi rendah supaya test cepat; produksi pakai KDF_ITERATIONS

test('KDF default 600.000 iterasi', () => {
  assert.equal(KDF_ITERATIONS, 600_000);
});

test('base64url bolak-balik untuk berbagai panjang', () => {
  for (let n = 0; n <= 6; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => i * 37 + 250);
    const text = toBase64Url(bytes);
    assert.match(text, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(fromBase64Url(text), bytes);
  }
  assert.equal(newSalt().length, 22);
});

test('deriveKeys: authKey deterministik dan bergantung pada password dan salt', async () => {
  const salt = newSalt();
  const a = await deriveKeys('kuda-laut-2026', salt, FAST);
  const b = await deriveKeys('kuda-laut-2026', salt, FAST);
  const c = await deriveKeys('kuda-laut-2027', salt, FAST);
  const d = await deriveKeys('kuda-laut-2026', newSalt(), FAST);
  assert.equal(a.authKey, b.authKey);
  assert.notEqual(a.authKey, c.authKey);
  assert.notEqual(a.authKey, d.authKey);
  assert.equal(a.authKey.length, 43);
});

test('vault key: enkripsi secret lalu buka lagi setelah login ulang', async () => {
  const salt = newSalt();
  const { wrapKey } = await deriveKeys('kuda-laut-2026', salt, FAST);
  const { vaultKey, wrappedVaultKey } = await createVaultKey(wrapKey);
  assert.match(wrappedVaultKey, CIPHERTEXT_PATTERN);

  const secret = await encryptText(vaultKey, 'Stg#rsud-2026!pg');
  assert.match(secret, CIPHERTEXT_PATTERN);
  assert.notEqual(secret, await encryptText(vaultKey, 'Stg#rsud-2026!pg'));

  const again = await deriveKeys('kuda-laut-2026', salt, FAST);
  const unwrapped = await unwrapVaultKey(again.wrapKey, wrappedVaultKey);
  assert.equal(await decryptText(unwrapped, secret), 'Stg#rsud-2026!pg');
});

test('password salah dan ciphertext rusak ditolak', async () => {
  const salt = newSalt();
  const { wrapKey } = await deriveKeys('kuda-laut-2026', salt, FAST);
  const { vaultKey, wrappedVaultKey } = await createVaultKey(wrapKey);
  const wrong = await deriveKeys('salah-total', salt, FAST);
  await assert.rejects(unwrapVaultKey(wrong.wrapKey, wrappedVaultKey), /Master password salah/);

  const secret = await encryptText(vaultKey, 'rahasia');
  const [v, iv] = secret.split('.');
  await assert.rejects(decryptText(vaultKey, `${v}.${iv}.${toBase64Url(new Uint8Array(24))}`));
  await assert.rejects(decryptText(vaultKey, 'v2.x.y'), /Format ciphertext/);
});

test('ganti password: bungkus ulang vault key, secret lama tetap terbaca', async () => {
  const oldSalt = newSalt();
  const oldKeys = await deriveKeys('password-lama-1', oldSalt, FAST);
  const { vaultKey, wrappedVaultKey } = await createVaultKey(oldKeys.wrapKey);
  const secret = await encryptText(vaultKey, 'token-odoo');

  const newSaltValue = newSalt();
  const newKeys = await deriveKeys('password-baru-2', newSaltValue, FAST);
  const rewrapped = await rewrapVaultKey(oldKeys.wrapKey, wrappedVaultKey, newKeys.wrapKey);

  const reopened = await unwrapVaultKey((await deriveKeys('password-baru-2', newSaltValue, FAST)).wrapKey, rewrapped);
  assert.equal(await decryptText(reopened, secret), 'token-odoo');
  await assert.rejects(unwrapVaultKey(oldKeys.wrapKey, rewrapped), /Master password salah/);
});
