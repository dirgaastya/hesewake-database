import { mkdirSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { createItemRepository } from '../items/repository.js';
import { createFileStorage } from '../files/storage.js';
import { createImporter } from '../import/importer.js';
import { createRelations } from '../items/relations.js';

export function openContext(config = loadConfig()) {
  mkdirSync(config.filesDir, { recursive: true });
  const db = openDb(config.dbFile);
  const repo = createItemRepository(db);
  const storage = createFileStorage(config.filesDir);
  return { config, db, repo, storage, relations: createRelations(db), importer: createImporter({ repo, storage }) };
}
