import { homedir } from 'node:os';
import { join } from 'node:path';

const MB = 1024 * 1024;

export function loadConfig(env = process.env) {
  const dataDir = env.HDB_DATA_DIR || join(homedir(), '.hesewake-database');
  const port = Number(env.HDB_PORT || 4321);
  const extraHosts = (env.HDB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return {
    dataDir,
    dbFile: join(dataDir, 'hesewake.db'),
    filesDir: join(dataDir, 'files'),
    backupDir: env.HDB_BACKUP_DIR || join(dataDir, 'backups'),
    port,
    // Akses dari perangkat lain lewat `tailscale serve`, jadi server sendiri cukup di loopback.
    host: '127.0.0.1',
    trashDays: Number(env.HDB_TRASH_DAYS ?? 30),
    backupKeep: Number(env.HDB_BACKUP_KEEP ?? 7),
    maxUploadBytes: Number(env.HDB_MAX_UPLOAD_MB ?? 100) * MB,
    maxImportBytes: Number(env.HDB_MAX_IMPORT_MB ?? 1024) * MB,
    allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, ...extraHosts],
    sessionDays: Number(env.HDB_SESSION_DAYS ?? 30),
    hesewakeCliDir: env.HESEWAKE_CLI_DIR || join(homedir(), 'Desktop', 'project', 'hesewake-cli'),
  };
}
