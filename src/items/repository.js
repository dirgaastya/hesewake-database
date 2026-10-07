import { TYPES, validateItem } from './types.js';
import { NotFoundError, ValidationError } from '../errors.js';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_VERSIONS = 50;

export function createItemRepository(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO items (type, title, content, metadata, file_name, file_path, file_mime, file_size, source_hash, extracted_text, ticket_id, pinned, archived)
      VALUES (@type, @title, @content, @metadata, @fileName, @filePath, @fileMime, @fileSize, @sourceHash, @extractedText, @ticketId, @pinned, @archived)
    `),
    get: db.prepare('SELECT * FROM items WHERE id = ?'),
    all: db.prepare('SELECT * FROM items ORDER BY id'),
    update: db.prepare(`
      UPDATE items
      SET title = @title, content = @content, metadata = @metadata, ticket_id = @ticketId,
          pinned = @pinned, archived = @archived, updated_at = ${NOW}
      WHERE id = @id
    `),
    trash: db.prepare(`UPDATE items SET deleted_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`),
    restore: db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?'),
    delete: db.prepare('DELETE FROM items WHERE id = ?'),
    expired: db.prepare('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY id'),
    bySourceHash: db.prepare('SELECT * FROM items WHERE source_hash = ? ORDER BY id LIMIT 1'),
    linkByUrl: db.prepare(`SELECT * FROM items WHERE type = 'link' AND json_extract(metadata, '$.url') = ? ORDER BY id LIMIT 1`),
    insertVersion: db.prepare('INSERT INTO item_versions (item_id, title, content, metadata, tags) VALUES (?, ?, ?, ?, ?)'),
    pruneVersions: db.prepare(`
      DELETE FROM item_versions
      WHERE item_id = ? AND id NOT IN (SELECT id FROM item_versions WHERE item_id = ? ORDER BY id DESC LIMIT ${MAX_VERSIONS})
    `),
    versions: db.prepare('SELECT * FROM item_versions WHERE item_id = ? ORDER BY id DESC'),
    version: db.prepare('SELECT * FROM item_versions WHERE id = ? AND item_id = ?'),
    tagsOf: db.prepare(`
      SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id = t.id
      WHERE it.item_id = ? ORDER BY t.name
    `),
    upsertTag: db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING'),
    tagId: db.prepare('SELECT id FROM tags WHERE name = ?'),
    clearTags: db.prepare('DELETE FROM item_tags WHERE item_id = ?'),
    linkTag: db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)'),
    pruneTags: db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)'),
    tagCounts: db.prepare(`
      SELECT t.name AS name, COUNT(*) AS count
      FROM tags t
      JOIN item_tags it ON it.tag_id = t.id
      JOIN items i ON i.id = it.item_id
      WHERE i.deleted_at IS NULL
      GROUP BY t.id ORDER BY t.name
    `),
    ftsDelete: db.prepare('DELETE FROM items_fts WHERE rowid = ?'),
    ftsInsert: db.prepare('INSERT INTO items_fts (rowid, title, body) VALUES (?, ?, ?)'),
  };

  function tagsOf(id) {
    return stmts.tagsOf.all(id).map((r) => r.name);
  }

  function setTags(id, tags) {
    stmts.clearTags.run(id);
    for (const name of tags) {
      stmts.upsertTag.run(name);
      stmts.linkTag.run(id, stmts.tagId.get(name).id);
    }
    stmts.pruneTags.run();
  }

  // Index FTS diisi manual (bukan trigger) supaya ciphertext secret tidak pernah ikut ter-index.
  function reindex(id) {
    const row = stmts.get.get(id);
    const tags = tagsOf(id).join(' ');
    const body = TYPES[row.type].encrypted
      ? tags
      : [row.content, ...Object.values(JSON.parse(row.metadata)), row.extracted_text ?? '', tags].join('\n');
    stmts.ftsDelete.run(id);
    stmts.ftsInsert.run(id, row.title, body);
  }

  function findRow(id) {
    const row = stmts.get.get(id);
    if (!row) throw new NotFoundError(`Item ${id} tidak ditemukan`);
    return row;
  }

  function toItem(row, { full = false } = {}) {
    const encrypted = TYPES[row.type].encrypted === true;
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: encrypted && !full ? null : row.content,
      encrypted,
      metadata: JSON.parse(row.metadata),
      file: row.file_path
        ? { name: row.file_name, mime: row.file_mime, size: row.file_size, path: row.file_path }
        : null,
      ticketId: row.ticket_id,
      pinned: row.pinned === 1,
      archived: row.archived === 1,
      deletedAt: row.deleted_at,
      tags: tagsOf(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function create(input, { file, sourceHash } = {}) {
    const item = validateItem(input);
    const def = TYPES[item.type];
    if (def.requiresFile && !file) throw new ValidationError('Tipe file wajib upload file');
    if (!def.requiresFile && file) throw new ValidationError(`Tipe ${item.type} tidak menerima file`);

    const id = db.transaction(() => {
      const { lastInsertRowid } = stmts.insert.run({
        type: item.type,
        title: item.title,
        content: item.content,
        metadata: JSON.stringify(item.metadata),
        fileName: file?.name ?? null,
        filePath: file?.path ?? null,
        fileMime: file?.mime ?? null,
        fileSize: file?.size ?? null,
        sourceHash: file?.hash ?? sourceHash ?? null,
        extractedText: file?.extractedText ?? null,
        ticketId: item.ticketId,
        pinned: item.pinned ? 1 : 0,
        archived: item.archived ? 1 : 0,
      });
      const newId = Number(lastInsertRowid);
      setTags(newId, item.tags);
      reindex(newId);
      return newId;
    })();
    return get(id);
  }

  function get(id) {
    return toItem(findRow(id), { full: true });
  }

  function update(id, patch) {
    const row = findRow(id);
    if (row.deleted_at) throw new ValidationError('Item ada di trash, restore dulu sebelum diedit');
    if (patch.type !== undefined && patch.type !== row.type) throw new ValidationError('type tidak bisa diubah');
    const current = toItem(row, { full: true });
    const merged = validateItem({ ...current, ...patch, type: row.type });

    const changed =
      merged.title !== current.title ||
      merged.content !== current.content ||
      JSON.stringify(merged.metadata) !== JSON.stringify(current.metadata) ||
      (patch.tags !== undefined && JSON.stringify([...merged.tags].sort()) !== JSON.stringify(current.tags));

    db.transaction(() => {
      if (changed) {
        stmts.insertVersion.run(id, row.title, row.content, row.metadata, JSON.stringify(current.tags));
        stmts.pruneVersions.run(id, id);
      }
      stmts.update.run({
        id,
        title: merged.title,
        content: merged.content,
        metadata: JSON.stringify(merged.metadata),
        ticketId: merged.ticketId,
        pinned: merged.pinned ? 1 : 0,
        archived: merged.archived ? 1 : 0,
      });
      if (patch.tags !== undefined) setTags(id, merged.tags);
      reindex(id);
    })();
    return get(id);
  }

  function versions(id) {
    findRow(id);
    return stmts.versions.all(id).map((v) => ({
      id: v.id,
      title: v.title,
      content: v.content,
      metadata: JSON.parse(v.metadata),
      tags: JSON.parse(v.tags),
      createdAt: v.created_at,
    }));
  }

  function restoreVersion(id, versionId) {
    const version = stmts.version.get(versionId, id);
    if (!version) throw new NotFoundError(`Versi ${versionId} tidak ditemukan`);
    return update(id, {
      title: version.title,
      content: version.content,
      metadata: JSON.parse(version.metadata),
      tags: JSON.parse(version.tags),
    });
  }

  function trash(id) {
    findRow(id);
    stmts.trash.run(id);
    return get(id);
  }

  function restore(id) {
    findRow(id);
    stmts.restore.run(id);
    return get(id);
  }

  function purge(id) {
    const row = findRow(id);
    if (!row.deleted_at) throw new ValidationError('Pindahkan ke trash dulu sebelum hapus permanen');
    const item = toItem(row, { full: true });
    db.transaction(() => {
      stmts.ftsDelete.run(id);
      stmts.delete.run(id);
      stmts.pruneTags.run();
    })();
    return item;
  }

  function purgeExpired({ days, now = new Date() }) {
    const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
    return stmts.expired.all(cutoff).map(({ id }) => purge(id));
  }

  function findBySourceHash(hash) {
    const row = stmts.bySourceHash.get(hash);
    return row ? toItem(row) : null;
  }

  function findLinkByUrl(url) {
    const row = stmts.linkByUrl.get(url);
    return row ? toItem(row) : null;
  }

  function all() {
    return stmts.all.all().map((row) => toItem(row, { full: true }));
  }

  function tags() {
    return stmts.tagCounts.all();
  }

  return { create, get, update, versions, restoreVersion, trash, restore, purge, purgeExpired, findBySourceHash, findLinkByUrl, all, tags };
}
