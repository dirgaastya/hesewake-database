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
