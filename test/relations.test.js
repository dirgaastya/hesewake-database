import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createRelations } from '../src/items/relations.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter } from '../src/import/importer.js';
import { createApp } from '../src/api/app.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

function setup() {
  const db = openDb();
  const repo = createItemRepository(db);
  const relations = createRelations(db);
  const error = repo.create({ type: 'error_solution', title: 'Postgres tidak bisa konek', metadata: { error_message: 'ECONNREFUSED' } });
  const query = repo.create({ type: 'query', title: 'Cek koneksi', content: 'SELECT 1', metadata: { language: 'sql' } });
  const log = repo.create({ type: 'worklog', title: 'Log hotfix', ticketId: 8193 });
  return { db, repo, relations, error, query, log };
}

test('link dua arah, idempoten, dan unlink', () => {
  const { relations, error, query, log } = setup();
  relations.link(query.id, error.id);
  relations.link(error.id, query.id);
  relations.link(error.id, log.id);
  assert.deepEqual(relations.linksOf(error.id).map((i) => i.title), ['Cek koneksi', 'Log hotfix']);
  assert.deepEqual(relations.linksOf(query.id).map((i) => i.id), [error.id]);
  relations.unlink(query.id, error.id);
  assert.deepEqual(relations.linksOf(query.id), []);
  assert.throws(() => relations.link(error.id, error.id), ValidationError);
  assert.throws(() => relations.link(error.id, 999), NotFoundError);
});

test('link ikut hilang saat item dihapus permanen', () => {
  const { repo, relations, error, query } = setup();
  relations.link(error.id, query.id);
  repo.trash(query.id);
  assert.equal(relations.linksOf(error.id)[0].deletedAt !== null, true);
  repo.purge(query.id);
  assert.deepEqual(relations.linksOf(error.id), []);
});

test('koleksi: buat, nama unik, isi, hitungan tanpa trash, filter list', () => {
  const { repo, relations, error, query, log } = setup();
  const release = relations.createCollection('  Release v2.3 ');
  assert.deepEqual(release, { id: release.id, name: 'Release v2.3', count: 0 });
  assert.throws(() => relations.createCollection('release V2.3'), /sudah ada/);
  assert.throws(() => relations.createCollection(' '), /wajib/);

  relations.addToCollection(release.id, error.id);
  relations.addToCollection(release.id, query.id);
  relations.addToCollection(release.id, query.id);
  relations.addToCollection(release.id, log.id);
  repo.trash(log.id);
  assert.equal(relations.collections()[0].count, 2);
  assert.deepEqual(repo.list({ collection: release.id }).map((i) => i.id).sort(), [error.id, query.id].sort());
  assert.deepEqual(repo.search('koneksi', { collection: release.id }).map((i) => i.id), [query.id]);
  assert.deepEqual(relations.collectionsOf(query.id), [{ id: release.id, name: 'Release v2.3' }]);

  relations.removeFromCollection(release.id, query.id);
  assert.deepEqual(relations.collectionsOf(query.id), []);
  assert.deepEqual(relations.renameCollection(release.id, 'Release v2.4'), { id: release.id, name: 'Release v2.4' });
  relations.deleteCollection(release.id);
  assert.deepEqual(relations.collections(), []);
  assert.throws(() => relations.deleteCollection(release.id), NotFoundError);
});

test('API links dan collections', async () => {
  const { db, repo, relations, error, query } = setup();
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-rel-')));
  const app = createApp({ repo, storage, importer: createImporter({ repo, storage }), relations, auth: false });
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const linked = await app.request(`/api/items/${error.id}/links`, json('POST', { targetId: query.id }));
  assert.equal(linked.status, 201);
  assert.deepEqual((await linked.json()).map((i) => i.id), [query.id]);
  assert.equal((await app.request(`/api/items/${error.id}/links`, json('POST', {}))).status, 400);
  assert.equal((await app.request(`/api/items/${error.id}/links/${query.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual(await (await app.request(`/api/items/${query.id}/links`)).json(), []);

  const created = await (await app.request('/api/collections', json('POST', { name: 'Hotfix Oktober' }))).json();
  assert.equal((await app.request('/api/collections', json('POST', { name: 'hotfix oktober' }))).status, 400);
  assert.equal((await app.request(`/api/collections/${created.id}/items`, json('POST', { itemId: query.id }))).status, 204);
  assert.deepEqual((await (await app.request(`/api/items?collection=${created.id}`)).json()).map((i) => i.id), [query.id]);
  assert.deepEqual(await (await app.request(`/api/items/${query.id}/collections`)).json(), [{ id: created.id, name: 'Hotfix Oktober' }]);
  assert.deepEqual((await (await app.request('/api/collections')).json())[0].count, 1);
  assert.equal((await (await app.request(`/api/collections/${created.id}`, json('PATCH', { name: 'Hotfix November' }))).json()).name, 'Hotfix November');
  assert.equal((await app.request(`/api/collections/${created.id}/items/${query.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await app.request(`/api/collections/${created.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await app.request('/api/collections/999', { method: 'DELETE' })).status, 404);
  db.close();
});
