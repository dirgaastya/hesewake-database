import { serve } from '@hono/node-server';
import { openContext } from './cli/context.js';
import { createApp } from './api/app.js';
import { createBackup, hasBackupFor } from './backup/backup.js';

const HOUR_MS = 60 * 60 * 1000;

const { config, db, repo, storage, importer } = openContext();

function dailyJobs() {
  const purged = repo.purgeExpired({ days: config.trashDays });
  for (const item of purged) {
    if (item.file) storage.remove(item.file.path);
  }
  if (purged.length) console.log(`Trash: ${purged.length} item dihapus permanen`);

  if (!hasBackupFor(config.backupDir)) {
    try {
      const result = createBackup({ db, filesDir: config.filesDir, backupDir: config.backupDir, keep: config.backupKeep });
      console.log(`Backup: ${result.dbFile} (+${result.copiedFiles} file)`);
    } catch (err) {
      console.error(`Backup gagal: ${err.message}`);
    }
  }
}

// Dicek tiap jam supaya laptop yang baru bangun dari sleep tetap dapat backup hari itu.
dailyJobs();
setInterval(dailyJobs, HOUR_MS).unref();

const app = createApp({
  repo,
  storage,
  importer,
  maxUploadBytes: config.maxUploadBytes,
  maxImportBytes: config.maxImportBytes,
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`hesewake-database jalan di http://${config.host}:${info.port} (data: ${config.dataDir})`);
});
