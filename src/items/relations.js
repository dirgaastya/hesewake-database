import { NotFoundError, ValidationError } from '../errors.js';

const NAME_MAX = 80;

function cleanName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) throw new ValidationError('Nama koleksi wajib diisi');
  if (value.length > NAME_MAX) throw new ValidationError(`Nama koleksi maksimal ${NAME_MAX} karakter`);
  return value;
}

// Relasi antar item (tidak berarah) dan koleksi item lintas tipe.
export function createRelations(db) {
  const stmts = {
    itemExists: db.prepare('SELECT 1 FROM items WHERE id = ?'),
    link: db.prepare('INSERT OR IGNORE INTO item_links (a_id, b_id) VALUES (?, ?)'),
    unlink: db.prepare('DELETE FROM item_links WHERE a_id = ? AND b_id = ?'),
    linksOf: db.prepare(`
      SELECT i.id, i.type, i.title, i.deleted_at
      FROM item_links l
      JOIN items i ON i.id = CASE WHEN l.a_id = @id THEN l.b_id ELSE l.a_id END
      WHERE l.a_id = @id OR l.b_id = @id
      ORDER BY i.title COLLATE NOCASE
    `),
    collections: db.prepare(`
      SELECT c.id, c.name, c.created_at, COUNT(i.id) AS count
      FROM collections c
      LEFT JOIN collection_items ci ON ci.collection_id = c.id
      LEFT JOIN items i ON i.id = ci.item_id AND i.deleted_at IS NULL
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE
    `),
    collection: db.prepare('SELECT id, name, created_at FROM collections WHERE id = ?'),
    collectionByName: db.prepare('SELECT id FROM collections WHERE name = ?'),
    insertCollection: db.prepare('INSERT INTO collections (name) VALUES (?)'),
    renameCollection: db.prepare('UPDATE collections SET name = ? WHERE id = ?'),
    deleteCollection: db.prepare('DELETE FROM collections WHERE id = ?'),
    addItem: db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?, ?)'),
    removeItem: db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?'),
    collectionsOf: db.prepare(`
      SELECT c.id, c.name FROM collections c
      JOIN collection_items ci ON ci.collection_id = c.id
      WHERE ci.item_id = ?
      ORDER BY c.name COLLATE NOCASE
    `),
  };

  function requireItem(id) {
    if (!stmts.itemExists.get(id)) throw new NotFoundError(`Item ${id} tidak ditemukan`);
  }

  function requireCollection(id) {
    const row = stmts.collection.get(id);
    if (!row) throw new NotFoundError(`Koleksi ${id} tidak ditemukan`);
    return row;
  }

  function assertUniqueName(name, exceptId) {
    const existing = stmts.collectionByName.get(name);
    if (existing && existing.id !== exceptId) throw new ValidationError(`Koleksi "${name}" sudah ada`);
  }

  return {
    link(a, b) {
      if (a === b) throw new ValidationError('Item tidak bisa ditautkan ke dirinya sendiri');
      requireItem(a);
      requireItem(b);
      stmts.link.run(Math.min(a, b), Math.max(a, b));
    },

    unlink(a, b) {
      stmts.unlink.run(Math.min(a, b), Math.max(a, b));
    },

    linksOf(id) {
      requireItem(id);
      return stmts.linksOf.all({ id }).map((row) => ({ id: row.id, type: row.type, title: row.title, deletedAt: row.deleted_at }));
    },

    collections() {
      return stmts.collections.all().map((row) => ({ id: row.id, name: row.name, count: row.count, createdAt: row.created_at }));
    },

    createCollection(name) {
      const value = cleanName(name);
      assertUniqueName(value);
      const { lastInsertRowid } = stmts.insertCollection.run(value);
      return { id: Number(lastInsertRowid), name: value, count: 0 };
    },

    renameCollection(id, name) {
      requireCollection(id);
      const value = cleanName(name);
      assertUniqueName(value, id);
      stmts.renameCollection.run(value, id);
      return { id, name: value };
    },

    deleteCollection(id) {
      requireCollection(id);
      stmts.deleteCollection.run(id);
    },

    addToCollection(collectionId, itemId) {
      requireCollection(collectionId);
      requireItem(itemId);
      stmts.addItem.run(collectionId, itemId);
    },

    addManyToCollection(collectionId, itemIds) {
      requireCollection(collectionId);
      for (const itemId of itemIds) requireItem(itemId);
      db.transaction(() => {
        for (const itemId of itemIds) stmts.addItem.run(collectionId, itemId);
      })();
    },

    removeFromCollection(collectionId, itemId) {
      stmts.removeItem.run(collectionId, itemId);
    },

    collectionsOf(itemId) {
      requireItem(itemId);
      return stmts.collectionsOf.all(itemId);
    },
  };
}
