// Sama dengan aturan backend (src/import/importer.js): .sql → Query, .md/.txt → Catatan, sisanya File.
const TEXT_IMPORT_MAX = 1_000_000;

export function detectImportKind(name, size) {
  const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  if (size > TEXT_IMPORT_MAX) return 'File';
  if (ext === '.sql') return 'Query';
  if (ext === '.md' || ext === '.txt') return 'Catatan';
  return 'File';
}

// Bagi file ke beberapa request supaya progres jalan dan tidak menabrak batas ukuran satu request.
export function chunkFiles(files, { maxCount = 20, maxBytes = 200 * 1024 * 1024 } = {}) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length && (current.length >= maxCount || bytes + file.size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// Tag dari subfolder (webkitRelativePath "Dokumen/SIMRS/Query/x.sql" → simrs, query), folder akar diabaikan.
export function folderTags(relativePath) {
  const parts = String(relativePath ?? '').split('/').slice(1, -1);
  return parts
    .map((part) => part.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}
