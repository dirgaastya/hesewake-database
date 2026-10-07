import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { openContext } from './cli/context.js';
import { createApp } from './api/app.js';
import { createBackup, hasBackupFor } from './backup/backup.js';
import { createAccountService } from './auth/account.js';
import { createRateLimiter } from './api/security.js';
import { createRootApp } from './api/root.js';
import { createTicketService, loadHesewakeCli } from './integrations/odoo.js';

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

const odoo = await loadHesewakeCli(config.hesewakeCliDir).catch((err) => {
  console.warn(`Integrasi Odoo dimatikan: ${err.message}`);
  return { loader: null, odooUrl: null };
});
const tickets = createTicketService(odoo);
if (tickets.available) console.log(`Integrasi Odoo aktif lewat hesewake-cli (${odoo.odooUrl})`);

const api = createApp({
  repo,
  storage,
  importer,
  tickets: tickets.available ? tickets : undefined,
  auth: createAccountService(db, { sessionDays: config.sessionDays }),
  allowedHosts: config.allowedHosts,
  rateLimiter: createRateLimiter(),
  maxUploadBytes: config.maxUploadBytes,
  maxImportBytes: config.maxImportBytes,
});

const app = createRootApp({ api, distDir: fileURLToPath(new URL('../web/dist', import.meta.url)) });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`hesewake-database jalan di http://${config.host}:${info.port} (data: ${config.dataDir})`);
});
