import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, validateItem, normalizeTags, CIPHERTEXT_PATTERN } from '../src/items/types.js';
import { ValidationError } from '../src/errors.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0LWRhdGE';

test('semua tipe punya label dan fields', () => {
  const expected = [
    'note', 'idea', 'learning', 'meeting', 'template', 'sop', 'query', 'command', 'config',
    'link', 'api_request', 'error_solution', 'schema', 'worklog', 'contact', 'server', 'file', 'secret',
  ];
  assert.deepEqual(Object.keys(TYPES).sort(), expected.sort());
  for (const [type, def] of Object.entries(TYPES)) {
    assert.equal(typeof def.label, 'string', type);
    assert.ok(Array.isArray(def.fields), type);
  }
});

test('validateItem menormalisasi input valid', () => {
  const item = validateItem({
    type: 'query',
    title: '  Cari pasien  ',
    content: 'SELECT 1',
    metadata: { language: 'sql', database: '' },
    tags: ['SIMRS', ' simrs ', 'Pasien'],
    ticketId: 8193,
    archived: true,
  });
  assert.deepEqual(item, {
    type: 'query',
    title: 'Cari pasien',
    content: 'SELECT 1',
    metadata: { language: 'sql' },
    ticketId: 8193,
    pinned: false,
    archived: true,
    tags: ['simrs', 'pasien'],
  });
});

test('validateItem default content, metadata, tags, flag', () => {
  const item = validateItem({ type: 'note', title: 'Catatan' });
  assert.equal(item.content, '');
  assert.deepEqual(item.metadata, {});
  assert.deepEqual(item.tags, []);
  assert.equal(item.ticketId, null);
  assert.equal(item.pinned, false);
  assert.equal(item.archived, false);
});

test('secret wajib berisi ciphertext', () => {
  assert.ok(CIPHERTEXT_PATTERN.test(CIPHER));
  assert.equal(validateItem({ type: 'secret', title: 'DB prod', content: CIPHER }).content, CIPHER);
  for (const content of [undefined, '', 'p@ssw0rd', 'v1.pendek.abc']) {
    assert.throws(() => validateItem({ type: 'secret', title: 'DB prod', content }), /terenkripsi/);
  }
});

test('validateItem menolak input tidak valid', () => {
  const cases = [
    [{ type: 'unknown', title: 'x' }, /Tipe tidak dikenal/],
    [{ type: 'note', title: '   ' }, /title wajib/],
    [{ type: 'note', title: 'x'.repeat(201) }, /title maksimal/],
    [{ type: 'note', title: 'x', content: 5 }, /content harus string/],
    [{ type: 'query', title: 'x' }, /metadata.language wajib/],
    [{ type: 'note', title: 'x', metadata: { foo: 'bar' } }, /tidak dikenal: foo/],
    [{ type: 'api_request', title: 'x', metadata: { method: 'GETT', url: '/a' } }, /metadata.method harus salah satu/],
    [{ type: 'link', title: 'x', metadata: { url: 123 } }, /metadata.url harus string/],
    [{ type: 'worklog', title: 'x' }, /wajib punya ticketId/],
    [{ type: 'note', title: 'x', ticketId: -1 }, /ticketId harus/],
    [{ type: 'note', title: 'x', tags: 'simrs' }, /tags harus array/],
  ];
  for (const [input, message] of cases) {
    assert.throws(() => validateItem(input), (err) => err instanceof ValidationError && message.test(err.message), JSON.stringify(input));
  }
});

test('normalizeTags buang tag kosong', () => {
  assert.deepEqual(normalizeTags(['', '  ', 'A']), ['a']);
});
