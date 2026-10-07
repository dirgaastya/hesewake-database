import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0LWRhdGE';

function setup() {
  const db = openDb();
  return { db, repo: createItemRepository(db) };
}

const queryInput = {
  type: 'query',
  title: 'Cari pasien by RM',
  content: 'SELECT * FROM pasien WHERE no_rm = ?',
  metadata: { language: 'sql' },
  tags: ['SIMRS', 'pasien'],
  ticketId: 8193,
};

test('create lalu get mengembalikan item lengkap', () => {
  const { repo } = setup();
  const item = repo.create(queryInput);
  assert.equal(typeof item.id, 'number');
  assert.equal(item.content, queryInput.content);
  assert.equal(item.encrypted, false);
  assert.deepEqual(item.metadata, { language: 'sql' });
  assert.deepEqual(item.tags, ['pasien', 'simrs']);
  assert.equal(item.ticketId, 8193);
  assert.equal(item.pinned, false);
  assert.equal(item.archived, false);
  assert.equal(item.deletedAt, null);
  assert.equal(item.file, null);
  assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(repo.get(item.id), item);
});

test('get id yang tidak ada → NotFoundError', () => {
  const { repo } = setup();
  assert.throws(() => repo.get(999), NotFoundError);
});

test('update merge patch, ganti tags, buang tag yatim', () => {
  const { repo } = setup();
  const item = repo.create(queryInput);
  const updated = repo.update(item.id, { title: 'Cari pasien (v2)', tags: ['rekam-medis'], pinned: true, archived: true });
  assert.equal(updated.title, 'Cari pasien (v2)');
  assert.equal(updated.content, queryInput.content);
  assert.equal(updated.pinned, true);
  assert.equal(updated.archived, true);
  assert.deepEqual(updated.tags, ['rekam-medis']);
  assert.deepEqual(repo.tags(), [{ name: 'rekam-medis', count: 1 }]);
  assert.deepEqual(repo.update(item.id, { content: 'SELECT 1' }).tags, ['rekam-medis']);
});

test('update: type tidak bisa diubah, validasi tetap jalan', () => {
  const { repo } = setup();
  const item = repo.create(queryInput);
  assert.throws(() => repo.update(item.id, { type: 'note' }), /type tidak bisa diubah/);
  assert.throws(() => repo.update(item.id, { metadata: {} }), ValidationError);
  assert.throws(() => repo.update(999, { title: 'x' }), NotFoundError);
});

test('versi: snapshot saat isi berubah, tidak saat pin/arsip, bisa dikembalikan', () => {
  const { repo } = setup();
  const item = repo.create({ type: 'note', title: 'A', content: 'c1', tags: ['x'] });
  repo.update(item.id, { content: 'c2' });
  repo.update(item.id, { pinned: true });
  repo.update(item.id, { title: 'B' });

  const versions = repo.versions(item.id);
  assert.deepEqual(versions.map((v) => [v.title, v.content]), [['A', 'c2'], ['A', 'c1']]);
  assert.deepEqual(versions[0].tags, ['x']);
  assert.match(versions[0].createdAt, /^\d{4}-/);

  const restored = repo.restoreVersion(item.id, versions[1].id);
  assert.equal(restored.title, 'A');
  assert.equal(restored.content, 'c1');
  assert.equal(restored.pinned, true);
  assert.deepEqual(repo.versions(item.id).map((v) => [v.title, v.content])[0], ['B', 'c2']);
  assert.throws(() => repo.restoreVersion(item.id, 9999), NotFoundError);
});

test('versi: maksimal 50 per item', () => {
  const { repo } = setup();
  const item = repo.create({ type: 'note', title: 'Draft', content: '0' });
  for (let i = 1; i <= 55; i++) repo.update(item.id, { content: String(i) });
  const versions = repo.versions(item.id);
  assert.equal(versions.length, 50);
  assert.equal(versions[0].content, '54');
});

