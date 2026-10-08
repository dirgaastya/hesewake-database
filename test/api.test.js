import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createRelations } from '../src/items/relations.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter } from '../src/import/importer.js';
import { createApp } from '../src/api/app.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0LWRhdGE';

function setup(options = {}) {
  const db = openDb();
  const repo = createItemRepository(db);
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-api-')));
  const app = createApp({ repo, storage, importer: createImporter({ repo, storage }), relations: createRelations(db), auth: false, ...options });
  return { app, storage };
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const ids = (items) => items.map((i) => i.id);

test('GET /api/types', async () => {
  const { app } = setup();
  const res = await app.request('/api/types');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).query.label, 'Query');
});

test('CRUD item: create, get, patch, list, search', async () => {
  const { app } = setup();
  const created = await app.request('/api/items', json('POST', {
    type: 'command', title: 'Restart php-fpm', content: 'sudo systemctl restart php8.2-fpm', tags: ['server'],
  }));
  assert.equal(created.status, 201);
  const item = await created.json();
  assert.equal((await (await app.request(`/api/items/${item.id}`)).json()).content, 'sudo systemctl restart php8.2-fpm');
  assert.equal((await (await app.request(`/api/items/${item.id}`, json('PATCH', { pinned: true }))).json()).pinned, true);
  assert.deepEqual(ids(await (await app.request('/api/items?tag=server')).json()), [item.id]);
  assert.deepEqual(ids(await (await app.request('/api/items?q=systemctl')).json()), [item.id]);
});

test('aksi batch: tambah banyak item ke koleksi dan pindahkan banyak item ke trash', async () => {
  const { app } = setup();
  const first = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Pertama' }))).json();
  const second = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Kedua' }))).json();
  const collection = await (await app.request('/api/collections', json('POST', { name: 'SOP Oktober' }))).json();

  assert.equal((await app.request(`/api/collections/${collection.id}/items/batch`, json('POST', { itemIds: [first.id, second.id] }))).status, 204);
  assert.deepEqual(await (await app.request(`/api/items/${first.id}/collections`)).json(), [{ id: collection.id, name: 'SOP Oktober' }]);
  assert.deepEqual(await (await app.request(`/api/items/${second.id}/collections`)).json(), [{ id: collection.id, name: 'SOP Oktober' }]);

  const trashed = await app.request('/api/items/batch/trash', json('POST', { itemIds: [first.id, second.id, first.id] }));
  assert.deepEqual(await trashed.json(), { affected: 2 });
  assert.deepEqual(ids(await (await app.request('/api/items?trashed=1')).json()).sort(), [first.id, second.id].sort());
  assert.equal((await app.request('/api/items/batch/trash', json('POST', { itemIds: [] }))).status, 400);
});

test('arsip: hilang dari list default, muncul di ?archived=1', async () => {
  const { app } = setup();
  const item = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Catatan lama' }))).json();
  await app.request(`/api/items/${item.id}`, json('PATCH', { archived: true }));
  assert.deepEqual(await (await app.request('/api/items')).json(), []);
  assert.deepEqual(ids(await (await app.request('/api/items?archived=1')).json()), [item.id]);
});

test('filter pinned', async () => {
  const { app } = setup();
  await app.request('/api/items', json('POST', { type: 'note', title: 'Biasa' }));
  const pinned = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Penting', pinned: true }))).json();
  assert.deepEqual(ids(await (await app.request('/api/items?pinned=1')).json()), [pinned.id]);
});

test('versi: daftar dan kembalikan', async () => {
  const { app } = setup();
  const item = await (await app.request('/api/items', json('POST', { type: 'note', title: 'SOP release', content: 'langkah 1' }))).json();
  await app.request(`/api/items/${item.id}`, json('PATCH', { content: 'langkah 1 dan 2' }));
  const versions = await (await app.request(`/api/items/${item.id}/versions`)).json();
  assert.deepEqual(versions.map((v) => v.content), ['langkah 1']);
  const restored = await (await app.request(`/api/items/${item.id}/versions/${versions[0].id}/restore`, { method: 'POST' })).json();
  assert.equal(restored.content, 'langkah 1');
});

