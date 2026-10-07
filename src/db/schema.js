// Tiap elemen = satu versi. Jangan ubah migrasi lama, tambah elemen baru.
export const MIGRATIONS = [
  `
  CREATE TABLE items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT    NOT NULL,
    title          TEXT    NOT NULL,
    content        TEXT    NOT NULL DEFAULT '',
    metadata       TEXT    NOT NULL DEFAULT '{}',
    file_name      TEXT,
    file_path      TEXT,
    file_mime      TEXT,
    file_size      INTEGER,
    source_hash    TEXT,
    extracted_text TEXT,
    ticket_id      INTEGER,
    pinned         INTEGER NOT NULL DEFAULT 0,
    archived       INTEGER NOT NULL DEFAULT 0,
    deleted_at     TEXT,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_items_type ON items(type);
  CREATE INDEX idx_items_ticket ON items(ticket_id);
  CREATE INDEX idx_items_deleted ON items(deleted_at);
  CREATE INDEX idx_items_source_hash ON items(source_hash);

  CREATE TABLE item_versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    metadata   TEXT    NOT NULL,
    tags       TEXT    NOT NULL DEFAULT '[]',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_item_versions_item ON item_versions(item_id, id);

  CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE item_tags (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE items_fts USING fts5(
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
  `
  CREATE TABLE account (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    kdf_salt          TEXT    NOT NULL,
    kdf_iterations    INTEGER NOT NULL,
    auth_hash         TEXT    NOT NULL,
    wrapped_vault_key TEXT    NOT NULL,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    device       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE item_links (
    a_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    b_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
  );
  CREATE INDEX idx_item_links_b ON item_links(b_id);

  CREATE TABLE collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    added_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (collection_id, item_id)
  );
  CREATE INDEX idx_collection_items_item ON collection_items(item_id);
  `,
];

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
