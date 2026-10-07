# hesewake-database Auth & Akses Multi-Perangkat (Fase 1, Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat hesewake-database aman diakses dari HP dan laptop lain lewat Tailscale: login dengan master password, sesi per perangkat, secret dienkripsi di browser (server tidak pernah melihat isi secret maupun master password), dan pertahanan HTTP terhadap DNS rebinding, CSRF, dan brute force.

**Architecture:** Model Bitwarden. Browser menurunkan `masterKey` dari master password (PBKDF2-SHA256 600.000 iterasi), lalu HKDF memecahnya jadi `authKey` (dikirim ke server untuk login, server hanya menyimpan hash scrypt-nya) dan `wrapKey` (tidak pernah keluar dari browser). Secret dienkripsi dengan `vaultKey` acak (AES-256-GCM) yang disimpan di server dalam bentuk terbungkus `wrapKey`. Ganti password cukup membungkus ulang `vaultKey`. Server tetap listen di `127.0.0.1`; perangkat lain masuk lewat `tailscale serve` (HTTPS di dalam tailnet). Middleware menolak Host asing, Origin asing, dan percobaan login berlebihan.

**Tech Stack:** WebCrypto (`globalThis.crypto.subtle`, sama di browser dan Node 22), `node:crypto` (scrypt untuk hash `authKey`), `hono/cookie`, `hono/secure-headers`, Tailscale.

**Prasyarat:** Plan 1 (`2026-10-07-hesewake-database-core.md`) selesai.

## Global Constraints

- Semua constraint Plan 1 tetap berlaku.
- Master password dan `wrapKey` tidak pernah dikirim ke server. Server hanya menerima `authKey` (turunan satu arah) dan ciphertext.
- KDF browser: PBKDF2-SHA256 **600.000** iterasi (`KDF_ITERATIONS`). Server menolak `iterations` di bawah **100.000**.
- Hash `authKey` di server: scrypt `N=2^15, r=8, p=1`.
- Cookie sesi `hdb_session`: `HttpOnly; Secure; SameSite=Strict; Path=/`, berlaku **30 hari** (`HDB_SESSION_DAYS`). Token disimpan di DB sebagai SHA-256, bukan token aslinya.
- Login gagal **5 kali dalam 5 menit** dari satu klien → `429`.
- Akun hanya bisa dibuat dari laptop server (`Host` = `127.0.0.1` atau `localhost`).
- Host yang diizinkan: `127.0.0.1:<port>`, `localhost:<port>`, ditambah `HDB_ALLOWED_HOSTS` (nama `*.ts.net`). Jangan pernah memakai `tailscale funnel`.
- Satu pengguna saja (tabel `account` dikunci `id = 1`).

## File Structure

```
src/
├─ shared/vault-crypto.js   # WebCrypto: deriveKeys, vaultKey, encryptText/decryptText (dipakai UI dan test)
├─ auth/account.js          # akun tunggal, sesi, ganti password
├─ api/security.js          # hostGuard, originGuard, securityHeaders, createRateLimiter
├─ api/app.js               # (modify) wiring guard + /api/auth/*
├─ db/schema.js             # (modify) migrasi 2: account, sessions
├─ config.js                # (modify) allowedHosts, sessionDays
└─ server.js                # (modify) wiring auth
test/
├─ vault-crypto.test.js · account.test.js · security.test.js · auth-api.test.js
└─ db.test.js · api.test.js · config.test.js   # (modify)
```

## Kontrak untuk UI (Fase 2)

| Alur | Langkah di browser |
|---|---|
| Buat akun (sekali, dari laptop) | `salt = newSalt()` → `{ authKey, wrapKey } = deriveKeys(password, salt)` → `{ vaultKey, wrappedVaultKey } = createVaultKey(wrapKey)` → `POST /api/auth/setup { salt, iterations: KDF_ITERATIONS, authKey, wrappedVaultKey, device }` |
| Login (per perangkat) | `GET /api/auth/params` → `deriveKeys(password, salt, iterations)` → `POST /api/auth/login { authKey, device }` → `unwrapVaultKey(wrapKey, wrappedVaultKey)` |
| Unlock (sudah login, vault terkunci) | `GET /api/auth/params` + `GET /api/auth/vault-key` → `deriveKeys` → `unwrapVaultKey`. Password salah = `unwrapVaultKey` melempar error, tampilkan shake. |
| Simpan secret | `content = encryptText(vaultKey, plaintext)` → `POST /api/items { type: 'secret', content }` |
| Buka secret | `GET /api/items/:id` → `decryptText(vaultKey, item.content)` |
| Auto-lock | Buang `vaultKey` dari memori setelah 15 menit tanpa aktivitas (`duration` di design system). Jangan simpan `vaultKey`, `wrapKey`, atau password di localStorage/sessionStorage. |
| Ganti password | `deriveKeys(lama)` → `deriveKeys(baru, newSalt())` → `rewrapVaultKey(oldWrapKey, wrapped, newWrapKey)` → `POST /api/auth/password { currentAuthKey, salt, iterations, authKey, wrappedVaultKey }`. Semua secret tidak perlu dienkripsi ulang. |

---

### Task 1: Kripto vault bersama (browser + Node)

**Files:**
- Create: `src/shared/vault-crypto.js`
- Test: `test/vault-crypto.test.js`

**Interfaces:**
- Consumes: `CIPHERTEXT_PATTERN` dari `src/items/types.js` (hanya di test)
- Produces (semua async kecuali yang ditandai):
  - `KDF_ITERATIONS = 600000`
  - `toBase64Url(bytes) → string`, `fromBase64Url(text) → Uint8Array` (sync)
  - `newSalt() → string` (sync, 16 byte base64url)
  - `deriveKeys(password, salt, iterations = KDF_ITERATIONS) → { authKey: string, wrapKey: CryptoKey }`
  - `createVaultKey(wrapKey) → { vaultKey: CryptoKey, wrappedVaultKey: string }`
  - `unwrapVaultKey(wrapKey, wrappedVaultKey) → CryptoKey` (password salah → `Error('Master password salah')`)
  - `rewrapVaultKey(oldWrapKey, wrappedVaultKey, newWrapKey) → string`
  - `encryptText(vaultKey, text) → 'v1.<iv>.<data>'`, `decryptText(vaultKey, payload) → string`

