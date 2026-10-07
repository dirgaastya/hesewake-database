import { describe, test, expect } from 'vitest';
import { parseSearch, toItemsQuery } from './search-query.js';
import { guessCapture, looksLikeSecret } from './capture.js';
import { findPlaceholders, fillPlaceholders } from './placeholders.js';
import { formatBytes, padId, relativeTime, shortAge, daysLeft } from './format.js';
import { diffLines } from './diff.js';
import { TYPE_META } from './types.js';

describe('parseSearch', () => {
  test('memisahkan operator dari teks bebas', () => {
    expect(parseSearch('type:query tag:#SIMRS ticket:8193 rawat inap')).toEqual({
      text: 'rawat inap', type: 'query', tag: 'simrs', ticket: '8193', archived: false, trashed: false, pinned: false,
    });
  });
  test('operator is: dan token yang tidak dikenal', () => {
    const parsed = parseSearch('is:arsip is:trash is:pinned is:aneh http://x.com/a:b');
    expect(parsed).toMatchObject({ archived: true, trashed: true, pinned: true, text: 'is:aneh http://x.com/a:b' });
  });
  test('toItemsQuery', () => {
    expect(toItemsQuery(parseSearch('type:link vclaim'), { limit: 20 })).toBe('q=vclaim&type=link&limit=20');
  });
});

describe('guessCapture', () => {
  test('URL jadi link', () => {
    expect(guessCapture('  https://laravel.com/docs  ')).toEqual({ type: 'link', title: '', metadata: { url: 'https://laravel.com/docs' }, content: '' });
  });
  test('SQL jadi query', () => {
    expect(guessCapture('select * from pasien').type).toBe('query');
    expect(guessCapture('WITH x AS (select 1) select * from x').metadata).toEqual({ language: 'sql' });
  });
  test('curl jadi api_request', () => {
    const guess = guessCapture(`curl -X PUT 'https://api.rs.local/v1/pasien/12' -H 'Authorization: Bearer x' -d '{"nama":"A"}'`);
    expect(guess).toEqual({
      type: 'api_request',
      title: 'PUT /v1/pasien/12',
      metadata: { method: 'PUT', url: 'https://api.rs.local/v1/pasien/12', headers: 'Authorization: Bearer x', body: '{"nama":"A"}' },
      content: '',
    });
    expect(guessCapture('curl https://x.id/a').metadata.method).toBe('GET');
  });
  test('error dan stack trace', () => {
    expect(guessCapture('Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCP.onStreamRead').type).toBe('error_solution');
    expect(guessCapture('SQLSTATE[42S22]: Column not found').title).toBe('SQLSTATE[42S22]: Column not found');
  });
  test('command, env, dan catatan', () => {
    expect(guessCapture('$ php artisan migrate --force')).toMatchObject({ type: 'command', content: 'php artisan migrate --force' });
    expect(guessCapture('# db\nDB_HOST=127.0.0.1\nDB_PORT=5432').type).toBe('config');
    expect(guessCapture('Rapat UAT farmasi\nRabu jam 9')).toMatchObject({ type: 'note', title: 'Rapat UAT farmasi' });
    expect(guessCapture('   ')).toBeNull();
  });
  test('looksLikeSecret', () => {
    expect(looksLikeSecret('Stg#rsud-2026!pg')).toBe(true);
    expect(looksLikeSecret('halo dunia 123!')).toBe(false);
    expect(looksLikeSecret('pendek1!')).toBe(true);
    expect(looksLikeSecret('https://x.id/a?b=1')).toBe(false);
  });
});

describe('placeholders', () => {
  test('cari dan isi', () => {
    const sql = "WHERE bangsal = {{bangsal}} AND tgl > {{ dari }} AND x = {{bangsal}}";
    expect(findPlaceholders(sql)).toEqual(['bangsal', 'dari']);
    expect(fillPlaceholders(sql, { bangsal: "'MELATI'", dari: '' })).toBe("WHERE bangsal = 'MELATI' AND tgl > {{ dari }} AND x = 'MELATI'");
  });
});

describe('format', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  test('ukuran dan id', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2516582)).toBe('2,4 MB');
    expect(formatBytes(88 * 1024)).toBe('88 KB');
    expect(padId(128)).toBe('#0128');
  });
  test('waktu relatif', () => {
    expect(relativeTime('2026-10-07T10:00:00Z', now)).toBe('2 jam lalu');
    expect(relativeTime('2026-10-06T08:00:00Z', now)).toBe('kemarin');
    expect(shortAge('2026-10-07T10:00:00Z', now)).toBe('2J');
    expect(shortAge('2026-10-04T10:00:00Z', now)).toBe('3 HARI');
    expect(daysLeft('2026-10-05T12:00:00Z', 30, now)).toBe(28);
  });
});

describe('diffLines', () => {
  test('baris sama, dihapus, ditambah', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
});

test('18 tipe punya kode dan kategori', () => {
  expect(Object.keys(TYPE_META)).toHaveLength(18);
  for (const meta of Object.values(TYPE_META)) {
    expect(meta.code).toMatch(/^[A-Z]+$/);
    expect(['catatan', 'kode', 'error', 'kerja', 'referensi', 'secret']).toContain(meta.category);
  }
});
