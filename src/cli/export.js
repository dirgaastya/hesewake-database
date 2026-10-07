import { resolve } from 'node:path';
import { openContext } from './context.js';
import { exportAll } from '../backup/export.js';

const target = process.argv[2];
if (!target) {
  console.log('Pakai: npm run export -- <folder tujuan>');
  process.exit(1);
}

const { repo, storage } = openContext();
const outDir = resolve(target);
const result = exportAll({ repo, storage, outDir });
console.log(`Export ${result.items} item ke ${outDir}`);
