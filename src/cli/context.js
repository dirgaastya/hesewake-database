import { mkdirSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { createItemRepository } from '../items/repository.js';
import { createFileStorage } from '../files/storage.js';
import { createImporter } from '../import/importer.js';
import { createRelations } from '../items/relations.js';
import { createOcr } from '../files/ocr.js';

export function openContext(config = loadConfig(), env) {
  if (env) config = loadConfig(env);
  mkdirSync(config.filesDir, { recursive: true });
  const db = openDb(config.dbFile);
  const repo = createItemRepository(db);
  const storage = createFileStorage(config.filesDir);
  // Worker OCR baru dibuat saat gambar pertama diproses.
  const ocr = config.ocr ? createOcr({ cacheDir: config.ocrCacheDir }) : null;
  return { config, db, repo, storage, ocr, relations: createRelations(db), importer: createImporter({ repo, storage, ocr }) };
}
