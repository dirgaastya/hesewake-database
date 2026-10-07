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
