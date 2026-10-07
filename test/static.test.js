import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter } from '../src/import/importer.js';
import { createApp } from '../src/api/app.js';
import { createRootApp } from '../src/api/root.js';

function setup({ withDist = true } = {}) {
  const repo = createItemRepository(openDb());
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-static-files-')));
  const api = createApp({ repo, storage, importer: createImporter({ repo, storage }), auth: false });
  const distDir = mkdtempSync(join(tmpdir(), 'hdb-dist-'));
  if (withDist) {
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)');
  }
  return createRootApp({ api, distDir });
}

test('halaman SPA: index.html untuk root dan rute klien', async () => {
  const app = setup();
  for (const path of ['/', '/import', '/items/12']) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /id="root"/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  }
});

test('aset statis dan API tetap terpisah', async () => {
  const app = setup();
  const asset = await app.request('/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal((await (await app.request('/api/types')).json()).query.label, 'Query');
  const missing = await app.request('/api/tidak-ada');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Endpoint tidak ditemukan' });
});

test('file statis yang tidak ada → 404, bukan index.html', async () => {
  const app = setup();
  const res = await app.request('/pdfjs/standard_fonts/TidakAda.pfb');
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /id="root"/);
});

test('UI belum di-build: pesan jelas', async () => {
  const res = await setup({ withDist: false }).request('/');
  assert.equal(res.status, 503);
  assert.match(await res.text(), /npm run build/);
});
