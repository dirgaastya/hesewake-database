import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { securityHeaders } from './security.js';

// API dan UI satu origin: cookie SameSite=Strict dan guard Origin tetap berlaku tanpa CORS.
export function createRootApp({ api, distDir }) {
  const root = new Hono();
  root.route('/', api);
  root.all('/api/*', (c) => c.json({ error: 'Endpoint tidak ditemukan' }, 404));

  root.use('*', securityHeaders());

  const indexFile = join(distDir, 'index.html');
  if (!existsSync(indexFile)) {
    root.get('*', (c) => c.text('UI belum di-build. Jalankan: npm run build', 503));
    return root;
  }

  // serveStatic membaca path relatif terhadap working directory.
  root.use('/*', serveStatic({ root: relative(process.cwd(), distDir) }));
  const indexHtml = readFileSync(indexFile, 'utf8');
  root.get('*', (c) => c.html(indexHtml));
  return root;
}