- [ ] **Step 1: Tulis failing test**

`test/vault-crypto.test.js`:

```js
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/vault-crypto.test.js`
Expected: FAIL, `Cannot find module '.../src/shared/vault-crypto.js'`

- [ ] **Step 3: Implementasi**

`src/shared/vault-crypto.js`:

```js
// Dipakai di browser (UI) dan Node (test). Hanya WebCrypto, tanpa dependency dan tanpa API Node.
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HKDF_SALT = new Uint8Array(32);

export const KDF_ITERATIONS = 600_000;

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

export function newSalt() {
  return toBase64Url(randomBytes(16));
}

export async function deriveKeys(password, salt, iterations = KDF_ITERATIONS) {
  const material = await subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations }, material, 256);
  const master = await subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const authBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode('hesewake-auth') },
    master,
    256,
  );
  const wrapKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode('hesewake-wrap') },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { authKey: toBase64Url(new Uint8Array(authBits)), wrapKey };
}

async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return `v1.${toBase64Url(iv)}.${toBase64Url(data)}`;
}

async function decryptBytes(key, payload) {
  const [version, iv, data] = String(payload).split('.');
  if (version !== 'v1' || !iv || !data) throw new Error('Format ciphertext tidak dikenal');
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(data)));
}

const importVaultKey = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

async function openWrapped(wrapKey, wrappedVaultKey) {
  try {
    return await decryptBytes(wrapKey, wrappedVaultKey);
  } catch {
    throw new Error('Master password salah');
  }
}

export async function createVaultKey(wrapKey) {
  const raw = randomBytes(32);
  const wrappedVaultKey = await encryptBytes(wrapKey, raw);
  const vaultKey = await importVaultKey(raw);
  raw.fill(0);
  return { vaultKey, wrappedVaultKey };
}

export async function unwrapVaultKey(wrapKey, wrappedVaultKey) {
  const raw = await openWrapped(wrapKey, wrappedVaultKey);
  const vaultKey = await importVaultKey(raw);
  raw.fill(0);
  return vaultKey;
}

export async function rewrapVaultKey(oldWrapKey, wrappedVaultKey, newWrapKey) {
  const raw = await openWrapped(oldWrapKey, wrappedVaultKey);
  const rewrapped = await encryptBytes(newWrapKey, raw);
  raw.fill(0);
  return rewrapped;
}

export const encryptText = (vaultKey, text) => encryptBytes(vaultKey, encoder.encode(text));
export const decryptText = async (vaultKey, payload) => decoder.decode(await decryptBytes(vaultKey, payload));
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/vault-crypto.test.js`
Expected: PASS, 6 test.

- [ ] **Step 5: Commit**

```bash
git add src/shared test/vault-crypto.test.js
git commit -m "feat: kripto vault di sisi klien (PBKDF2 + HKDF + AES-GCM)"
```

---

### Task 2: Akun tunggal dan sesi

**Files:**
- Modify: `src/db/schema.js` (tambah migrasi 2), `test/db.test.js`
- Create: `src/auth/account.js`
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: `MIGRATIONS`, `CIPHERTEXT_PATTERN`, `AuthError`, `ForbiddenError`, `ValidationError`
- Produces: `createAccountService(db, { sessionDays = 30, minIterations = 100000, now = () => new Date() }?)` dengan:
  - `hasAccount() → boolean`, `params() → { salt, iterations } | null`
  - `setup({ salt, iterations, authKey, wrappedVaultKey, device }) → { token, expiresAt }` (sekali saja; berikutnya `ForbiddenError`)
  - `login({ authKey, device }) → { token, expiresAt }` (salah → `AuthError('Master password salah')`)
  - `verifySession(token) → { id, device } | null` (memperbarui `last_seen_at`, menghapus sesi kedaluwarsa)
  - `logout(token)`, `sessions(currentId) → Array<{ id, device, createdAt, lastSeenAt, expiresAt, current }>`, `revokeSession(id)`
  - `wrappedVaultKey() → string`
  - `changePassword({ currentAuthKey, salt, iterations, authKey, wrappedVaultKey }, { keepSessionId }) → void` (sesi lain dicabut)

- [ ] **Step 1: Tambah migrasi dan perbarui test DB**

Di `src/db/schema.js`, tambahkan elemen kedua ke array `MIGRATIONS` (setelah template string pertama):

```js
  `
  CREATE TABLE account (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    kdf_salt          TEXT    NOT NULL,
    kdf_iterations    INTEGER NOT NULL,
    auth_hash         TEXT    NOT NULL,
    wrapped_vault_key TEXT    NOT NULL,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    device       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL
  );
  `,
```

Di `test/db.test.js`, ganti import dan kedua assertion `user_version`:

```js
import { migrate, MIGRATIONS } from '../src/db/schema.js';
```

```js
  for (const table of ['items', 'item_versions', 'tags', 'item_tags', 'settings', 'items_fts', 'account', 'sessions']) {
```

```js
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
```

(ganti di kedua test).

- [ ] **Step 2: Tulis failing test**

