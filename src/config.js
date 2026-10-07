import { homedir } from 'node:os';
import { join } from 'node:path';

const MB = 1024 * 1024;

export function loadConfig(env = process.env) {
  const dataDir = env.HDB_DATA_DIR || join(homedir(), '.hesewake-database');
  return {
    dataDir,
    dbFile: join(dataDir, 'hesewake.db'),
    filesDir: join(dataDir, 'files'),
    backupDir: env.HDB_BACKUP_DIR || join(dataDir, 'backups'),
    port: Number(env.HDB_PORT || 4321),
    // Akses dari perangkat lain lewat `tailscale serve` (Plan 2), jadi server sendiri cukup di loopback.
    host: '127.0.0.1',
    trashDays: Number(env.HDB_TRASH_DAYS ?? 30),
    backupKeep: Number(env.HDB_BACKUP_KEEP ?? 7),
    maxUploadBytes: Number(env.HDB_MAX_UPLOAD_MB ?? 100) * MB,
    maxImportBytes: Number(env.HDB_MAX_IMPORT_MB ?? 1024) * MB,
  };
}
