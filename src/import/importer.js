import { createHash } from 'node:crypto';
import { extname, basename } from 'node:path';
import { extractText } from '../files/extract.js';

const TEXT_IMPORT_MAX = 1_000_000;
const TITLE_MAX = 200;
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.sql': 'application/sql',
  '.json': 'application/json',
  '.zip': 'application/zip',
};
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export function guessMime(name) {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function detectImportType(name, size) {
  if (size > TEXT_IMPORT_MAX) return 'file';
  const ext = extname(name).toLowerCase();
  if (ext === '.sql') return 'query';
  if (ext === '.md' || ext === '.txt') return 'note';
  return 'file';
}

export function slugTag(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]).trim();

// Format Netscape: <H3> = nama folder, <DL> berikutnya = isi folder itu, </DL> = keluar folder.
export function parseBookmarksHtml(html) {
  const bookmarks = [];
  const stack = [];
  let pendingFolder = null;
  const pattern = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s[^>]*?HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<(\/?)DL\b[^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) {
      pendingFolder = decode(match[1]);
    } else if (match[2] !== undefined) {
      bookmarks.push({ url: decode(match[2]), title: decode(match[3].replace(/<[^>]+>/g, '')), folders: stack.filter(Boolean) });
    } else if (match[4] === '/') {
      stack.pop();
    } else {
      stack.push(pendingFolder);
      pendingFolder = null;
    }
  }
  return bookmarks;
}

export function createImporter({ repo, storage }) {
  async function importFile({ buffer, name, mime = '', tags = [] }) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existing = repo.findBySourceHash(hash);
    if (existing) return { status: 'skipped', item: existing };

    const type = detectImportType(name, buffer.length);
    if (type !== 'file') {
      const item = repo.create(
        {
          type,
          title: (basename(name, extname(name)) || name).slice(0, TITLE_MAX),
          content: buffer.toString('utf8'),
          metadata: type === 'query' ? { language: 'sql' } : {},
          tags,
        },
        { sourceHash: hash },
      );
      return { status: 'created', item };
    }

    const fileMime = mime && mime !== 'application/octet-stream' ? mime : guessMime(name);
    const stored = storage.save(buffer, name);
    try {
      const item = repo.create(
        { type: 'file', title: name.slice(0, TITLE_MAX), tags },
        {
          file: {
            name,
            mime: fileMime,
            size: stored.size,
            path: stored.path,
            hash: stored.hash,
            extractedText: await extractText(buffer, { mime: fileMime, name }),
          },
        },
      );
      return { status: 'created', item };
    } catch (err) {
      storage.remove(stored.path);
      throw err;
    }
  }

  function importBookmarks(html, { tags = [] } = {}) {
    let created = 0;
    let skipped = 0;
    for (const bookmark of parseBookmarksHtml(html)) {
      let url;
      try {
        url = new URL(bookmark.url);
      } catch {
        skipped++;
        continue;
      }
      if (!['http:', 'https:'].includes(url.protocol) || repo.findLinkByUrl(url.href)) {
        skipped++;
        continue;
      }
      repo.create({
        type: 'link',
        title: (bookmark.title || url.hostname).slice(0, TITLE_MAX),
        metadata: { url: url.href },
        tags: [...tags, ...bookmark.folders.map(slugTag).filter(Boolean)],
      });
      created++;
    }
    return { created, skipped };
  }

  return { importFile, importBookmarks };
}
