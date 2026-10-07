// Salin font standar, cmap, dan decoder wasm pdf.js ke web/public/pdfjs supaya pratinjau PDF jalan offline
// (dipakai untuk PDF dengan font yang tidak di-embed, teks CJK, dan gambar JPEG2000/JBIG2).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'pdfjs');

mkdirSync(target, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm']) {
  const source = join(pdfjsRoot, dir);
  if (existsSync(source)) cpSync(source, join(target, dir), { recursive: true });
}
console.log(`Aset pdf.js disalin ke ${target}`);
