import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { slugTag } from './importer.js';

const SKIP_DIRS = new Set(['node_modules']);
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

export async function importDirectory(root, importer, { tags = [], maxBytes = DEFAULT_MAX_BYTES, onProgress } = {}) {
  const summary = { created: 0, skipped: 0, failed: [] };
  for (const file of walkFiles(root)) {
    const rel = relative(root, file);
    const folderTags = rel.split(sep).slice(0, -1).map(slugTag).filter(Boolean);
    try {
      if (statSync(file).size > maxBytes) throw new Error(`File terlalu besar (maks ${Math.round(maxBytes / 1024 / 1024)} MB)`);
      const result = await importer.importFile({ buffer: readFileSync(file), name: basename(file), tags: [...tags, ...folderTags] });
      summary[result.status]++;
      onProgress?.(rel, result.status);
    } catch (err) {
      summary.failed.push({ path: rel, error: err.message });
      onProgress?.(rel, 'failed');
    }
  }
  return summary;
}
