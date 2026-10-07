import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugTag } from '../import/importer.js';

const CODE_TYPES = new Set(['query', 'command', 'config', 'api_request', 'schema']);

const padId = (id) => String(id).padStart(4, '0');
const safeFileName = (name) => name.replace(/[\\/:*?"<>|]/g, '_');

function toMarkdown(item) {
  const lines = [`# ${item.title}`, '', `- Tipe: ${item.type}`];
  if (item.tags.length) lines.push(`- Tag: ${item.tags.join(', ')}`);
  if (item.ticketId) lines.push(`- Tiket: ${item.ticketId}`);
  for (const [key, value] of Object.entries(item.metadata)) lines.push(`- ${key}: ${value}`);
  if (item.file) lines.push(`- File: ${padId(item.id)}-${safeFileName(item.file.name)}`);
  lines.push(`- Dibuat: ${item.createdAt}`, `- Diubah: ${item.updatedAt}`, '');

  if (item.encrypted) {
    lines.push('_Isi secret terenkripsi. Buka lewat aplikasi atau baca ciphertext di items.json._');
  } else if (CODE_TYPES.has(item.type)) {
    lines.push('```' + (item.metadata.language ?? ''), item.content, '```');
  } else if (item.content) {
    lines.push(item.content);
  }
  return lines.join('\n') + '\n';
}

export function exportAll({ repo, storage, outDir }) {
  const items = repo.all();
  mkdirSync(join(outDir, 'items'), { recursive: true });
  mkdirSync(join(outDir, 'files'), { recursive: true });
  writeFileSync(join(outDir, 'items.json'), JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2));

  for (const item of items) {
    const slug = slugTag(item.title).slice(0, 60) || 'item';
    writeFileSync(join(outDir, 'items', `${padId(item.id)}-${slug}.md`), toMarkdown(item));
    if (item.file) {
      copyFileSync(storage.absolutePath(item.file.path), join(outDir, 'files', `${padId(item.id)}-${safeFileName(item.file.name)}`));
    }
  }
  return { items: items.length };
}
