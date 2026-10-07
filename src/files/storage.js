import { mkdirSync, writeFileSync, createReadStream, rmSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ValidationError } from '../errors.js';

export function createFileStorage(rootDir) {
  const root = resolve(rootDir);

  function absolutePath(relPath) {
    const abs = resolve(root, relPath);
    if (!abs.startsWith(root + sep)) throw new ValidationError('Path file tidak valid');
    return abs;
  }

  return {
    absolutePath,

    save(buffer, originalName, now = new Date()) {
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const relPath = `${now.getFullYear()}/${month}/${randomUUID()}${extname(originalName).toLowerCase()}`;
      const abs = absolutePath(relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, buffer);
      return { path: relPath, size: buffer.length, hash: createHash('sha256').update(buffer).digest('hex') };
    },

    openReadStream: (relPath) => createReadStream(absolutePath(relPath)),

    remove(relPath) {
      rmSync(absolutePath(relPath), { force: true });
    },
  };
}
