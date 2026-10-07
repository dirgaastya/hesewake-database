import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { TYPES } from '../items/types.js';
import { extractText } from '../files/extract.js';
import { fetchLinkPreview } from '../links/preview.js';
import { AppError, NotFoundError, ValidationError } from '../errors.js';

const MB = 1024 * 1024;

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
  linkPreview = fetchLinkPreview,
  maxUploadBytes = 100 * MB,
  maxImportBytes = 1024 * MB,
}) {
  const app = new Hono().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

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
    return c.body(Readable.toWeb(storage.openReadStream(item.file.path)), 200, {
      'Content-Type': item.file.mime,
      'Content-Length': String(item.file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.file.name)}`,
    });
  });

  app.post('/import/files', sizeLimit(maxImportBytes), async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = [form.files ?? []].flat().filter((f) => f instanceof File);
    if (!files.length) throw new ValidationError('Pilih minimal satu file');
    const tags = parseTags([form.tags ?? ''].flat()[0]);

    const summary = { created: 0, skipped: 0, failed: [], itemIds: [] };
    for (const file of files) {
      try {
        const result = await importer.importFile({ buffer: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type, tags });
        summary[result.status]++;
        if (result.status === 'created') summary.itemIds.push(result.item.id);
      } catch (err) {
        summary.failed.push({ path: file.name, error: err.message });
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