test('trash, restore, purge', () => {
  const { db, repo } = setup();
  const a = repo.create(queryInput);
  repo.create({ type: 'note', title: 'Catatan', tags: ['simrs'] });

  const trashed = repo.trash(a.id);
  assert.match(trashed.deletedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(repo.tags(), [{ name: 'simrs', count: 1 }]);
  assert.throws(() => repo.update(a.id, { title: 'x' }), /restore dulu/);

  assert.equal(repo.restore(a.id).deletedAt, null);
  assert.deepEqual(repo.tags(), [
    { name: 'pasien', count: 1 },
    { name: 'simrs', count: 2 },
  ]);

  assert.throws(() => repo.purge(a.id), /trash dulu/);
  repo.trash(a.id);
  assert.equal(repo.purge(a.id).id, a.id);
  assert.throws(() => repo.get(a.id), NotFoundError);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM tags WHERE name = 'pasien'`).get().n, 0);
});

test('purgeExpired hanya menghapus item trash yang lebih tua dari batas hari', () => {
  const { db, repo } = setup();
  const old = repo.create({ type: 'note', title: 'Lama' });
  const fresh = repo.create({ type: 'note', title: 'Baru' });
  const active = repo.create({ type: 'note', title: 'Aktif' });
  repo.trash(old.id);
  repo.trash(fresh.id);
  const setDeletedAt = db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?');
  setDeletedAt.run('2026-08-01T00:00:00.000Z', old.id);
  setDeletedAt.run('2026-10-01T00:00:00.000Z', fresh.id);

  const purged = repo.purgeExpired({ days: 30, now: new Date('2026-10-07T00:00:00Z') });
  assert.deepEqual(purged.map((i) => i.id), [old.id]);
  assert.doesNotThrow(() => repo.get(fresh.id));
  assert.doesNotThrow(() => repo.get(active.id));
});

test('file: tipe file wajib bawa file, hash jadi source hash', () => {
  const { repo } = setup();
  assert.throws(() => repo.create({ type: 'file', title: 'Laporan' }), /wajib upload file/);
  const file = { name: 'a.pdf', mime: 'application/pdf', size: 10, path: '2026/10/x.pdf', hash: 'abc123' };
  assert.throws(() => repo.create({ type: 'note', title: 'x' }, { file }), /tidak menerima file/);
  const item = repo.create({ type: 'file', title: 'Laporan' }, { file: { ...file, extractedText: 'isi' } });
  assert.deepEqual(item.file, { name: 'a.pdf', mime: 'application/pdf', size: 10, path: '2026/10/x.pdf' });
  assert.equal(repo.findBySourceHash('abc123').id, item.id);
  assert.equal(repo.findBySourceHash('tidak-ada'), null);

  const note = repo.create({ type: 'note', title: 'Dari import' }, { sourceHash: 'def456' });
  assert.equal(repo.findBySourceHash('def456').id, note.id);
});

test('findLinkByUrl dan all', () => {
  const { repo } = setup();
  const link = repo.create({ type: 'link', title: 'Laravel', metadata: { url: 'https://laravel.com/docs' } });
  repo.create({ type: 'note', title: 'Catatan' });
  assert.equal(repo.findLinkByUrl('https://laravel.com/docs').id, link.id);
  assert.equal(repo.findLinkByUrl('https://example.com/'), null);
  repo.trash(link.id);
  assert.equal(repo.all().length, 2);
});

test('secret: ciphertext disimpan apa adanya, hanya keluar lewat get', () => {
  const { repo } = setup();
  const item = repo.create({ type: 'secret', title: 'DB prod', content: CIPHER, metadata: { username: 'root' } });
  assert.equal(item.encrypted, true);
  assert.equal(item.content, CIPHER);
  assert.equal(repo.get(item.id).content, CIPHER);
  assert.throws(() => repo.update(item.id, { content: 'plain' }), /terenkripsi/);
  assert.equal(repo.update(item.id, { title: 'DB prod (lama)' }).content, CIPHER);
});
