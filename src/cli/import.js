import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openContext } from './context.js';
import { importDirectory } from '../import/directory.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { tag: { type: 'string' }, bookmarks: { type: 'string' } },
});
const tags = values.tag ? values.tag.split(',') : [];

if (!positionals[0] && !values.bookmarks) {
  console.log('Pakai: npm run import -- <folder> [--tag a,b] [--bookmarks bookmarks.html]');
  process.exit(1);
}

const { importer, config } = openContext();

if (values.bookmarks) {
  const result = importer.importBookmarks(readFileSync(resolve(values.bookmarks), 'utf8'), { tags });
  console.log(`Bookmark: ${result.created} dibuat, ${result.skipped} dilewati`);
}

if (positionals[0]) {
  const root = resolve(positionals[0]);
  console.log(`Import folder ${root}`);
  const summary = await importDirectory(root, importer, {
    tags,
    maxBytes: config.maxImportBytes,
    onProgress: (path, status) => console.log(`  ${status.padEnd(7)} ${path}`),
  });
  console.log(`Selesai: ${summary.created} dibuat, ${summary.skipped} duplikat dilewati, ${summary.failed.length} gagal`);
  for (const failure of summary.failed) console.log(`  gagal  ${failure.path}: ${failure.error}`);
}
