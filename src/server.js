import { startServer } from './desktop/server-runtime.js';
import { formatReady } from './desktop/readiness.js';

const runtime = await startServer({ logger: console });
const message = `hesewake-database jalan di ${runtime.url} (data: ${runtime.config.dataDir})`;
if (process.env.HDB_DESKTOP === '1') process.stdout.write(`${formatReady({ url: runtime.url, port: runtime.port, pid: process.pid })}\n`);
else console.log(message);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await runtime.close();
}

process.once('SIGINT', () => stop().finally(() => process.exit(0)));
process.once('SIGTERM', () => stop().finally(() => process.exit(0)));
