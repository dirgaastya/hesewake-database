import { mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_FILE = /^hesewake-\d{4}-\d{2}-\d{2}\.db$/;

const stamp = (now) => now.toISOString().slice(0, 10);
const dbFileFor = (backupDir, now) => join(backupDir, 'db', `hesewake-${stamp(now)}.db`);

export function hasBackupFor(backupDir, now = new Date()) {
  return existsSync(dbFileFor(backupDir, now));
}

function syncFiles(src, dest) {
  if (!existsSync(src)) return 0;
  let copied = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += syncFiles(from, to);
    } else if (!existsSync(to)) {
      mkdirSync(dest, { recursive: true });
      copyFileSync(from, to);
      copied++;
    }
  }
  return copied;
}

export function createBackup({ db, filesDir, backupDir, keep = 7, now = new Date() }) {
  const dbDir = join(backupDir, 'db');
  mkdirSync(dbDir, { recursive: true });
  const dbFile = dbFileFor(backupDir, now);
  rmSync(dbFile, { force: true });
  // VACUUM INTO menghasilkan salinan konsisten walau server sedang menulis.
  db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);

  const copiedFiles = syncFiles(filesDir, join(backupDir, 'files'));

  const snapshots = readdirSync(dbDir).filter((name) => DB_FILE.test(name)).sort();
  const removed = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const name of removed) rmSync(join(dbDir, name), { force: true });

  return { dbFile, copiedFiles, removed };
}
