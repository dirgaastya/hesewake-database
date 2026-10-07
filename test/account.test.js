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
