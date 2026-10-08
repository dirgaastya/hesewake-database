import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatReady, parseReady } from '../src/desktop/readiness.js';
import { startServer } from '../src/desktop/server-runtime.js';

test('readiness protocol hanya menerima URL loopback yang konsisten', () => {
  const line = formatReady({ url: 'http://127.0.0.1:45678', port: 45678, pid: 123 });
  assert.deepEqual(parseReady(line), { url: 'http://127.0.0.1:45678', port: 45678, pid: 123 });
  assert.equal(parseReady('log biasa'), null);
  assert.equal(parseReady('HDB_READY {"url":"http://localhost:45678","port":45678,"pid":123}'), null);
});

test('runtime desktop memakai port dinamis dan origin/host aktual', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hdb-desktop-'));
  const runtime = await startServer({
    env: { ...process.env, HDB_DATA_DIR: dataDir, HDB_PORT: '0', HDB_OCR: '0', HESEWAKE_CLI_DIR: join(dataDir, 'missing-cli') },
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    assert.ok(runtime.port > 0);
    assert.deepEqual(runtime.config.allowedHosts, [`127.0.0.1:${runtime.port}`, `localhost:${runtime.port}`]);
    const response = await fetch(`${runtime.url}/api/auth/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { hasAccount: false, authenticated: false });
  } finally {
    await runtime.close();
  }
});