test('trash: delete, restore, hapus permanen', async () => {
  const { app } = setup();
  const item = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Draft', tags: ['tmp'] }))).json();

  assert.equal((await app.request(`/api/items/${item.id}?permanent=1`, { method: 'DELETE' })).status, 400);
  assert.equal((await app.request(`/api/items/${item.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual(await (await app.request('/api/items')).json(), []);
  assert.deepEqual(ids(await (await app.request('/api/items?trashed=1')).json()), [item.id]);

  const restored = await (await app.request(`/api/items/${item.id}/restore`, { method: 'POST' })).json();
  assert.equal(restored.deletedAt, null);

  await app.request(`/api/items/${item.id}`, { method: 'DELETE' });
  assert.equal((await app.request(`/api/items/${item.id}?permanent=1`, { method: 'DELETE' })).status, 204);
  assert.equal((await app.request(`/api/items/${item.id}`)).status, 404);
  assert.deepEqual(await (await app.request('/api/tags')).json(), []);
});

test('hapus permanen batch: hanya item di trash, atomik, dan bersihkan file', async () => {
  const { app, storage } = setup();
  const first = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Pertama' }))).json();
  const second = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Kedua' }))).json();
  const form = new FormData();
  form.append('file', new Blob(['lampiran']), 'lampiran.txt');
  const uploaded = await (await app.request('/api/files', { method: 'POST', body: form })).json();
  const filePath = storage.absolutePath(uploaded.file.path);

  assert.equal((await app.request('/api/items/batch/trash', json('POST', { itemIds: [first.id, uploaded.id] }))).status, 200);
  const rejected = await app.request('/api/items/batch/purge', json('POST', { itemIds: [first.id, second.id] }));
  assert.equal(rejected.status, 400);
  assert.equal((await app.request(`/api/items/${first.id}`)).status, 200, 'item trash tidak boleh terhapus sebagian');

  const purged = await app.request('/api/items/batch/purge', json('POST', { itemIds: [first.id, uploaded.id, first.id] }));
  assert.deepEqual(await purged.json(), { affected: 2 });
  assert.equal((await app.request(`/api/items/${first.id}`)).status, 404);
  assert.equal((await app.request(`/api/items/${uploaded.id}`)).status, 404);
  assert.equal(existsSync(filePath), false);
  assert.deepEqual(ids(await (await app.request('/api/items?trashed=1')).json()), []);
  assert.equal((await app.request('/api/items/batch/purge', json('POST', { itemIds: [] }))).status, 400);
});

test('secret: hanya menerima ciphertext, list tanpa isi', async () => {
  const { app } = setup();
  assert.equal((await app.request('/api/items', json('POST', { type: 'secret', title: 'Token Odoo', content: 'abc123' }))).status, 400);
  const item = await (await app.request('/api/items', json('POST', { type: 'secret', title: 'Token Odoo', content: CIPHER }))).json();
  assert.equal(item.encrypted, true);
  assert.equal((await (await app.request(`/api/items/${item.id}`)).json()).content, CIPHER);
  const [listed] = await (await app.request('/api/items?type=secret')).json();
  assert.equal(listed.content, null);
});

test('error dikembalikan sebagai JSON dengan status yang sesuai', async () => {
  const { app } = setup();
  const invalid = await app.request('/api/items', json('POST', { type: 'query', title: 'x' }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /metadata.language wajib/);
  assert.equal((await app.request('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await app.request('/api/items', json('POST', { type: 'file', title: 'x' }))).status, 400);
  assert.equal((await app.request('/api/items/abc')).status, 400);
  assert.equal((await app.request('/api/items?ticket=x')).status, 400);
});

test('upload, cari, download (stream), trash, hapus permanen file', async () => {
  const { app, storage } = setup();
  const form = new FormData();
  form.append('file', new Blob(['SELECT * FROM kunjungan;'], { type: 'text/plain' }), 'kunjungan.sql');
  form.append('tags', 'simrs, query');
  form.append('ticketId', '8193');

  const res = await app.request('/api/files', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.type, 'file');
  assert.equal(item.ticketId, 8193);
  assert.deepEqual(item.tags, ['query', 'simrs']);

  assert.deepEqual(ids(await (await app.request('/api/items?q=kunjungan&type=file')).json()), [item.id]);

  const download = await app.request(`/api/items/${item.id}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('Content-Disposition'), /kunjungan\.sql/);
  assert.equal(await download.text(), 'SELECT * FROM kunjungan;');

  const abs = storage.absolutePath(item.file.path);
  await app.request(`/api/items/${item.id}`, { method: 'DELETE' });
  assert.equal(existsSync(abs), true, 'file tetap ada selama item di trash');
  await app.request(`/api/items/${item.id}?permanent=1`, { method: 'DELETE' });
  assert.equal(existsSync(abs), false);
});

test('download inline hanya untuk tipe aman', async () => {
  const { app } = setup();
  const upload = async (name, type) => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type }), name);
    return (await app.request('/api/files', { method: 'POST', body: form })).json();
  };
  const png = await upload('ss.png', 'image/png');
  const svg = await upload('logo.svg', 'image/svg+xml');
  const pngRes = await app.request(`/api/items/${png.id}/download?inline=1`);
  assert.match(pngRes.headers.get('content-disposition'), /^inline;/);
  assert.equal(pngRes.headers.get('x-content-type-options'), 'nosniff');
  const svgRes = await app.request(`/api/items/${svg.id}/download?inline=1`);
  assert.match(svgRes.headers.get('content-disposition'), /^attachment;/);
  assert.match(svgRes.headers.get('content-security-policy'), /default-src 'self'/);
});

