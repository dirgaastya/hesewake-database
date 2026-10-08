import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'desktop-runtime');
const copy = (from, to) => cpSync(resolve(root, from), resolve(output, to), { recursive: true });

if (!existsSync(resolve(root, 'web/dist/index.html'))) throw new Error('UI belum dibuild. Jalankan npm run build terlebih dahulu.');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const dir of ['src', 'web/dist', 'node_modules']) copy(dir, dir);
for (const file of ['package.json', 'package-lock.json']) copy(file, file);
const nodeResource = resolve(root, 'desktop-bin', 'node.exe');
mkdirSync(dirname(nodeResource), { recursive: true });
copyFileSync(process.execPath, nodeResource);
console.log(`Runtime desktop siap: ${output}`);