`test/account.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { createAccountService } from '../src/auth/account.js';
import { AuthError, ForbiddenError, ValidationError } from '../src/errors.js';

const SALT = 'c2FsdC1hY2NvdW50LTEyMw';
const AUTH = 'A'.repeat(43);
const WRAPPED = 'v1.AAAAAAAAAAAAAAAA.d3JhcHBlZC12YXVsdC1rZXk';

function setup(options = {}) {
  let clock = new Date('2026-10-07T08:00:00Z');
  const account = createAccountService(openDb(), { now: () => clock, ...options });
  return { account, advance: (ms) => { clock = new Date(clock.getTime() + ms); } };
}

const credentials = { salt: SALT, iterations: 600_000, authKey: AUTH, wrappedVaultKey: WRAPPED, device: 'Laptop ThinkPad' };

test('setup sekali, lalu params tersedia', () => {
  const { account } = setup();
  assert.equal(account.hasAccount(), false);
  assert.equal(account.params(), null);
  const session = account.setup(credentials);
  assert.equal(session.token.length, 43);
  assert.equal(account.hasAccount(), true);
  assert.deepEqual(account.params(), { salt: SALT, iterations: 600_000 });
  assert.equal(account.wrappedVaultKey(), WRAPPED);
  assert.throws(() => account.setup(credentials), ForbiddenError);
});

test('setup menolak data tidak valid', () => {
  const { account } = setup();
  assert.throws(() => account.setup({ ...credentials, iterations: 1000 }), /iterations minimal 100000/);
  assert.throws(() => account.setup({ ...credentials, wrappedVaultKey: 'polos' }), ValidationError);
  assert.throws(() => account.setup({ ...credentials, authKey: 'pendek' }), ValidationError);
  assert.throws(() => account.setup({ ...credentials, salt: 'x' }), ValidationError);
});

test('login benar membuat sesi, salah ditolak', () => {
  const { account } = setup();
  account.setup(credentials);
  const { token } = account.login({ authKey: AUTH, device: 'iPhone' });
  assert.equal(account.verifySession(token).device, 'iPhone');
  assert.throws(() => account.login({ authKey: 'B'.repeat(43), device: 'x' }), AuthError);
  assert.throws(() => account.login({ device: 'x' }), AuthError);
  assert.equal(account.verifySession('token-palsu'), null);
  assert.equal(account.verifySession(undefined), null);
});

test('sesi kedaluwarsa setelah N hari dan dihapus', () => {
  const { account, advance } = setup({ sessionDays: 30 });
  const { token } = account.setup(credentials);
  advance(29 * 24 * 60 * 60 * 1000);
  assert.ok(account.verifySession(token));
  advance(2 * 24 * 60 * 60 * 1000);
  assert.equal(account.verifySession(token), null);
  assert.equal(account.sessions().length, 0);
});

test('logout, daftar sesi, dan cabut sesi', () => {
  const { account } = setup();
  const laptop = account.setup(credentials);
  const phone = account.login({ authKey: AUTH, device: 'Android' });
  const current = account.verifySession(laptop.token);
  const list = account.sessions(current.id);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.current).device, 'Laptop ThinkPad');

  account.revokeSession(account.verifySession(phone.token).id);
  assert.equal(account.verifySession(phone.token), null);
  account.logout(laptop.token);
  assert.equal(account.verifySession(laptop.token), null);
});

test('ganti password: cek password lama, sesi lain dicabut', () => {
  const { account } = setup();
  const laptop = account.setup(credentials);
  const phone = account.login({ authKey: AUTH, device: 'Android' });
  const keep = account.verifySession(laptop.token).id;
  const next = { salt: 'bmV3LXNhbHQtYWNjb3VudA', iterations: 650_000, authKey: 'C'.repeat(43), wrappedVaultKey: 'v1.BBBBBBBBBBBBBBBB.bmV3LXdyYXBwZWQ' };

  assert.throws(() => account.changePassword({ ...next, currentAuthKey: 'B'.repeat(43) }, { keepSessionId: keep }), AuthError);
  account.changePassword({ ...next, currentAuthKey: AUTH }, { keepSessionId: keep });

  assert.deepEqual(account.params(), { salt: next.salt, iterations: 650_000 });
  assert.equal(account.wrappedVaultKey(), next.wrappedVaultKey);
  assert.ok(account.verifySession(laptop.token));
  assert.equal(account.verifySession(phone.token), null);
  assert.throws(() => account.login({ authKey: AUTH, device: 'x' }), AuthError);
  assert.ok(account.login({ authKey: next.authKey, device: 'x' }).token);
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `node --test test/account.test.js test/db.test.js`
Expected: `account.test.js` FAIL, `Cannot find module '.../src/auth/account.js'`; `db.test.js` PASS.

- [ ] **Step 4: Implementasi**

`src/auth/account.js`:

```js
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { CIPHERTEXT_PATTERN } from '../items/types.js';
import { AuthError, ForbiddenError, ValidationError } from '../errors.js';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DAY_MS = 24 * 60 * 60 * 1000;
const B64URL = /^[A-Za-z0-9_-]+$/;

function hashAuthKey(authKey) {
  const salt = randomBytes(16);
  return `scrypt.${salt.toString('base64url')}.${scryptSync(authKey, salt, 32, SCRYPT).toString('base64url')}`;
}

