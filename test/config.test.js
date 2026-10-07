import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const MB = 1024 * 1024;

test('loadConfig default', () => {
  const dataDir = join(homedir(), '.hesewake-database');
  assert.deepEqual(loadConfig({}), {
    dataDir,
    dbFile: join(dataDir, 'hesewake.db'),
    filesDir: join(dataDir, 'files'),
    backupDir: join(dataDir, 'backups'),
    port: 4321,
    host: '127.0.0.1',
    trashDays: 30,
    backupKeep: 7,
    maxUploadBytes: 100 * MB,
    maxImportBytes: 1024 * MB,
  });
});

test('loadConfig override lewat env, host tetap localhost', () => {
  const config = loadConfig({
    HDB_DATA_DIR: 'D:/vault',
    HDB_BACKUP_DIR: 'C:/Users/ThinkPad/OneDrive/hesewake-backup',
    HDB_PORT: '5000',
    HDB_HOST: '0.0.0.0',
    HDB_TRASH_DAYS: '7',
    HDB_BACKUP_KEEP: '14',
    HDB_MAX_UPLOAD_MB: '20',
    HDB_MAX_IMPORT_MB: '200',
  });
  assert.equal(config.dbFile, join('D:/vault', 'hesewake.db'));
  assert.equal(config.backupDir, 'C:/Users/ThinkPad/OneDrive/hesewake-backup');
  assert.equal(config.port, 5000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.trashDays, 7);
  assert.equal(config.backupKeep, 14);
  assert.equal(config.maxUploadBytes, 20 * MB);
  assert.equal(config.maxImportBytes, 200 * MB);
});
