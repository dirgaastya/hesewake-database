import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { TYPES } from '../items/types.js';
import { extractText } from '../files/extract.js';
import { fetchLinkPreview } from '../links/preview.js';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { hostGuard, originGuard, securityHeaders, createRateLimiter, clientKey, requestHost } from './security.js';
import { AppError, AuthError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';

const MB = 1024 * 1024;
const SESSION_COOKIE = 'hdb_session';
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;
const PUBLIC_PATHS = new Set(['/api/auth/status', '/api/auth/params', '/api/auth/setup', '/api/auth/login']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function setSessionCookie(c, { token, expiresAt }) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
  });
}

function parseOptionalInt(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${name} harus bilangan bulat`);
  return n;
}

const parseFlag = (value) => value === '1' || value === 'true';
const parseTags = (value) => (value ? String(value).split(',') : []);

function parseId(c, param = 'id') {
  const id = parseOptionalInt(c.req.param(param), param);
  if (!id) throw new ValidationError(`${param} tidak valid`);
  return id;
}

async function readJson(c) {
  let body;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('Body harus JSON valid');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Body harus object');
  return body;
}

function sizeLimit(maxBytes) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => c.json({ error: `File terlalu besar (maks ${Math.round(maxBytes / MB) || 1} MB)` }, 413),
  });
}

export function createApp({
  repo,
  storage,
  importer,
  auth,
  allowedHosts,
  rateLimiter = createRateLimiter(),
  linkPreview = fetchLinkPreview,
  maxUploadBytes = 100 * MB,
  maxImportBytes = 1024 * MB,
}) {
  if (auth === undefined) throw new Error('createApp: opsi auth wajib (auth: false hanya untuk test)');
  const app = new Hono().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // PDF yang dibuka inline butuh plugin viewer browser; CSP object-src 'none' akan memblokirnya.
  const headers = securityHeaders();
  app.use('*', async (c, next) => {
    await headers(c, next);
    if (c.res.headers.get('content-disposition')?.startsWith('inline;')) c.res.headers.delete('content-security-policy');
  });
  if (allowedHosts) app.use('*', hostGuard(allowedHosts), originGuard(allowedHosts));

  if (auth) {
    app.use('*', async (c, next) => {
      if (PUBLIC_PATHS.has(c.req.path)) return next();
      const session = auth.verifySession(getCookie(c, SESSION_COOKIE));
      if (!session) throw new AuthError();
      c.set('session', session);
      await next();
    });

    app.get('/auth/status', (c) =>
      c.json({ hasAccount: auth.hasAccount(), authenticated: Boolean(auth.verifySession(getCookie(c, SESSION_COOKIE))) }),
    );

    app.get('/auth/params', (c) => {
      const params = auth.params();
      if (!params) throw new NotFoundError('Akun belum dibuat');
      return c.json(params);
    });

    app.post('/auth/setup', async (c) => {
      const hostname = requestHost(c).split(':')[0];
      if (!LOCAL_HOSTS.has(hostname)) throw new ForbiddenError('Buat akun dari laptop server lewat http://127.0.0.1');
      setSessionCookie(c, auth.setup(await readJson(c)));
      return c.json({ ok: true }, 201);
    });

    app.post('/auth/login', async (c) => {
      const key = clientKey(c);
      rateLimiter.check(key);
      const body = await readJson(c);
      try {
        const session = auth.login(body);
        rateLimiter.reset(key);
        setSessionCookie(c, session);
        return c.json({ wrappedVaultKey: auth.wrappedVaultKey() });
      } catch (err) {
        if (err instanceof AuthError) rateLimiter.fail(key);
        throw err;
      }
    });

    app.post('/auth/logout', (c) => {
      auth.logout(getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
      return c.body(null, 204);
    });

    app.get('/auth/vault-key', (c) => c.json({ wrappedVaultKey: auth.wrappedVaultKey() }));
    app.get('/auth/sessions', (c) => c.json(auth.sessions(c.get('session').id)));
    app.delete('/auth/sessions/:id', (c) => {
      auth.revokeSession(c.req.param('id'));
      return c.body(null, 204);
    });
    app.post('/auth/password', async (c) => {
      auth.changePassword(await readJson(c), { keepSessionId: c.get('session').id });
      return c.json({ ok: true });
    });
  }

  app.get('/types', (c) => c.json(TYPES));
  app.get('/tags', (c) => c.json(repo.tags()));

  app.get('/items', (c) => {
    const q = c.req.query();
    const filters = {
      type: q.type || undefined,
      tag: q.tag || undefined,
      ticketId: parseOptionalInt(q.ticket, 'ticket'),
      archived: parseFlag(q.archived),
      trashed: parseFlag(q.trashed),
      pinned: q.pinned ? parseFlag(q.pinned) : undefined,
      limit: parseOptionalInt(q.limit, 'limit') ?? 50,
      offset: parseOptionalInt(q.offset, 'offset') ?? 0,
    };
    return c.json(q.q ? repo.search(q.q, filters) : repo.list(filters));
  });

  app.get('/items/:id', (c) => c.json(repo.get(parseId(c))));

  app.post('/items', async (c) => {
    const body = await readJson(c);
    if (body.type === 'file') throw new ValidationError('Upload file lewat POST /api/files');
    return c.json(repo.create(body), 201);
  });

  app.patch('/items/:id', async (c) => c.json(repo.update(parseId(c), await readJson(c))));

  app.delete('/items/:id', (c) => {
    const id = parseId(c);
    if (parseFlag(c.req.query('permanent'))) {
      const item = repo.purge(id);
      if (item.file) storage.remove(item.file.path);
    } else {
      repo.trash(id);
    }
    return c.body(null, 204);
  });

  app.post('/items/:id/restore', (c) => c.json(repo.restore(parseId(c))));
  app.get('/items/:id/versions', (c) => c.json(repo.versions(parseId(c))));
  app.post('/items/:id/versions/:versionId/restore', (c) => c.json(repo.restoreVersion(parseId(c), parseId(c, 'versionId'))));

  app.post('/files', sizeLimit(maxUploadBytes), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ValidationError('Field "file" wajib diisi');

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const stored = storage.save(buffer, file.name);
    try {
      const item = repo.create(
        {
          type: 'file',
          title: form.title || file.name,
          content: form.content || '',
          tags: parseTags(form.tags),
          ticketId: parseOptionalInt(form.ticketId, 'ticketId'),
        },
        {
          file: {
            name: file.name,
            mime,
            size: stored.size,
            path: stored.path,
            hash: stored.hash,
            extractedText: await extractText(buffer, { mime, name: file.name }),
          },
        },
      );
      return c.json(item, 201);
    } catch (err) {
      storage.remove(stored.path);
      throw err;
    }
  });

  app.get('/items/:id/download', (c) => {
    const item = repo.get(parseId(c));
    if (!item.file) throw new NotFoundError('Item ini tidak punya file');
    // Tampil di browser hanya untuk tipe yang tidak bisa menjalankan script (bukan SVG/HTML).
    const inline = parseFlag(c.req.query('inline')) && INLINE_MIME.test(item.file.mime);
    return c.body(Readable.toWeb(storage.openReadStream(item.file.path)), 200, {
      'Content-Type': item.file.mime,
      'Content-Length': String(item.file.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(item.file.name)}`,
    });
  });

  app.post('/import/files', sizeLimit(maxImportBytes), async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = [form.files ?? []].flat().filter((f) => f instanceof File);
    if (!files.length) throw new ValidationError('Pilih minimal satu file');
    const tags = parseTags([form.tags ?? ''].flat()[0]);

    const summary = { created: 0, skipped: 0, failed: [], itemIds: [], results: [] };
    for (const file of files) {
      try {
        const result = await importer.importFile({ buffer: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type, tags });
        summary[result.status]++;
        if (result.status === 'created') summary.itemIds.push(result.item.id);
        summary.results.push({ name: file.name, status: result.status, itemId: result.item.id, type: result.item.type });
      } catch (err) {
        summary.failed.push({ path: file.name, error: err.message });
        summary.results.push({ name: file.name, status: 'failed', error: err.message });
      }
    }
    return c.json(summary);
  });

  app.post('/import/bookmarks', sizeLimit(maxUploadBytes), async (c) => {
    const form = await c.req.parseBody();
    if (!(form.file instanceof File)) throw new ValidationError('Field "file" wajib diisi (hasil export bookmark browser)');
    return c.json(importer.importBookmarks(await form.file.text(), { tags: parseTags(form.tags) }));
  });

  app.get('/link-preview', async (c) => {
    const url = c.req.query('url');
    if (!url) throw new ValidationError('Query url wajib diisi');
    return c.json(await linkPreview(url));
  });

  return app;
}