test('upload: tanpa file → 400, melebihi batas → 413', async () => {
  const { app } = setup({ maxUploadBytes: 200 });
  const empty = new FormData();
  empty.append('title', 'kosong');
  assert.equal((await app.request('/api/files', { method: 'POST', body: empty })).status, 400);

  const big = new FormData();
  big.append('file', new Blob(['x'.repeat(1000)]), 'besar.txt');
  const res = await app.request('/api/files', { method: 'POST', body: big });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /terlalu besar/);
});

test('import banyak file sekaligus, duplikat dilewati', async () => {
  const { app } = setup();
  const form = new FormData();
  form.append('files', new Blob(['SELECT 1;']), 'satu.sql');
  form.append('files', new Blob(['# Rapat']), 'rapat.md');
  form.append('files', new Blob(['SELECT 1;']), 'salinan-satu.sql');
  form.append('tags', 'impor');
  const res = await app.request('/api/import/files', { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.deepEqual({ created: summary.created, skipped: summary.skipped, failed: summary.failed }, { created: 2, skipped: 1, failed: [] });
  assert.equal(summary.itemIds.length, 2);
  assert.deepEqual(summary.results.map((r) => [r.name, r.status, r.type]), [
    ['satu.sql', 'created', 'query'],
    ['rapat.md', 'created', 'note'],
    ['salinan-satu.sql', 'skipped', 'query'],
  ]);
  assert.equal((await (await app.request('/api/items?tag=impor')).json()).length, 2);
});

test('import bookmark HTML', async () => {
  const { app } = setup();
  const html = '<DL><p><DT><H3>Kerja</H3><DL><p><DT><A HREF="https://laravel.com/docs">Laravel</A></DL><p></DL>';
  const form = new FormData();
  form.append('file', new Blob([html], { type: 'text/html' }), 'bookmarks.html');
  const res = await app.request('/api/import/bookmarks', { method: 'POST', body: form });
  assert.deepEqual(await res.json(), { created: 1, skipped: 0 });
  const [link] = await (await app.request('/api/items?type=link')).json();
  assert.deepEqual(link.tags, ['kerja']);
});

test('GET /api/link-preview', async () => {
  const calls = [];
  const { app } = setup({
    linkPreview: async (url) => {
      calls.push(url);
      return { url, title: 'Laravel', description: '', image: '', siteName: 'laravel.com' };
    },
  });
  const res = await app.request('/api/link-preview?url=https%3A%2F%2Flaravel.com');
  assert.equal((await res.json()).title, 'Laravel');
  assert.deepEqual(calls, ['https://laravel.com']);
  assert.equal((await app.request('/api/link-preview')).status, 400);
});

test('GET /api/tickets/:id', async () => {
  const { app } = setup({
    tickets: { get: async (id) => ({ id, name: 'Hotfix', stage: 'TODO', project: 'Medicare', deadline: null, url: `https://x/web#id=${id}` }) },
  });
  assert.equal((await (await app.request('/api/tickets/8193')).json()).name, 'Hotfix');
  const { app: without } = setup();
  const res = await without.request('/api/tickets/8193');
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /hesewake-cli/);
});