function verifyAuthKey(authKey, stored) {
  if (typeof authKey !== 'string') return false;
  const [, salt, hash] = stored.split('.');
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(authKey, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const tokenId = (token) => createHash('sha256').update(String(token)).digest('hex');

function validateCredentials({ salt, iterations, authKey, wrappedVaultKey }, minIterations) {
  if (typeof salt !== 'string' || salt.length < 16 || !B64URL.test(salt)) throw new ValidationError('salt tidak valid');
  if (!Number.isInteger(iterations) || iterations < minIterations) throw new ValidationError(`iterations minimal ${minIterations}`);
  if (typeof authKey !== 'string' || authKey.length < 40 || !B64URL.test(authKey)) throw new ValidationError('authKey tidak valid');
  if (typeof wrappedVaultKey !== 'string' || !CIPHERTEXT_PATTERN.test(wrappedVaultKey)) throw new ValidationError('wrappedVaultKey tidak valid');
}

export function createAccountService(db, { sessionDays = 30, minIterations = 100_000, now = () => new Date() } = {}) {
  const stmts = {
    account: db.prepare('SELECT * FROM account WHERE id = 1'),
    insertAccount: db.prepare(`
      INSERT INTO account (id, kdf_salt, kdf_iterations, auth_hash, wrapped_vault_key)
      VALUES (1, @salt, @iterations, @authHash, @wrappedVaultKey)
    `),
    updateAccount: db.prepare(`
      UPDATE account
      SET kdf_salt = @salt, kdf_iterations = @iterations, auth_hash = @authHash, wrapped_vault_key = @wrappedVaultKey,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = 1
    `),
    insertSession: db.prepare('INSERT INTO sessions (id, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    deleteOthers: db.prepare('DELETE FROM sessions WHERE id != ?'),
    sessions: db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC'),
  };

  function requireAccount() {
    const account = stmts.account.get();
    if (!account) throw new AuthError('Akun belum dibuat');
    return account;
  }

  function createSession(device) {
    const token = randomBytes(32).toString('base64url');
    const created = now();
    const expiresAt = new Date(created.getTime() + sessionDays * DAY_MS).toISOString();
    const name = String(device || 'Perangkat tanpa nama').slice(0, 80);
    stmts.insertSession.run(tokenId(token), name, created.toISOString(), created.toISOString(), expiresAt);
    return { token, expiresAt };
  }

  return {
    hasAccount: () => Boolean(stmts.account.get()),

    params() {
      const account = stmts.account.get();
      return account ? { salt: account.kdf_salt, iterations: account.kdf_iterations } : null;
    },

    setup(input) {
      if (stmts.account.get()) throw new ForbiddenError('Akun sudah dibuat');
      validateCredentials(input, minIterations);
      stmts.insertAccount.run({
        salt: input.salt,
        iterations: input.iterations,
        authHash: hashAuthKey(input.authKey),
        wrappedVaultKey: input.wrappedVaultKey,
      });
      return createSession(input.device);
    },

    login({ authKey, device } = {}) {
      const account = stmts.account.get();
      if (!account || !verifyAuthKey(authKey, account.auth_hash)) throw new AuthError('Master password salah');
      return createSession(device);
    },

    verifySession(token) {
      if (!token) return null;
      stmts.deleteExpired.run(now().toISOString());
      const session = stmts.session.get(tokenId(token));
      if (!session) return null;
      stmts.touchSession.run(now().toISOString(), session.id);
      return { id: session.id, device: session.device };
    },

    logout(token) {
      if (token) stmts.deleteSession.run(tokenId(token));
    },

    sessions(currentId) {
      stmts.deleteExpired.run(now().toISOString());
      return stmts.sessions.all().map((s) => ({
        id: s.id,
        device: s.device,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        current: s.id === currentId,
      }));
    },

    revokeSession(id) {
      stmts.deleteSession.run(id);
    },

    wrappedVaultKey: () => requireAccount().wrapped_vault_key,

    changePassword({ currentAuthKey, ...next }, { keepSessionId }) {
      const account = requireAccount();
      if (!verifyAuthKey(currentAuthKey, account.auth_hash)) throw new AuthError('Master password lama salah');
      validateCredentials(next, minIterations);
      db.transaction(() => {
        stmts.updateAccount.run({
          salt: next.salt,
          iterations: next.iterations,
          authHash: hashAuthKey(next.authKey),
          wrappedVaultKey: next.wrappedVaultKey,
        });
        stmts.deleteOthers.run(keepSessionId);
      })();
    },
  };
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `node --test test/account.test.js test/db.test.js`
Expected: PASS semua (scrypt membuat test ini sekitar 1–2 detik, itu wajar).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.js src/auth test/account.test.js test/db.test.js
git commit -m "feat: akun tunggal, sesi per perangkat, dan ganti master password"
```

---

### Task 3: Middleware keamanan HTTP

**Files:**
- Create: `src/api/security.js`
- Test: `test/security.test.js`

**Interfaces:**
- Consumes: `ForbiddenError`, `TooManyRequestsError`, `AppError`
- Produces:
  - `hostGuard(allowedHosts)` → middleware: `Host` di luar daftar → `ForbiddenError` (menangkal DNS rebinding)
  - `originGuard(allowedHosts)` → middleware: untuk method selain GET/HEAD/OPTIONS, `Origin` harus dari daftar; tanpa `Origin` tapi `Sec-Fetch-Site` lintas situs → ditolak; tanpa keduanya (curl, CLI) → lolos
  - `securityHeaders()` → `secureHeaders` dengan CSP ketat dan `frame-ancestors 'none'`
  - `createRateLimiter({ limit = 5, windowMs = 300000, now = Date.now }) → { check(key), fail(key), reset(key) }`
  - `clientKey(c) → string` (IP dari `X-Forwarded-For` yang dipasang `tailscale serve`, atau `'local'`)

- [ ] **Step 1: Tulis failing test**

`test/security.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { hostGuard, originGuard, securityHeaders, createRateLimiter, clientKey } from '../src/api/security.js';
import { AppError, TooManyRequestsError } from '../src/errors.js';

const HOSTS = ['127.0.0.1:4321', 'localhost:4321', 'thinkpad.tail1234.ts.net'];

function makeApp() {
  const app = new Hono();
  app.onError((err, c) => (err instanceof AppError ? c.json({ error: err.message }, err.status) : c.json({ error: 'x' }, 500)));
  app.use('*', securityHeaders(), hostGuard(HOSTS), originGuard(HOSTS));
  app.get('/data', (c) => c.json({ ok: true, client: clientKey(c) }));
  app.post('/data', (c) => c.json({ ok: true }));
  return app;
}

test('hostGuard: hanya host yang diizinkan', async () => {
  const app = makeApp();
  assert.equal((await app.request('http://127.0.0.1:4321/data')).status, 200);
  assert.equal((await app.request('https://thinkpad.tail1234.ts.net/data')).status, 200);
  const evil = await app.request('http://attacker.example/data');
  assert.equal(evil.status, 403);
  assert.match((await evil.json()).error, /Host tidak diizinkan/);
});

test('originGuard: tolak POST dari situs lain, izinkan dari UI sendiri dan curl', async () => {
  const app = makeApp();
  const post = (headers) => app.request('http://127.0.0.1:4321/data', { method: 'POST', headers });
  assert.equal((await post({ Origin: 'http://127.0.0.1:4321' })).status, 200);
  assert.equal((await post({ Origin: 'https://thinkpad.tail1234.ts.net' })).status, 200);
  assert.equal((await post({})).status, 200);
  assert.equal((await post({ Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post({ Origin: 'null' })).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await app.request('http://127.0.0.1:4321/data', { headers: { Origin: 'https://attacker.example' } })).status, 200);
});

test('securityHeaders: CSP ketat dan tidak boleh di-iframe', async () => {
  const res = await makeApp().request('http://127.0.0.1:4321/data');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('clientKey: pakai X-Forwarded-For dari tailscale serve', async () => {
  const app = makeApp();
  const viaTailscale = await app.request('https://thinkpad.tail1234.ts.net/data', { headers: { 'X-Forwarded-For': '100.101.102.103, 127.0.0.1' } });
  assert.equal((await viaTailscale.json()).client, '100.101.102.103');
  assert.equal((await (await app.request('http://127.0.0.1:4321/data')).json()).client, 'local');
});

test('rate limiter: blokir setelah N kegagalan, reset setelah window', () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) {
    limiter.check('a');
    limiter.fail('a');
  }
  assert.throws(() => limiter.check('a'), TooManyRequestsError);
  assert.doesNotThrow(() => limiter.check('b'));
  t = 1001;
  assert.doesNotThrow(() => limiter.check('a'));
  limiter.fail('a');
  limiter.reset('a');
  assert.doesNotThrow(() => limiter.check('a'));
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/security.test.js`
Expected: FAIL, `Cannot find module '.../src/api/security.js'`

- [ ] **Step 3: Implementasi**

`src/api/security.js`:

```js
import { secureHeaders } from 'hono/secure-headers';
import { ForbiddenError, TooManyRequestsError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const toSet = (hosts) => new Set(hosts.map((host) => host.toLowerCase()));

// Menangkal DNS rebinding: situs jahat yang mengarahkan domainnya ke 127.0.0.1 tetap mengirim Host miliknya.
export function hostGuard(allowedHosts) {
  const allowed = toSet(allowedHosts);
  return async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    if (!allowed.has(host)) throw new ForbiddenError(`Host tidak diizinkan: ${host || '(kosong)'}`);
    await next();
  };
}

// Menangkal CSRF: request yang mengubah data harus datang dari UI sendiri.
export function originGuard(allowedHosts) {
  const allowed = toSet(allowedHosts);
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      const fetchSite = c.req.header('sec-fetch-site');
      if (origin !== undefined) {
        let host = '';
        try {
          host = new URL(origin).host.toLowerCase();
        } catch {
          host = '';
        }
        if (!allowed.has(host)) throw new ForbiddenError('Origin tidak diizinkan');
      } else if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        throw new ForbiddenError('Request lintas situs ditolak');
      }
    }
    await next();
  };
}

export function securityHeaders() {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
  });
}

export function clientKey(c) {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : 'local';
}

export function createRateLimiter({ limit = 5, windowMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map();

  function entry(key) {
    const current = hits.get(key);
    if (current && current.resetAt > now()) return current;
    const fresh = { count: 0, resetAt: now() + windowMs };
    hits.set(key, fresh);
    return fresh;
  }

  return {
    check(key) {
      if (entry(key).count >= limit) throw new TooManyRequestsError();
    },
    fail(key) {
      entry(key).count++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/security.test.js`
Expected: PASS, 5 test.

- [ ] **Step 5: Commit**

```bash
git add src/api/security.js test/security.test.js
git commit -m "feat: middleware Host/Origin guard, security headers, dan rate limiter"
```

---

### Task 4: Route `/api/auth/*` dan proteksi semua API

**Files:**
- Modify: `src/api/app.js`, `test/api.test.js`
- Test: `test/auth-api.test.js`

**Interfaces:**
- Consumes: `createAccountService`, `hostGuard`, `originGuard`, `securityHeaders`, `createRateLimiter`, `clientKey`, `vault-crypto` (di test)
- Produces: `createApp({ ..., auth, allowedHosts?, rateLimiter? })`
  - `auth` **wajib**: service akun, atau `false` (khusus test Plan 1). `undefined` → `Error`.
  - `allowedHosts` diisi → `hostGuard` + `originGuard` aktif. `securityHeaders` selalu aktif.
  - Semua `/api/*` butuh cookie `hdb_session`, kecuali `/api/auth/status`, `/api/auth/params`, `/api/auth/setup`, `/api/auth/login`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/auth/status` | - | `{ hasAccount, authenticated }` |
| GET | `/api/auth/params` | - | `{ salt, iterations }` atau 404 |
| POST | `/api/auth/setup` | `{ salt, iterations, authKey, wrappedVaultKey, device }` | `201` + cookie (hanya dari `127.0.0.1`/`localhost`) |
| POST | `/api/auth/login` | `{ authKey, device }` | `{ wrappedVaultKey }` + cookie |
| POST | `/api/auth/logout` | - | `204`, cookie dihapus |
| GET | `/api/auth/vault-key` | - | `{ wrappedVaultKey }` |
| GET | `/api/auth/sessions` | - | daftar sesi + `current` |
| DELETE | `/api/auth/sessions/:id` | - | `204` |
| POST | `/api/auth/password` | `{ currentAuthKey, salt, iterations, authKey, wrappedVaultKey }` | `{ ok: true }` |

- [ ] **Step 1: Perbarui setup test Plan 1**

Di `test/api.test.js`, fungsi `setup` menambahkan `auth: false`:

```js
  const app = createApp({ repo, storage, importer: createImporter({ repo, storage }), auth: false, ...options });
```

- [ ] **Step 2: Tulis failing test**

`test/auth-api.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter } from '../src/import/importer.js';
import { createAccountService } from '../src/auth/account.js';
import { createRateLimiter } from '../src/api/security.js';
import { createApp } from '../src/api/app.js';
import { newSalt, deriveKeys, createVaultKey, unwrapVaultKey, encryptText, decryptText, rewrapVaultKey } from '../src/shared/vault-crypto.js';

const FAST = 1000;
const LOCAL = 'http://127.0.0.1:4321';
const TAILNET = 'https://thinkpad.tail1234.ts.net';

function setup() {
  const db = openDb();
  const repo = createItemRepository(db);
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-auth-')));
  const app = createApp({
    repo,
    storage,
    importer: createImporter({ repo, storage }),
    auth: createAccountService(db, { minIterations: FAST }),
    allowedHosts: ['127.0.0.1:4321', 'localhost:4321', 'thinkpad.tail1234.ts.net'],
    rateLimiter: createRateLimiter({ limit: 3 }),
  });
  return { app };
}

const post = (body, headers = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];

async function createAccount(app, password = 'kuda-laut-2026') {
  const salt = newSalt();
  const { authKey, wrapKey } = await deriveKeys(password, salt, FAST);
  const { vaultKey, wrappedVaultKey } = await createVaultKey(wrapKey);
  const res = await app.request(`${LOCAL}/api/auth/setup`, post({ salt, iterations: FAST, authKey, wrappedVaultKey, device: 'Laptop' }));
  return { res, vaultKey, cookie: cookieOf(res) };
}

test('alur lengkap: setup, simpan secret terenkripsi, login dari HP, buka secret', async () => {
  const { app } = setup();
  assert.deepEqual(await (await app.request(`${LOCAL}/api/auth/status`)).json(), { hasAccount: false, authenticated: false });

  const { res, vaultKey, cookie } = await createAccount(app);
  assert.equal(res.status, 201);
  const setCookie = res.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.match(setCookie, new RegExp(flag));

  const content = await encryptText(vaultKey, 'Stg#rsud-2026!pg');
  const created = await app.request(`${LOCAL}/api/items`, post({ type: 'secret', title: 'DB staging', content }, { cookie }));
  assert.equal(created.status, 201);
  const { id } = await created.json();

  // Perangkat lain: belum punya cookie
  assert.equal((await app.request(`${TAILNET}/api/items`)).status, 401);
  const params = await (await app.request(`${TAILNET}/api/auth/params`)).json();
  const keys = await deriveKeys('kuda-laut-2026', params.salt, params.iterations);
  const login = await app.request(`${TAILNET}/api/auth/login`, post({ authKey: keys.authKey, device: 'Android' }));
  assert.equal(login.status, 200);
  const phoneCookie = cookieOf(login);
  const phoneVaultKey = await unwrapVaultKey(keys.wrapKey, (await login.json()).wrappedVaultKey);

  const item = await (await app.request(`${TAILNET}/api/items/${id}`, { headers: { cookie: phoneCookie } })).json();
  assert.equal(await decryptText(phoneVaultKey, item.content), 'Stg#rsud-2026!pg');

  const sessions = await (await app.request(`${TAILNET}/api/auth/sessions`, { headers: { cookie: phoneCookie } })).json();
  assert.deepEqual(sessions.map((s) => [s.device, s.current]).sort(), [['Android', true], ['Laptop', false]]);
});

test('setup hanya sekali dan hanya dari laptop server', async () => {
  const { app } = setup();
  const salt = newSalt();
  const { authKey, wrapKey } = await deriveKeys('kuda-laut-2026', salt, FAST);
  const { wrappedVaultKey } = await createVaultKey(wrapKey);
  const body = { salt, iterations: FAST, authKey, wrappedVaultKey, device: 'HP' };
  assert.equal((await app.request(`${TAILNET}/api/auth/setup`, post(body))).status, 403);
  assert.equal((await app.request(`${LOCAL}/api/auth/setup`, post(body))).status, 201);
  assert.equal((await app.request(`${LOCAL}/api/auth/setup`, post(body))).status, 403);
});

test('login salah berkali-kali kena 429', async () => {
  const { app } = setup();
  await createAccount(app);
  const wrong = post({ authKey: 'X'.repeat(43), device: 'x' }, { 'X-Forwarded-For': '100.64.0.9' });
  for (let i = 0; i < 3; i++) assert.equal((await app.request(`${TAILNET}/api/auth/login`, wrong)).status, 401);
  assert.equal((await app.request(`${TAILNET}/api/auth/login`, wrong)).status, 429);
});

test('Host dan Origin asing ditolak walau punya cookie', async () => {
  const { app } = setup();
  const { cookie } = await createAccount(app);
  assert.equal((await app.request('http://attacker.example/api/items', { headers: { cookie } })).status, 403);
  const csrf = await app.request(`${LOCAL}/api/items`, post({ type: 'note', title: 'x' }, { cookie, Origin: 'https://attacker.example' }));
  assert.equal(csrf.status, 403);
});

test('logout dan cabut sesi', async () => {
  const { app } = setup();
  const { cookie } = await createAccount(app);
  assert.equal((await app.request(`${LOCAL}/api/auth/logout`, { method: 'POST', headers: { cookie } })).status, 204);
  assert.equal((await app.request(`${LOCAL}/api/items`, { headers: { cookie } })).status, 401);
});

test('ganti password: secret lama tetap terbaca dengan password baru', async () => {
  const { app } = setup();
  const { vaultKey, cookie } = await createAccount(app, 'password-lama-1');
  const content = await encryptText(vaultKey, 'token-odoo');
  const { id } = await (await app.request(`${LOCAL}/api/items`, post({ type: 'secret', title: 'Token', content }, { cookie }))).json();

  const params = await (await app.request(`${LOCAL}/api/auth/params`)).json();
  const oldKeys = await deriveKeys('password-lama-1', params.salt, params.iterations);
  const { wrappedVaultKey: oldWrapped } = await (await app.request(`${LOCAL}/api/auth/vault-key`, { headers: { cookie } })).json();
  const salt = newSalt();
  const newKeys = await deriveKeys('password-baru-2', salt, FAST);
  const wrappedVaultKey = await rewrapVaultKey(oldKeys.wrapKey, oldWrapped, newKeys.wrapKey);

  const res = await app.request(`${LOCAL}/api/auth/password`, post({ currentAuthKey: oldKeys.authKey, salt, iterations: FAST, authKey: newKeys.authKey, wrappedVaultKey }, { cookie }));
  assert.equal(res.status, 200);

  const login = await app.request(`${LOCAL}/api/auth/login`, post({ authKey: newKeys.authKey, device: 'Laptop' }));
  const reopened = await unwrapVaultKey(newKeys.wrapKey, (await login.json()).wrappedVaultKey);
  const item = await (await app.request(`${LOCAL}/api/items/${id}`, { headers: { cookie: cookieOf(login) } })).json();
  assert.equal(await decryptText(reopened, item.content), 'token-odoo');
});

test('createApp tanpa opsi auth ditolak', () => {
  assert.throws(() => createApp({ repo: {}, storage: {}, importer: {} }), /opsi auth wajib/);
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `node --test test/auth-api.test.js`
Expected: FAIL, test pertama mendapat `404` dari `/api/auth/status` atau error lain karena route belum ada.

- [ ] **Step 4: Implementasi**

Di `src/api/app.js`, tambahkan import:

```js
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { hostGuard, originGuard, securityHeaders, createRateLimiter, clientKey } from './security.js';
import { AppError, AuthError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
```

(ganti baris import errors yang lama). Tambahkan konstanta di atas `createApp`:

```js
const SESSION_COOKIE = 'hdb_session';
const PUBLIC_PATHS = new Set(['/api/auth/status', '/api/auth/params', '/api/auth/setup', '/api/auth/login']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function setSessionCookie(c, { token, expiresAt }) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
  });
}
```

Ganti signature dan awal `createApp`:

```js
export function createApp({
  repo,
  storage,
  importer,
  auth,
  allowedHosts,
  rateLimiter = createRateLimiter(),
  linkPreview = fetchLinkPreview,
  maxUploadBytes = 100 * MB,
  maxImportBytes = 1024 * MB,
}) {
  if (auth === undefined) throw new Error('createApp: opsi auth wajib (auth: false hanya untuk test)');
  const app = new Hono().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  app.use('*', securityHeaders());
  if (allowedHosts) app.use('*', hostGuard(allowedHosts), originGuard(allowedHosts));

  if (auth) {
    app.use('*', async (c, next) => {
      if (PUBLIC_PATHS.has(c.req.path)) return next();
      const session = auth.verifySession(getCookie(c, SESSION_COOKIE));
      if (!session) throw new AuthError();
      c.set('session', session);
      await next();
    });

    app.get('/auth/status', (c) =>
      c.json({ hasAccount: auth.hasAccount(), authenticated: Boolean(auth.verifySession(getCookie(c, SESSION_COOKIE))) }),
    );

    app.get('/auth/params', (c) => {
      const params = auth.params();
      if (!params) throw new NotFoundError('Akun belum dibuat');
      return c.json(params);
    });

    app.post('/auth/setup', async (c) => {
      const hostname = (c.req.header('host') ?? '').split(':')[0].toLowerCase();
      if (!LOCAL_HOSTS.has(hostname)) throw new ForbiddenError('Buat akun dari laptop server lewat http://127.0.0.1');
      setSessionCookie(c, auth.setup(await readJson(c)));
      return c.json({ ok: true }, 201);
    });

    app.post('/auth/login', async (c) => {
      const key = clientKey(c);
      rateLimiter.check(key);
      const body = await readJson(c);
      try {
        const session = auth.login(body);
        rateLimiter.reset(key);
        setSessionCookie(c, session);
        return c.json({ wrappedVaultKey: auth.wrappedVaultKey() });
      } catch (err) {
        if (err instanceof AuthError) rateLimiter.fail(key);
        throw err;
      }
    });

    app.post('/auth/logout', (c) => {
      auth.logout(getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
      return c.body(null, 204);
    });

    app.get('/auth/vault-key', (c) => c.json({ wrappedVaultKey: auth.wrappedVaultKey() }));
    app.get('/auth/sessions', (c) => c.json(auth.sessions(c.get('session').id)));
    app.delete('/auth/sessions/:id', (c) => {
      auth.revokeSession(c.req.param('id'));
      return c.body(null, 204);
    });
    app.post('/auth/password', async (c) => {
      auth.changePassword(await readJson(c), { keepSessionId: c.get('session').id });
      return c.json({ ok: true });
    });
  }
```

Route Plan 1 (`/types`, `/tags`, `/items`, dst.) tetap di bawahnya tanpa perubahan.

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS semua, termasuk `test/api.test.js` Plan 1 (memakai `auth: false`).

- [ ] **Step 6: Commit**

```bash
git add src/api/app.js test/api.test.js test/auth-api.test.js
git commit -m "feat: login, sesi cookie, dan proteksi semua API"
```

---

### Task 5: Config, server, dan akses lewat Tailscale

**Files:**
- Modify: `src/config.js`, `src/server.js`, `test/config.test.js`, `README.md`

**Interfaces:**
- Consumes: `createAccountService`, `createRateLimiter`, `createApp`
- Produces: `loadConfig` menambah `allowedHosts: string[]` dan `sessionDays: number`; `npm start` menjalankan API dengan auth dan guard aktif

- [ ] **Step 1: Perbarui test config**

Di `test/config.test.js`, tambahkan dua field ke objek `deepEqual` test default:

```js
    allowedHosts: ['127.0.0.1:4321', 'localhost:4321'],
    sessionDays: 30,
```

Tambahkan test baru:

```js
test('loadConfig: host Tailscale dan masa sesi', () => {
  const config = loadConfig({ HDB_PORT: '5000', HDB_ALLOWED_HOSTS: 'ThinkPad.tail1234.ts.net, ', HDB_SESSION_DAYS: '14' });
  assert.deepEqual(config.allowedHosts, ['127.0.0.1:5000', 'localhost:5000', 'thinkpad.tail1234.ts.net']);
  assert.equal(config.sessionDays, 14);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/config.test.js`
Expected: FAIL, objek config tidak punya `allowedHosts`.

- [ ] **Step 3: Implementasi**

Di `src/config.js`, ganti isi `return` dengan:

```js
  const port = Number(env.HDB_PORT || 4321);
  const extraHosts = (env.HDB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return {
    dataDir,
    dbFile: join(dataDir, 'hesewake.db'),
    filesDir: join(dataDir, 'files'),
    backupDir: env.HDB_BACKUP_DIR || join(dataDir, 'backups'),
    port,
    // Akses dari perangkat lain lewat `tailscale serve`, jadi server sendiri cukup di loopback.
    host: '127.0.0.1',
    trashDays: Number(env.HDB_TRASH_DAYS ?? 30),
    backupKeep: Number(env.HDB_BACKUP_KEEP ?? 7),
    maxUploadBytes: Number(env.HDB_MAX_UPLOAD_MB ?? 100) * MB,
    maxImportBytes: Number(env.HDB_MAX_IMPORT_MB ?? 1024) * MB,
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, ...extraHosts],
    sessionDays: Number(env.HDB_SESSION_DAYS ?? 30),
  };
```

Di `src/server.js`, tambahkan import:

```js
import { createAccountService } from './auth/account.js';
import { createRateLimiter } from './api/security.js';
```

Ganti pemanggilan `createApp` menjadi:

```js
const app = createApp({
  repo,
  storage,
  importer,
  auth: createAccountService(db, { sessionDays: config.sessionDays }),
  allowedHosts: config.allowedHosts,
  rateLimiter: createRateLimiter(),
  maxUploadBytes: config.maxUploadBytes,
  maxImportBytes: config.maxImportBytes,
});
```

Tambahkan bagian ini ke `README.md` sebelum "Import massal":

````markdown
## Akses dari HP dan laptop lain (Tailscale)

Server tetap hanya listen di `127.0.0.1`. Perangkat lain masuk lewat jaringan privat Tailscale, tidak lewat internet publik.

1. Install Tailscale di laptop ini dan di HP/laptop lain, login dengan akun yang sama.
2. Di admin Tailscale (DNS), aktifkan **MagicDNS** dan **HTTPS Certificates**.
3. Di laptop server: `tailscale serve --bg 4321`. Cek URL-nya dengan `tailscale serve status`, misalnya `https://thinkpad.tail1234.ts.net`.
4. Jalankan server dengan host itu diizinkan:
   `HDB_ALLOWED_HOSTS=thinkpad.tail1234.ts.net npm start`
5. Buat akun pertama kali dari laptop server (`http://127.0.0.1:4321`). Setelah itu login dari perangkat lain lewat URL `ts.net`.
6. Laptop harus menyala dan tidak sleep. Supaya server jalan otomatis saat login Windows:
   `schtasks /Create /SC ONLOGON /TN hesewake-database /TR "cmd /c cd /d C:\Users\ThinkPad\Desktop\project\personal\hesewake-database && set HDB_ALLOWED_HOSTS=thinkpad.tail1234.ts.net && npm start"`

Jangan pakai `tailscale funnel`: itu membuka server ke internet publik.

| Env | Default | Keterangan |
|---|---|---|
| `HDB_ALLOWED_HOSTS` | (kosong) | Nama host `ts.net`, pisahkan dengan koma |
| `HDB_SESSION_DAYS` | `30` | Lama login bertahan per perangkat |
````

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS semua.

- [ ] **Step 5: Smoke test manual**

Terminal 1:

```bash
HDB_DATA_DIR=./data HDB_ALLOWED_HOSTS=thinkpad.tail1234.ts.net npm start
```

Terminal 2:

```bash
curl -s http://127.0.0.1:4321/api/auth/status
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4321/api/items
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: attacker.example" http://127.0.0.1:4321/api/auth/status
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://attacker.example" -H "Content-Type: application/json" -d "{}" http://127.0.0.1:4321/api/auth/login
```

Expected: `{"hasAccount":false,"authenticated":false}`, lalu `401`, `403`, `403`.

Lalu dengan Tailscale aktif (`tailscale serve --bg 4321`), buka `https://<nama-laptop>.<tailnet>.ts.net/api/auth/status` dari HP. Expected: JSON yang sama. Stop server dan hapus folder `data`.

- [ ] **Step 6: Commit**

```bash
git add src/config.js src/server.js test/config.test.js README.md
git commit -m "feat: aktifkan auth di server dan dokumentasi akses lewat Tailscale"
```
