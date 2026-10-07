import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createBackup, hasBackupFor } from '../src/backup/backup.js';
import { exportAll } from '../src/backup/export.js';

const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test('createBackup: salin DB dan file baru saja', () => {
  const db = openDb();
  createItemRepository(db).create({ type: 'note', title: 'Catatan penting' });
  const filesDir = tempDir('hdb-files-');
  mkdirSync(join(filesDir, '2026', '10'), { recursive: true });
  writeFileSync(join(filesDir, '2026', '10', 'a.pdf'), 'pdf');
  const backupDir = tempDir('hdb-backup-');
  const now = new Date('2026-10-07T03:00:00Z');

  assert.equal(hasBackupFor(backupDir, now), false);
  const first = createBackup({ db, filesDir, backupDir, now });
  assert.equal(first.copiedFiles, 1);
  assert.ok(existsSync(first.dbFile));
  assert.equal(hasBackupFor(backupDir, now), true);
  const copy = new Database(first.dbFile, { readonly: true });
  assert.equal(copy.prepare('SELECT title FROM items').get().title, 'Catatan penting');
  copy.close();

  assert.equal(createBackup({ db, filesDir, backupDir, now }).copiedFiles, 0);
  assert.equal(readFileSync(join(backupDir, 'files', '2026', '10', 'a.pdf'), 'utf8'), 'pdf');
});

test('createBackup: simpan hanya N salinan DB terakhir', () => {
  const db = openDb();
  const filesDir = tempDir('hdb-files-');
  const backupDir = tempDir('hdb-backup-');
  for (let day = 1; day <= 9; day++) {
    createBackup({ db, filesDir, backupDir, keep: 7, now: new Date(`2026-10-0${day}T03:00:00Z`) });
  }
  const files = readdirSync(join(backupDir, 'db')).sort();
  assert.equal(files.length, 7);
  assert.equal(files[0], 'hesewake-2026-10-03.db');
  assert.equal(files[6], 'hesewake-2026-10-09.db');
});

test('exportAll: JSON, Markdown, dan file asli', () => {
  const repo = createItemRepository(openDb());
  const storage = createFileStorage(tempDir('hdb-files-'));
  const stored = storage.save(Buffer.from('isi pdf'), 'Laporan Bulanan.pdf');
  const query = repo.create({ type: 'query', title: 'Pasien aktif', content: 'SELECT 1;', metadata: { language: 'sql' }, tags: ['simrs'] });
  const file = repo.create({ type: 'file', title: 'Laporan Bulanan.pdf' }, { file: { name: 'Laporan Bulanan.pdf', mime: 'application/pdf', size: stored.size, path: stored.path } });
  repo.create({ type: 'secret', title: 'DB prod', content: 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0' });

  const outDir = tempDir('hdb-export-');
  assert.deepEqual(exportAll({ repo, storage, outDir }), { items: 3 });

  const json = JSON.parse(readFileSync(join(outDir, 'items.json'), 'utf8'));
  assert.equal(json.items.length, 3);
  assert.equal(json.items[2].content, 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0');

  const md = readFileSync(join(outDir, 'items', `${String(query.id).padStart(4, '0')}-pasien-aktif.md`), 'utf8');
  assert.match(md, /^# Pasien aktif/);
  assert.match(md, /```sql\nSELECT 1;\n```/);
  assert.equal(readFileSync(join(outDir, 'files', `${String(file.id).padStart(4, '0')}-Laporan Bulanan.pdf`), 'utf8'), 'isi pdf');
});
