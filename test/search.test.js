import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { createItemRepository, buildMatchQuery } from '../src/items/repository.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c3VwZXJzZWNyZXR2YWx1ZQ';

function setup() {
  const repo = createItemRepository(openDb());
  repo.create({ type: 'query', title: 'Pasien rawat inap aktif', content: 'SELECT * FROM pasien_rawat_inap WHERE pulang IS NULL', metadata: { language: 'sql' }, tags: ['simrs'], ticketId: 8193 });
  repo.create({ type: 'error_solution', title: 'Postgres tidak bisa konek', content: 'Start service postgresql di Laragon', metadata: { error_message: 'ECONNREFUSED 127.0.0.1:5432' }, tags: ['postgres'] });
  repo.create({ type: 'link', title: 'Dokumentasi BPJS VClaim', metadata: { url: 'https://dvlp.bpjs-kesehatan.go.id' }, tags: ['simrs', 'bpjs'] });
  repo.create({ type: 'file', title: 'Hasil lab.pdf' }, { file: { name: 'lab.pdf', mime: 'application/pdf', size: 1, path: '2026/10/lab.pdf', extractedText: 'Hemoglobin pasien normal' } });
  repo.create({ type: 'secret', title: 'Password DB staging', content: CIPHER, tags: ['simrs'] });
  return { repo };
}

const titles = (items) => items.map((i) => i.title);

test('buildMatchQuery membungkus tiap kata dan membuang token tanpa huruf/angka', () => {
  assert.equal(buildMatchQuery('  rawat "inap  '), '"rawat"* "inap"*');
  assert.equal(buildMatchQuery('   '), '');
  assert.equal(buildMatchQuery('(*) - pasien'), '"pasien"*');
});

test('list: filter type, tag, ticket', () => {
  const { repo } = setup();
  assert.deepEqual(titles(repo.list({ type: 'link' })), ['Dokumentasi BPJS VClaim']);
  assert.equal(repo.list({ tag: 'SIMRS' }).length, 3);
  assert.deepEqual(titles(repo.list({ ticketId: 8193 })), ['Pasien rawat inap aktif']);
  assert.equal(repo.list().length, 5);
  assert.equal(repo.list({ limit: 2 }).length, 2);
});

test('list: pinned di atas, lalu yang terbaru', () => {
  const repo = createItemRepository(openDb());
  repo.create({ type: 'note', title: 'A' });
  repo.create({ type: 'note', title: 'B' });
  repo.create({ type: 'note', title: 'C', pinned: true });
  assert.deepEqual(titles(repo.list()), ['C', 'B', 'A']);
});

test('list & search: arsip dan trash disembunyikan secara default', () => {
  const { repo } = setup();
  const [link] = repo.list({ type: 'link' });
  repo.update(link.id, { archived: true });
  const [error] = repo.list({ type: 'error_solution' });
  repo.trash(error.id);

  assert.equal(repo.list().length, 3);
  assert.deepEqual(titles(repo.list({ archived: true })), ['Dokumentasi BPJS VClaim']);
  assert.deepEqual(titles(repo.list({ trashed: true })), ['Postgres tidak bisa konek']);
  assert.deepEqual(repo.search('vclaim'), []);
  assert.deepEqual(titles(repo.search('vclaim', { archived: true })), ['Dokumentasi BPJS VClaim']);
  assert.deepEqual(repo.search('econn'), []);
  assert.deepEqual(titles(repo.search('econn', { trashed: true })), ['Postgres tidak bisa konek']);
});

test('list: content secret selalu null', () => {
  const { repo } = setup();
  const [secret] = repo.list({ type: 'secret' });
  assert.equal(secret.content, null);
  assert.equal(secret.encrypted, true);
});

test('search: content, metadata, prefix, extracted text', () => {
  const { repo } = setup();
  assert.deepEqual(titles(repo.search('rawat')), ['Pasien rawat inap aktif']);
  assert.deepEqual(titles(repo.search('econn')), ['Postgres tidak bisa konek']);
  assert.deepEqual(titles(repo.search('vclaim')), ['Dokumentasi BPJS VClaim']);
  assert.deepEqual(titles(repo.search('hemoglobin')), ['Hasil lab.pdf']);
  assert.ok(repo.search('rawat')[0].snippet.includes('[rawat]'));
});

test('search: multi kata = AND, filter tetap berlaku', () => {
  const { repo } = setup();
  assert.deepEqual(titles(repo.search('pasien inap')), ['Pasien rawat inap aktif']);
  assert.deepEqual(repo.search('pasien', { type: 'link' }), []);
});

test('search: ciphertext secret tidak ter-index, title tetap bisa dicari', () => {
  const { repo } = setup();
  assert.deepEqual(repo.search('c3VwZXJzZWNyZXR2YWx1ZQ'), []);
  const [hit] = repo.search('staging');
  assert.equal(hit.title, 'Password DB staging');
  assert.equal(hit.content, null);
});

test('search: input aneh tidak bikin error', () => {
  const { repo } = setup();
  for (const q of ['pasien-rawat', '"', 'a:b', '(*)', 'NOT', '']) {
    assert.doesNotThrow(() => repo.search(q), q);
  }
  assert.deepEqual(repo.search(''), []);
});
