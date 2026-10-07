import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { migrate, MIGRATIONS } from '../src/db/schema.js';

test('openDb membuat semua tabel dan set user_version', () => {
  const db = openDb();
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
  for (const table of ['items', 'item_versions', 'tags', 'item_tags', 'settings', 'items_fts', 'account', 'sessions']) {
    assert.ok(names.includes(table), `tabel ${table} harus ada`);
  }
  const columns = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  for (const column of ['archived', 'deleted_at', 'extracted_text', 'ticket_id', 'source_hash']) {
    assert.ok(columns.includes(column), `kolom items.${column} harus ada`);
  }
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('migrate idempoten', () => {
  const db = openDb();
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
});
