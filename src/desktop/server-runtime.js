import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { openContext } from '../cli/context.js';
import { createApp } from '../api/app.js';
import { createRootApp } from '../api/root.js';
import { createBackup, hasBackupFor } from '../backup/backup.js';
import { createAccountService } from '../auth/account.js';
import { createRateLimiter } from '../api/security.js';
import { createTicketService, loadHesewakeCli } from '../integrations/odoo.js';

const HOUR_MS = 60 * 60 * 1000;

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export async function startServer({ env = process.env, logger = console } = {}) {
  const requestedPort = Number(env.HDB_PORT ?? 4321);
  const port = requestedPort === 0 ? await reserveLoopbackPort() : requestedPort;
  const runtimeEnv = { ...env, HDB_PORT: String(port) };
  const { config, db, repo, storage, importer, relations, ocr } = openContext(undefined, runtimeEnv);

  const dailyJobs = () => {
    const purged = repo.purgeExpired({ days: config.trashDays });
    for (const item of purged) {
      if (item.file) storage.remove(item.file.path);
      if (item.metadata.imageFile) storage.remove(item.metadata.imageFile);
    }
    if (purged.length) logger.info(`Trash: ${purged.length} item dihapus permanen`);
    if (!hasBackupFor(config.backupDir)) {
      try {
        const result = createBackup({ db, filesDir: config.filesDir, backupDir: config.backupDir, keep: config.backupKeep });
        logger.info(`Backup: ${result.dbFile} (+${result.copiedFiles} file)`);
      } catch (err) {
        logger.error(`Backup gagal: ${err.message}`);
      }
    }
  };
  dailyJobs();
  const jobs = setInterval(dailyJobs, HOUR_MS);
  jobs.unref();

  const odoo = await loadHesewakeCli(config.hesewakeCliDir).catch((err) => {
    logger.warn(`Integrasi Odoo dimatikan: ${err.message}`);
    return { loader: null, odooUrl: null };
  });
  const tickets = createTicketService(odoo);
  if (tickets.available) logger.info(`Integrasi Odoo aktif lewat hesewake-cli (${odoo.odooUrl})`);

  const api = createApp({
    repo, storage, importer, relations, ocr,
    tickets: tickets.available ? tickets : undefined,
    auth: createAccountService(db, { sessionDays: config.sessionDays }),
    allowedHosts: config.allowedHosts,
    rateLimiter: createRateLimiter(),
    maxUploadBytes: config.maxUploadBytes,
    maxImportBytes: config.maxImportBytes,
  });
  const app = createRootApp({ api, distDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
  const server = await new Promise((resolve, reject) => {
    const instance = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => resolve(instance));
    instance.once('error', reject);
  });
  const url = `http://${config.host}:${config.port}`;
  let closed = false;
  return {
    config,
    port: config.port,
    url,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(jobs);
      await ocr?.terminate();
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      db.close();
    },
  };
}
