# hesewake-database Core (Fase 1, Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend lokal untuk menyimpan semua jenis item kerjaan (file/PDF/Word/Excel, catatan, query, URL, command, API request, error & solusi, secret terenkripsi, dll) dengan tag, full-text search, riwayat versi, arsip, trash, preview link, import massal, backup harian, dan export, diekspos lewat REST API.

**Architecture:** Satu tabel `items` dengan kolom `type` + `metadata` (JSON); registry tipe (`src/items/types.js`) jadi satu-satunya sumber aturan validasi. Pencarian pakai SQLite FTS5 yang diisi manual oleh repository. Secret **dienkripsi di browser** (Plan 2): server hanya menyimpan ciphertext `v1.<iv>.<data>` dan tidak pernah memegang kunci. Setiap edit menyimpan snapshot ke `item_versions`. File fisik disimpan di folder data dengan hash SHA-256 untuk deteksi duplikat saat import. Backup harian memakai `VACUUM INTO` + salinan folder file.

**Tech Stack:** Node.js >= 22 (ESM), `better-sqlite3`, `hono` + `@hono/node-server`, `unpdf` (PDF), `mammoth` (docx), `exceljs` (xlsx), `node:test`. Dev: `pdf-lib`, `docx` (bikin fixture test).

## Roadmap

> **Status 2026-10-07:** semua fase selesai. Fase 2: `2026-10-07-hesewake-database-web-ui.md`, Fase 3: `2026-10-07-hesewake-database-cli-odoo.md`, Fase 4: `2026-10-07-hesewake-database-extra.md`.

| Fase | Isi | Plan |
|---|---|---|
| **1. Backend** | **Plan 1 (dokumen ini):** data, tipe, tag, search, versi, arsip, trash, preview link, import massal, backup, export, REST API | `2026-10-07-hesewake-database-core.md` |
| | **Plan 2:** akun + sesi, enkripsi secret di browser, keamanan HTTP (Host/Origin/header/rate limit), akses dari perangkat lain via Tailscale | `2026-10-07-hesewake-database-auth.md` |
| 2. Web UI | React + Vite + Tailwind, mengikuti design system | plan terpisah |
| 3. CLI + integrasi | `hdb search/add/copy`, integrasi `hesewake-cli` (item per tiket Odoo) | plan terpisah |
| 4. Extra | Relasi antar item, OCR screenshot, koleksi | plan terpisah |

Plan 2 dikerjakan **sebelum** server dibuka ke Tailscale. Selama Plan 1 saja, server hanya listen di `127.0.0.1`.

**Fitur UI Fase 2 yang sudah disepakati** (referensi: Karakeep, massCode, Bitwarden, navigasi Obsidian):

| Area | Fitur | Endpoint yang dipakai |
|---|---|---|
| Navigasi | Quick switcher (Ctrl+K), command palette (Ctrl+Shift+P), shortcut keyboard (`/`, `n`, `e`), operator search (`type:` `tag:` `ticket:`), sidebar recent + pinned | `GET /api/items?q=` |
| Tambah cepat | Paste di mana saja → tipe ditebak (URL → link + preview, teks `SELECT` → query, file → upload), drag-and-drop file | `POST /api/items`, `POST /api/files`, `GET /api/link-preview` |
| List item | Grid/list/compact view, favorit (pinned) + arsip, bulk action | `PATCH /api/items/:id`, `?archived=1` |
| Query/command | Syntax highlight, copy 1 klik, format SQL/kode, preview markdown + Mermaid, placeholder `{{variabel}}` diisi sebelum copy | - |
| Riwayat | Daftar versi item + kembalikan versi | `GET /api/items/:id/versions`, `POST …/restore` |
| Secret | Masked + tombol lihat/copy, clipboard auto-clear 30 detik (best effort), password generator, auto-lock vault di browser | Plan 2 |
| Import | Halaman import: drop banyak file/folder, import bookmark browser, laporan hasil | `POST /api/import/files`, `POST /api/import/bookmarks` |
| Lain | Halaman trash + restore | `POST /api/items/:id/restore`, `?trashed=1` |

**Keputusan desain Fase 2** (design system lengkap: https://claude.ai/artifact/65tE6KrCyvfoMsXsrSemkt — sumber utama aturan komponen, spasi, radius, state, dan motion; preview palet awal: https://claude.ai/artifact/VKNDXPS1LzvXiKzcf5adFj):

- Aksen **indigo**, netral **zinc**, mode light + dark (default ikut OS, ada toggle).
- Font **Inter** (UI) + **JetBrains Mono** (kode), self-host via `@fontsource-variable/inter` dan `@fontsource-variable/jetbrains-mono`.
- Tema editor kode: GitHub Light/Dark (`@uiw/codemirror-theme-github`). Animasi: library `motion` dengan preset spring di design system.
- Komponen hanya pakai token semantik (`bg-surface`, `text-fg-muted`, `bg-accent`), tidak pakai nama warna Tailwind langsung, kecuali badge tipe item.

## Daftar tipe item

| type | Label | Metadata (`*` = wajib) | Catatan |
|---|---|---|---|
| `note` | Catatan | - | |
| `idea` | Ide / TODO | `status` (open/done) | |
| `learning` | Learning | `source` | |
| `meeting` | Meeting | `date`, `participants` | |
| `template` | Template | - | |
| `sop` | Prosedur / SOP | - | |
| `query` | Query | `language`*, `database` | |
| `command` | Command | `shell` | |
| `config` | Config / Env | `format` | |
| `link` | Link | `url`*, `description`, `image` | |
| `api_request` | API Request | `method`* (GET/POST/PUT/PATCH/DELETE), `url`*, `headers`, `body` | |
| `error_solution` | Error & Solusi | `error_message`*, `cause` | `content` = solusi |
| `schema` | Skema Tabel | `database`, `table`* | |
| `worklog` | Log Kerja | `branch` | wajib `ticketId` |
| `contact` | Kontak / PIC | `role`, `organization`, `phone`, `email` | |
| `server` | Server / Environment | `host`*, `port`, `environment` (dev/staging/prod) | password masuk `secret` |
| `file` | File | - | PDF, docx, xlsx, gambar, video, CSV; dibedakan lewat `mime` |
| `secret` | Secret | `username`, `url` | `content` = ciphertext dari browser, tidak masuk search |

Semua item punya: `title`, `content`, `metadata`, `tags`, `ticketId`, `pinned`, `archived`, `deletedAt`, `encrypted`.

## Global Constraints

- Node.js `>= 22`, `"type": "module"` (ESM), tanpa TypeScript.
- Server listen di `127.0.0.1` saja. Akses dari perangkat lain hanya lewat `tailscale serve` (Plan 2).
- Server **tidak pernah** melihat isi secret atau master password. `content` secret wajib cocok `CIPHERTEXT_PATTERN`, tidak masuk `items_fts`, dan tidak keluar dari `list()`/`search()`.
- Item di trash dihapus permanen setelah **30 hari** (`HDB_TRASH_DAYS`). Item arsip dan trash tidak muncul di list/search default.
- Riwayat versi maksimal **50** per item.
- Backup harian, simpan **7** salinan DB terakhir (`HDB_BACKUP_KEEP`), lokasi `HDB_BACKUP_DIR` (default `<dataDir>/backups`; sebaiknya diarahkan ke folder OneDrive/Google Drive).
- Batas upload satu file **100 MB** (`HDB_MAX_UPLOAD_MB`), batas satu request import **1024 MB** (`HDB_MAX_IMPORT_MB`). Download file di-stream, tidak dibaca utuh ke memori.
- Data default di `~/.hesewake-database/` (`HDB_DATA_DIR`). Port default `4321` (`HDB_PORT`).
- Pesan error untuk user dalam Bahasa Indonesia; identifier kode dalam bahasa Inggris.
- Test pakai `node:test` (`npm test`), DB test `:memory:`, file test di `os.tmpdir()`, test tidak boleh akses internet.

## File Structure

```
hesewake-database/
├─ package.json · .gitignore · README.md
├─ src/
│  ├─ errors.js              # AppError + subclass dengan HTTP status
│  ├─ config.js              # path, port, batas upload, backup, trash
│  ├─ server.js              # entry point: wiring, serve, job harian (trash + backup)
│  ├─ db/schema.js           # migrasi berbasis PRAGMA user_version
│  ├─ db/connection.js       # openDb(file)
│  ├─ items/types.js         # TYPES, validateItem, normalizeTags, CIPHERTEXT_PATTERN
│  ├─ items/repository.js    # CRUD, tag, trash, versi, FTS, list, search, lookup
│  ├─ files/storage.js       # simpan (dengan hash) / stream / hapus file
│  ├─ files/extract.js       # teks dari PDF, docx, xlsx, file teks
│  ├─ links/preview.js       # title/description/og:image dari URL
│  ├─ import/importer.js     # import 1 file, bookmark HTML, deteksi tipe
│  ├─ import/directory.js    # import satu folder rekursif
│  ├─ backup/backup.js       # VACUUM INTO + salin file + retensi
│  ├─ backup/export.js       # export JSON + Markdown + file asli
│  ├─ api/app.js             # Hono app (semua route /api/*)
│  └─ cli/                   # context.js, import.js, export.js, backup.js
└─ test/
   ├─ db · types · repository · search · files · link-preview · importer · backup · api · config (.test.js)
```

---

### Task 1: Scaffold project + database schema

**Files:**
- Create: `package.json`, `.gitignore`, `src/errors.js`, `src/db/schema.js`, `src/db/connection.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces:
  - `openDb(file = ':memory:') → Database` (sudah migrate, `foreign_keys = ON`)
  - `migrate(db) → void` (idempoten). Plan 2 menambah elemen kedua ke `MIGRATIONS`.
  - Error classes: `AppError(message, status)`, `ValidationError` (400), `AuthError` (401), `ForbiddenError` (403), `NotFoundError` (404), `TooManyRequestsError` (429)
  - Tabel: `items` (termasuk `source_hash`, `archived`, `deleted_at`), `item_versions`, `tags`, `item_tags`, `settings`, `items_fts`

- [ ] **Step 1: Init project**

```bash
cd C:/Users/ThinkPad/Desktop/project/personal/hesewake-database
git init
npm init -y
npm install better-sqlite3
```

Kalau `npm install better-sqlite3` gagal compile di Windows, install "Visual Studio Build Tools" (workload C++) atau pindah ke Node 22 LTS.

Timpa `package.json` (pertahankan blok `dependencies` hasil install):

```json
{
  "name": "hesewake-database",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "better-sqlite3": "<versi hasil npm install>"
  }
}
```

`.gitignore`:

```
node_modules/
data/
*.db
```

- [ ] **Step 2: Tulis failing test**

`test/db.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/schema.js';

test('openDb membuat semua tabel dan set user_version', () => {
  const db = openDb();
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
  for (const table of ['items', 'item_versions', 'tags', 'item_tags', 'settings', 'items_fts']) {
    assert.ok(names.includes(table), `tabel ${table} harus ada`);
  }
  const columns = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  for (const column of ['archived', 'deleted_at', 'extracted_text', 'ticket_id', 'source_hash']) {
    assert.ok(columns.includes(column), `kolom items.${column} harus ada`);
  }
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('migrate idempoten', () => {
  const db = openDb();
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/db/connection.js'`

- [ ] **Step 4: Implementasi**

`src/errors.js`:

```js
export class AppError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Login dulu') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Akses ditolak') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, 404);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Terlalu banyak percobaan. Tunggu beberapa menit.') {
    super(message, 429);
  }
}
```

`src/db/schema.js`:

```js
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
```

`src/db/connection.js`:

```js
import Database from 'better-sqlite3';
import { migrate } from './schema.js';

export function openDb(file = ':memory:') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS, 2 test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore src test
git commit -m "feat: scaffold project dan schema database"
```

---

### Task 2: Registry tipe item + validasi

**Files:**
- Create: `src/items/types.js`
- Test: `test/types.test.js`

**Interfaces:**
- Consumes: `ValidationError`
- Produces:
  - `TYPES: Record<string, { label, fields: Array<{ key, required?, options? }>, requiresTicket?, requiresFile?, encrypted? }>`
  - `CIPHERTEXT_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/` (format dari Plan 2: `v1.<iv 12 byte base64url>.<ciphertext+tag base64url>`)
  - `validateItem(input) → { type, title, content, metadata, ticketId, pinned, archived, tags }`
  - `normalizeTags(tags) → string[]`

- [ ] **Step 1: Tulis failing test**

`test/types.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, validateItem, normalizeTags, CIPHERTEXT_PATTERN } from '../src/items/types.js';
import { ValidationError } from '../src/errors.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0LWRhdGE';

test('semua tipe punya label dan fields', () => {
  const expected = [
    'note', 'idea', 'learning', 'meeting', 'template', 'sop', 'query', 'command', 'config',
    'link', 'api_request', 'error_solution', 'schema', 'worklog', 'contact', 'server', 'file', 'secret',
  ];
  assert.deepEqual(Object.keys(TYPES).sort(), expected.sort());
  for (const [type, def] of Object.entries(TYPES)) {
    assert.equal(typeof def.label, 'string', type);
    assert.ok(Array.isArray(def.fields), type);
  }
});

test('validateItem menormalisasi input valid', () => {
  const item = validateItem({
    type: 'query',
    title: '  Cari pasien  ',
    content: 'SELECT 1',
    metadata: { language: 'sql', database: '' },
    tags: ['SIMRS', ' simrs ', 'Pasien'],
    ticketId: 8193,
    archived: true,
  });
  assert.deepEqual(item, {
    type: 'query',
    title: 'Cari pasien',
    content: 'SELECT 1',
    metadata: { language: 'sql' },
    ticketId: 8193,
    pinned: false,
    archived: true,
    tags: ['simrs', 'pasien'],
  });
});

test('validateItem default content, metadata, tags, flag', () => {
  const item = validateItem({ type: 'note', title: 'Catatan' });
  assert.equal(item.content, '');
  assert.deepEqual(item.metadata, {});
  assert.deepEqual(item.tags, []);
  assert.equal(item.ticketId, null);
  assert.equal(item.pinned, false);
  assert.equal(item.archived, false);
});

test('secret wajib berisi ciphertext', () => {
  assert.ok(CIPHERTEXT_PATTERN.test(CIPHER));
  assert.equal(validateItem({ type: 'secret', title: 'DB prod', content: CIPHER }).content, CIPHER);
  for (const content of [undefined, '', 'p@ssw0rd', 'v1.pendek.abc']) {
    assert.throws(() => validateItem({ type: 'secret', title: 'DB prod', content }), /terenkripsi/);
  }
});

test('validateItem menolak input tidak valid', () => {
  const cases = [
    [{ type: 'unknown', title: 'x' }, /Tipe tidak dikenal/],
    [{ type: 'note', title: '   ' }, /title wajib/],
    [{ type: 'note', title: 'x'.repeat(201) }, /title maksimal/],
    [{ type: 'note', title: 'x', content: 5 }, /content harus string/],
    [{ type: 'query', title: 'x' }, /metadata.language wajib/],
    [{ type: 'note', title: 'x', metadata: { foo: 'bar' } }, /tidak dikenal: foo/],
    [{ type: 'api_request', title: 'x', metadata: { method: 'GETT', url: '/a' } }, /metadata.method harus salah satu/],
    [{ type: 'link', title: 'x', metadata: { url: 123 } }, /metadata.url harus string/],
    [{ type: 'worklog', title: 'x' }, /wajib punya ticketId/],
    [{ type: 'note', title: 'x', ticketId: -1 }, /ticketId harus/],
    [{ type: 'note', title: 'x', tags: 'simrs' }, /tags harus array/],
  ];
  for (const [input, message] of cases) {
    assert.throws(() => validateItem(input), (err) => err instanceof ValidationError && message.test(err.message), JSON.stringify(input));
  }
});

test('normalizeTags buang tag kosong', () => {
  assert.deepEqual(normalizeTags(['', '  ', 'A']), ['a']);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/types.test.js`
Expected: FAIL, `Cannot find module '.../src/items/types.js'`

- [ ] **Step 3: Implementasi**

`src/items/types.js`:

```js
import { ValidationError } from '../errors.js';

const TITLE_MAX = 200;

// Format ciphertext dari browser (Plan 2): v1.<iv 12 byte base64url>.<ciphertext+tag base64url>
export const CIPHERTEXT_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;

export const TYPES = {
  note: { label: 'Catatan', fields: [] },
  idea: { label: 'Ide / TODO', fields: [{ key: 'status', options: ['open', 'done'] }] },
  learning: { label: 'Learning', fields: [{ key: 'source' }] },
  meeting: { label: 'Meeting', fields: [{ key: 'date' }, { key: 'participants' }] },
  template: { label: 'Template', fields: [] },
  sop: { label: 'Prosedur / SOP', fields: [] },
  query: { label: 'Query', fields: [{ key: 'language', required: true }, { key: 'database' }] },
  command: { label: 'Command', fields: [{ key: 'shell' }] },
  config: { label: 'Config / Env', fields: [{ key: 'format' }] },
  link: { label: 'Link', fields: [{ key: 'url', required: true }, { key: 'description' }, { key: 'image' }] },
  api_request: {
    label: 'API Request',
    fields: [
      { key: 'method', required: true, options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', required: true },
      { key: 'headers' },
      { key: 'body' },
    ],
  },
  error_solution: { label: 'Error & Solusi', fields: [{ key: 'error_message', required: true }, { key: 'cause' }] },
  schema: { label: 'Skema Tabel', fields: [{ key: 'database' }, { key: 'table', required: true }] },
  worklog: { label: 'Log Kerja', fields: [{ key: 'branch' }], requiresTicket: true },
  contact: {
    label: 'Kontak / PIC',
    fields: [{ key: 'role' }, { key: 'organization' }, { key: 'phone' }, { key: 'email' }],
  },
  server: {
    label: 'Server / Environment',
    fields: [
      { key: 'host', required: true },
      { key: 'port' },
      { key: 'environment', options: ['dev', 'staging', 'prod'] },
    ],
  },
  file: { label: 'File', fields: [], requiresFile: true },
  secret: { label: 'Secret', fields: [{ key: 'username' }, { key: 'url' }], encrypted: true },
};

export function validateItem(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Body harus object');

  const def = TYPES[input.type];
  if (!def) throw new ValidationError(`Tipe tidak dikenal: ${input.type}`);

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new ValidationError('title wajib diisi');
  if (title.length > TITLE_MAX) throw new ValidationError(`title maksimal ${TITLE_MAX} karakter`);

  const content = input.content ?? '';
  if (typeof content !== 'string') throw new ValidationError('content harus string');
  if (def.encrypted && !CIPHERTEXT_PATTERN.test(content)) {
    throw new ValidationError('Isi secret harus sudah terenkripsi di browser (format v1.<iv>.<data>)');
  }

  const ticketId = input.ticketId ?? null;
  if (ticketId !== null && !(Number.isInteger(ticketId) && ticketId > 0)) {
    throw new ValidationError('ticketId harus bilangan bulat positif');
  }
  if (def.requiresTicket && ticketId === null) {
    throw new ValidationError(`Tipe ${input.type} wajib punya ticketId`);
  }

  return {
    type: input.type,
    title,
    content,
    metadata: normalizeMetadata(def, input.metadata ?? {}),
    ticketId,
    pinned: Boolean(input.pinned),
    archived: Boolean(input.archived),
    tags: normalizeTags(input.tags ?? []),
  };
}

function normalizeMetadata(def, metadata) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new ValidationError('metadata harus object');
  }
  const fields = new Map(def.fields.map((f) => [f.key, f]));
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    const field = fields.get(key);
    if (!field) throw new ValidationError(`Field metadata tidak dikenal: ${key}`);
    if (value === null || value === '') continue;
    if (typeof value !== 'string') throw new ValidationError(`metadata.${key} harus string`);
    if (field.options && !field.options.includes(value)) {
      throw new ValidationError(`metadata.${key} harus salah satu dari: ${field.options.join(', ')}`);
    }
    out[key] = value;
  }
  for (const field of def.fields) {
    if (field.required && !out[field.key]) throw new ValidationError(`metadata.${field.key} wajib diisi`);
  }
  return out;
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) throw new ValidationError('tags harus array');
  const out = new Set();
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new ValidationError('tag harus string');
    const name = tag.trim().toLowerCase();
    if (name) out.add(name);
  }
  return [...out];
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/types.test.js`
Expected: PASS, 6 test.

- [ ] **Step 5: Commit**

```bash
git add src/items/types.js test/types.test.js
git commit -m "feat: registry tipe item dan validasi"
```

---

### Task 3: Item repository (CRUD, tag, trash, versi, lookup)

**Files:**
- Create: `src/items/repository.js`
- Test: `test/repository.test.js`

**Interfaces:**
- Consumes: `openDb`, `TYPES`, `validateItem`, `NotFoundError`, `ValidationError`
- Produces: `createItemRepository(db)` dengan method:
  - `create(input, { file?, sourceHash? }?) → Item`; `file = { name, mime, size, path, hash?, extractedText? }` wajib untuk type `file`, dilarang untuk tipe lain. `source_hash` = `file.hash ?? sourceHash ?? null`.
  - `get(id) → Item` (lengkap, termasuk ciphertext secret dan item di trash)
  - `update(id, patch) → Item` (type tidak bisa diubah; item di trash ditolak; snapshot ke `item_versions` kalau title/content/metadata/tags berubah; maksimal 50 versi)
  - `versions(id) → Array<{ id, title, content, metadata, tags, createdAt }>` (terbaru dulu)
  - `restoreVersion(id, versionId) → Item` (lewat `update`, jadi isi sekarang ikut tersimpan sebagai versi)
  - `trash(id)`, `restore(id)`, `purge(id)` (hanya item di trash), `purgeExpired({ days, now? }) → Item[]`
  - `findBySourceHash(hash) → Item | null`, `findLinkByUrl(url) → Item | null`, `all() → Item[]` (semua item termasuk arsip/trash, lengkap)
  - `tags() → Array<{ name, count }>` (tanpa item di trash)
  - Bentuk `Item`: `{ id, type, title, content: string|null, encrypted, metadata, file: { name, mime, size, path }|null, ticketId, pinned, archived, deletedAt, tags, createdAt, updatedAt }`. `content` secret = `null` kecuali lewat `get`/`all`/`versions`.
  - Internal untuk Task 4: `toItem(row, { full })`, `db`.

- [ ] **Step 1: Tulis failing test**

`test/repository.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0LWRhdGE';

function setup() {
  const db = openDb();
  return { db, repo: createItemRepository(db) };
}

const queryInput = {
  type: 'query',
  title: 'Cari pasien by RM',
  content: 'SELECT * FROM pasien WHERE no_rm = ?',
  metadata: { language: 'sql' },
  tags: ['SIMRS', 'pasien'],
  ticketId: 8193,
};

test('create lalu get mengembalikan item lengkap', () => {
  const { repo } = setup();
  const item = repo.create(queryInput);
  assert.equal(typeof item.id, 'number');
  assert.equal(item.content, queryInput.content);
  assert.equal(item.encrypted, false);
  assert.deepEqual(item.metadata, { language: 'sql' });
  assert.deepEqual(item.tags, ['pasien', 'simrs']);
  assert.equal(item.ticketId, 8193);
  assert.equal(item.pinned, false);
  assert.equal(item.archived, false);
  assert.equal(item.deletedAt, null);
  assert.equal(item.file, null);
  assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(repo.get(item.id), item);
});

test('get id yang tidak ada → NotFoundError', () => {
  const { repo } = setup();
  assert.throws(() => repo.get(999), NotFoundError);
});

test('update merge patch, ganti tags, buang tag yatim', () => {
  const { repo } = setup();
  const item = repo.create(queryInput);
  const updated = repo.update(item.id, { title: 'Cari pasien (v2)', tags: ['rekam-medis'], pinned: true, archived: true });
  assert.equal(updated.title, 'Cari pasien (v2)');
  assert.equal(updated.content, queryInput.content);
  assert.equal(updated.pinned, true);
  assert.equal(updated.archived, true);
  assert.deepEqual(updated.tags, ['rekam-medis']);
  assert.deepEqual(repo.tags(), [{ name: 'rekam-medis', count: 1 }]);
  assert.deepEqual(repo.update(item.id, { content: 'SELECT 1' }).tags, ['rekam-medis']);
});

test('update: type tidak bisa diubah, validasi tetap jalan', () => {
  const { repo } = setup();
  const item = repo.create(queryInput);
  assert.throws(() => repo.update(item.id, { type: 'note' }), /type tidak bisa diubah/);
  assert.throws(() => repo.update(item.id, { metadata: {} }), ValidationError);
  assert.throws(() => repo.update(999, { title: 'x' }), NotFoundError);
});

test('versi: snapshot saat isi berubah, tidak saat pin/arsip, bisa dikembalikan', () => {
  const { repo } = setup();
  const item = repo.create({ type: 'note', title: 'A', content: 'c1', tags: ['x'] });
  repo.update(item.id, { content: 'c2' });
  repo.update(item.id, { pinned: true });
  repo.update(item.id, { title: 'B' });

  const versions = repo.versions(item.id);
  assert.deepEqual(versions.map((v) => [v.title, v.content]), [['A', 'c2'], ['A', 'c1']]);
  assert.deepEqual(versions[0].tags, ['x']);
  assert.match(versions[0].createdAt, /^\d{4}-/);

  const restored = repo.restoreVersion(item.id, versions[1].id);
  assert.equal(restored.title, 'A');
  assert.equal(restored.content, 'c1');
  assert.equal(restored.pinned, true);
  assert.deepEqual(repo.versions(item.id).map((v) => [v.title, v.content])[0], ['B', 'c2']);
  assert.throws(() => repo.restoreVersion(item.id, 9999), NotFoundError);
});

test('versi: maksimal 50 per item', () => {
  const { repo } = setup();
  const item = repo.create({ type: 'note', title: 'Draft', content: '0' });
  for (let i = 1; i <= 55; i++) repo.update(item.id, { content: String(i) });
  const versions = repo.versions(item.id);
  assert.equal(versions.length, 50);
  assert.equal(versions[0].content, '54');
});

test('trash, restore, purge', () => {
  const { db, repo } = setup();
  const a = repo.create(queryInput);
  repo.create({ type: 'note', title: 'Catatan', tags: ['simrs'] });

  const trashed = repo.trash(a.id);
  assert.match(trashed.deletedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(repo.tags(), [{ name: 'simrs', count: 1 }]);
  assert.throws(() => repo.update(a.id, { title: 'x' }), /restore dulu/);

  assert.equal(repo.restore(a.id).deletedAt, null);
  assert.deepEqual(repo.tags(), [
    { name: 'pasien', count: 1 },
    { name: 'simrs', count: 2 },
  ]);

  assert.throws(() => repo.purge(a.id), /trash dulu/);
  repo.trash(a.id);
  assert.equal(repo.purge(a.id).id, a.id);
  assert.throws(() => repo.get(a.id), NotFoundError);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM tags WHERE name = 'pasien'`).get().n, 0);
});

test('purgeExpired hanya menghapus item trash yang lebih tua dari batas hari', () => {
  const { db, repo } = setup();
  const old = repo.create({ type: 'note', title: 'Lama' });
  const fresh = repo.create({ type: 'note', title: 'Baru' });
  const active = repo.create({ type: 'note', title: 'Aktif' });
  repo.trash(old.id);
  repo.trash(fresh.id);
  const setDeletedAt = db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?');
  setDeletedAt.run('2026-08-01T00:00:00.000Z', old.id);
  setDeletedAt.run('2026-10-01T00:00:00.000Z', fresh.id);

  const purged = repo.purgeExpired({ days: 30, now: new Date('2026-10-07T00:00:00Z') });
  assert.deepEqual(purged.map((i) => i.id), [old.id]);
  assert.doesNotThrow(() => repo.get(fresh.id));
  assert.doesNotThrow(() => repo.get(active.id));
});

test('file: tipe file wajib bawa file, hash jadi source hash', () => {
  const { repo } = setup();
  assert.throws(() => repo.create({ type: 'file', title: 'Laporan' }), /wajib upload file/);
  const file = { name: 'a.pdf', mime: 'application/pdf', size: 10, path: '2026/10/x.pdf', hash: 'abc123' };
  assert.throws(() => repo.create({ type: 'note', title: 'x' }, { file }), /tidak menerima file/);
  const item = repo.create({ type: 'file', title: 'Laporan' }, { file: { ...file, extractedText: 'isi' } });
  assert.deepEqual(item.file, { name: 'a.pdf', mime: 'application/pdf', size: 10, path: '2026/10/x.pdf' });
  assert.equal(repo.findBySourceHash('abc123').id, item.id);
  assert.equal(repo.findBySourceHash('tidak-ada'), null);

  const note = repo.create({ type: 'note', title: 'Dari import' }, { sourceHash: 'def456' });
  assert.equal(repo.findBySourceHash('def456').id, note.id);
});

test('findLinkByUrl dan all', () => {
  const { repo } = setup();
  const link = repo.create({ type: 'link', title: 'Laravel', metadata: { url: 'https://laravel.com/docs' } });
  repo.create({ type: 'note', title: 'Catatan' });
  assert.equal(repo.findLinkByUrl('https://laravel.com/docs').id, link.id);
  assert.equal(repo.findLinkByUrl('https://example.com/'), null);
  repo.trash(link.id);
  assert.equal(repo.all().length, 2);
});

test('secret: ciphertext disimpan apa adanya, hanya keluar lewat get', () => {
  const { repo } = setup();
  const item = repo.create({ type: 'secret', title: 'DB prod', content: CIPHER, metadata: { username: 'root' } });
  assert.equal(item.encrypted, true);
  assert.equal(item.content, CIPHER);
  assert.equal(repo.get(item.id).content, CIPHER);
  assert.throws(() => repo.update(item.id, { content: 'plain' }), /terenkripsi/);
  assert.equal(repo.update(item.id, { title: 'DB prod (lama)' }).content, CIPHER);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/repository.test.js`
Expected: FAIL, `Cannot find module '.../src/items/repository.js'`

- [ ] **Step 3: Implementasi**

`src/items/repository.js`:

```js
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
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/repository.test.js`
Expected: PASS, 12 test.

- [ ] **Step 5: Commit**

```bash
git add src/items/repository.js test/repository.test.js
git commit -m "feat: item repository dengan tag, trash, riwayat versi, dan lookup import"
```

---

### Task 4: List + full-text search (dengan filter arsip & trash)

**Files:**
- Modify: `src/items/repository.js`
- Test: `test/search.test.js`

**Interfaces:**
- Consumes: `createItemRepository` dari Task 3 (`toItem`, `db`)
- Produces:
  - `buildMatchQuery(q) → string` (di-export; tiap kata jadi `"kata"*`, token tanpa huruf/angka dibuang)
  - `repo.list(filters?)`, `filters = { type?, tag?, ticketId?, pinned?, archived? = false, trashed? = false, limit? = 50, offset? = 0 }`; urutan pinned, `updated_at` desc, `id` desc
  - `trashed: true` → hanya item di trash; selain itu hanya item tidak di trash dengan `archived` sesuai filter
  - `repo.search(q, filters?) → Array<Item & { snippet }>`, bm25 (title bobot 5)
  - `limit` di-clamp 1..200; `content` secret selalu `null` di list/search

- [ ] **Step 1: Tulis failing test**

`test/search.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { createItemRepository, buildMatchQuery } from '../src/items/repository.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c3VwZXJzZWNyZXR2YWx1ZQ';

function setup() {
  const repo = createItemRepository(openDb());
  repo.create({ type: 'query', title: 'Pasien rawat inap aktif', content: 'SELECT * FROM pasien_rawat_inap WHERE pulang IS NULL', metadata: { language: 'sql' }, tags: ['simrs'], ticketId: 8193 });
  repo.create({ type: 'error_solution', title: 'Postgres tidak bisa konek', content: 'Start service postgresql di Laragon', metadata: { error_message: 'ECONNREFUSED 127.0.0.1:5432' }, tags: ['postgres'] });
  repo.create({ type: 'link', title: 'Dokumentasi BPJS VClaim', metadata: { url: 'https://dvlp.bpjs-kesehatan.go.id' }, tags: ['simrs', 'bpjs'] });
  repo.create({ type: 'file', title: 'Hasil lab.pdf' }, { file: { name: 'lab.pdf', mime: 'application/pdf', size: 1, path: '2026/10/lab.pdf', extractedText: 'Hemoglobin pasien normal' } });
  repo.create({ type: 'secret', title: 'Password DB staging', content: CIPHER, tags: ['simrs'] });
  return { repo };
}

const titles = (items) => items.map((i) => i.title);

test('buildMatchQuery membungkus tiap kata dan membuang token tanpa huruf/angka', () => {
  assert.equal(buildMatchQuery('  rawat "inap  '), '"rawat"* "inap"*');
  assert.equal(buildMatchQuery('   '), '');
  assert.equal(buildMatchQuery('(*) - pasien'), '"pasien"*');
});

test('list: filter type, tag, ticket', () => {
  const { repo } = setup();
  assert.deepEqual(titles(repo.list({ type: 'link' })), ['Dokumentasi BPJS VClaim']);
  assert.equal(repo.list({ tag: 'SIMRS' }).length, 3);
  assert.deepEqual(titles(repo.list({ ticketId: 8193 })), ['Pasien rawat inap aktif']);
  assert.equal(repo.list().length, 5);
  assert.equal(repo.list({ limit: 2 }).length, 2);
});

test('list: pinned di atas, lalu yang terbaru', () => {
  const repo = createItemRepository(openDb());
  repo.create({ type: 'note', title: 'A' });
  repo.create({ type: 'note', title: 'B' });
  repo.create({ type: 'note', title: 'C', pinned: true });
  assert.deepEqual(titles(repo.list()), ['C', 'B', 'A']);
});

test('list & search: arsip dan trash disembunyikan secara default', () => {
  const { repo } = setup();
  const [link] = repo.list({ type: 'link' });
  repo.update(link.id, { archived: true });
  const [error] = repo.list({ type: 'error_solution' });
  repo.trash(error.id);

  assert.equal(repo.list().length, 3);
  assert.deepEqual(titles(repo.list({ archived: true })), ['Dokumentasi BPJS VClaim']);
  assert.deepEqual(titles(repo.list({ trashed: true })), ['Postgres tidak bisa konek']);
  assert.deepEqual(repo.search('vclaim'), []);
  assert.deepEqual(titles(repo.search('vclaim', { archived: true })), ['Dokumentasi BPJS VClaim']);
  assert.deepEqual(repo.search('econn'), []);
  assert.deepEqual(titles(repo.search('econn', { trashed: true })), ['Postgres tidak bisa konek']);
});

test('list: content secret selalu null', () => {
  const { repo } = setup();
  const [secret] = repo.list({ type: 'secret' });
  assert.equal(secret.content, null);
  assert.equal(secret.encrypted, true);
});

test('search: content, metadata, prefix, extracted text', () => {
  const { repo } = setup();
  assert.deepEqual(titles(repo.search('rawat')), ['Pasien rawat inap aktif']);
  assert.deepEqual(titles(repo.search('econn')), ['Postgres tidak bisa konek']);
  assert.deepEqual(titles(repo.search('vclaim')), ['Dokumentasi BPJS VClaim']);
  assert.deepEqual(titles(repo.search('hemoglobin')), ['Hasil lab.pdf']);
  assert.ok(repo.search('rawat')[0].snippet.includes('[rawat]'));
});

test('search: multi kata = AND, filter tetap berlaku', () => {
  const { repo } = setup();
  assert.deepEqual(titles(repo.search('pasien inap')), ['Pasien rawat inap aktif']);
  assert.deepEqual(repo.search('pasien', { type: 'link' }), []);
});

test('search: ciphertext secret tidak ter-index, title tetap bisa dicari', () => {
  const { repo } = setup();
  assert.deepEqual(repo.search('c3VwZXJzZWNyZXR2YWx1ZQ'), []);
  const [hit] = repo.search('staging');
  assert.equal(hit.title, 'Password DB staging');
  assert.equal(hit.content, null);
});

test('search: input aneh tidak bikin error', () => {
  const { repo } = setup();
  for (const q of ['pasien-rawat', '"', 'a:b', '(*)', 'NOT', '']) {
    assert.doesNotThrow(() => repo.search(q), q);
  }
  assert.deepEqual(repo.search(''), []);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/search.test.js`
Expected: FAIL, `does not provide an export named 'buildMatchQuery'`

- [ ] **Step 3: Implementasi**

Di `src/items/repository.js`, tambahkan setelah konstanta `MAX_VERSIONS`:

```js
const MAX_LIMIT = 200;

// Tiap kata jadi phrase-prefix ("kata"*) supaya input user tidak pernah dibaca sebagai syntax FTS5.
export function buildMatchQuery(q) {
  return String(q)
    .split(/\s+/)
    .map((token) => token.replace(/"/g, ''))
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .map((token) => `"${token}"*`)
    .join(' ');
}

function buildFilters({ type, tag, ticketId, pinned, archived = false, trashed = false, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = {
    limit: Math.min(Math.max(limit, 1), MAX_LIMIT),
    offset: Math.max(offset, 0),
  };
  if (trashed) {
    clauses.push('i.deleted_at IS NOT NULL');
  } else {
    clauses.push('i.deleted_at IS NULL', archived ? 'i.archived = 1' : 'i.archived = 0');
  }
  if (type) {
    clauses.push('i.type = @type');
    params.type = type;
  }
  if (tag) {
    clauses.push('i.id IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = @tag)');
    params.tag = tag.trim().toLowerCase();
  }
  if (ticketId != null) {
    clauses.push('i.ticket_id = @ticketId');
    params.ticketId = ticketId;
  }
  if (pinned !== undefined) {
    clauses.push('i.pinned = @pinned');
    params.pinned = pinned ? 1 : 0;
  }
  return { clauses, params };
}
```

Di dalam `createItemRepository`, tambahkan sebelum `return`:

```js
  function list(filters = {}) {
    const { clauses, params } = buildFilters(filters);
    const rows = db
      .prepare(`
        SELECT i.* FROM items i
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.pinned DESC, i.updated_at DESC, i.id DESC
        LIMIT @limit OFFSET @offset
      `)
      .all(params);
    return rows.map((row) => toItem(row));
  }

  function search(q, filters = {}) {
    const match = buildMatchQuery(q);
    if (!match) return [];
    const { clauses, params } = buildFilters(filters);
    const where = ['items_fts MATCH @match', ...clauses].join(' AND ');
    const rows = db
      .prepare(`
        SELECT i.*, snippet(items_fts, 1, '[', ']', '…', 12) AS snippet
        FROM items_fts JOIN items i ON i.id = items_fts.rowid
        WHERE ${where}
        ORDER BY bm25(items_fts, 5.0, 1.0)
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, match });
    return rows.map((row) => ({ ...toItem(row), snippet: row.snippet }));
  }
```

Ganti baris `return` terakhir menjadi:

```js
  return {
    create, get, update, versions, restoreVersion, trash, restore, purge, purgeExpired,
    findBySourceHash, findLinkByUrl, all, list, search, tags,
  };
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS, semua test.

- [ ] **Step 5: Commit**

```bash
git add src/items/repository.js test/search.test.js
git commit -m "feat: list dan full-text search dengan filter arsip/trash"
```

---

### Task 5: File storage + extract teks (PDF, docx, xlsx, teks)

**Files:**
- Create: `src/files/storage.js`, `src/files/extract.js`
- Test: `test/files.test.js`

**Interfaces:**
- Consumes: `ValidationError`
- Produces:
  - `createFileStorage(rootDir) → { save(buffer, originalName, now?) → { path, size, hash }, openReadStream(relPath) → fs.ReadStream, remove(relPath), absolutePath(relPath) }`; `path` format `YYYY/MM/<uuid><ext>`, `hash` = SHA-256 hex
  - `extractText(buffer, { mime, name }) → Promise<string>` (PDF via unpdf, `.docx` via mammoth, `.xlsx` via exceljs, file teks via utf8, lainnya `''`; max 200.000 karakter; tidak pernah throw)

- [ ] **Step 1: Install dependency**

```bash
npm install unpdf mammoth exceljs
npm install --save-dev pdf-lib docx
```

- [ ] **Step 2: Tulis failing test**

`test/files.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { text } from 'node:stream/consumers';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import ExcelJS from 'exceljs';
import { createFileStorage } from '../src/files/storage.js';
import { extractText } from '../src/files/extract.js';
import { ValidationError } from '../src/errors.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'hdb-files-'));

test('storage: save dengan hash, stream, remove', async () => {
  const storage = createFileStorage(tempDir());
  const saved = storage.save(Buffer.from('halo'), 'Catatan.TXT', new Date('2026-10-07T10:00:00Z'));
  assert.match(saved.path, /^2026\/10\/[0-9a-f-]{36}\.txt$/);
  assert.equal(saved.size, 4);
  assert.equal(saved.hash, createHash('sha256').update('halo').digest('hex'));
  assert.equal(await text(storage.openReadStream(saved.path)), 'halo');
  storage.remove(saved.path);
  assert.equal(existsSync(storage.absolutePath(saved.path)), false);
  assert.doesNotThrow(() => storage.remove(saved.path));
});

test('storage: tolak path traversal', () => {
  const storage = createFileStorage(tempDir());
  assert.throws(() => storage.openReadStream('../../etc/passwd'), ValidationError);
  assert.throws(() => storage.remove('..'), ValidationError);
});

test('extract: PDF', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('Laporan pasien rawat inap', { x: 50, y: 700, size: 14, font });
  const bytes = Buffer.from(await doc.save());
  assert.match(await extractText(bytes, { mime: 'application/pdf', name: 'laporan.pdf' }), /pasien rawat inap/);
});

test('extract: docx', async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph('Spesifikasi bridging SatuSehat')] }] });
  const buffer = await Packer.toBuffer(doc);
  assert.match(await extractText(buffer, { mime: '', name: 'spek.docx' }), /bridging SatuSehat/);
});

test('extract: xlsx', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tarif');
  sheet.addRow(['Kamar', 'Tarif']);
  sheet.addRow(['VIP', 750000]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await extractText(buffer, { mime: '', name: 'tarif.xlsx' });
  assert.match(result, /Tarif/);
  assert.match(result, /VIP 750000/);
});

test('extract: file teks by mime atau ekstensi', async () => {
  assert.equal(await extractText(Buffer.from('SELECT 1;'), { mime: 'application/octet-stream', name: 'cek.sql' }), 'SELECT 1;');
  assert.equal(await extractText(Buffer.from('a,b'), { mime: 'text/csv', name: 'data' }), 'a,b');
});

test('extract: binary lain atau file rusak → string kosong', async () => {
  assert.equal(await extractText(Buffer.from([0xff, 0xd8]), { mime: 'image/jpeg', name: 'ss.jpg' }), '');
  assert.equal(await extractText(Buffer.from('bukan pdf'), { mime: 'application/pdf', name: 'rusak.pdf' }), '');
  assert.equal(await extractText(Buffer.from('bukan docx'), { mime: '', name: 'rusak.docx' }), '');
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `node --test test/files.test.js`
Expected: FAIL, `Cannot find module '.../src/files/storage.js'`

- [ ] **Step 4: Implementasi**

`src/files/storage.js`:

```js
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
```

`src/files/extract.js`:

```js
import { extname } from 'node:path';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

const MAX_CHARS = 200_000;
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.sql', '.csv', '.json', '.log', '.env', '.yml', '.yaml', '.xml', '.ini', '.conf', '.sh', '.js', '.php',
]);

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('');
    return String(value.text ?? value.result ?? '');
  }
  return String(value);
}

async function extractXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const lines = [];
  workbook.eachSheet((sheet) => {
    lines.push(sheet.name);
    sheet.eachRow((row) => {
      lines.push(row.values.map(cellText).filter(Boolean).join(' '));
    });
  });
  return lines.join('\n');
}

// Best-effort: gagal extract cuma berarti file tidak bisa dicari by isi, upload tetap jalan.
export async function extractText(buffer, { mime = '', name = '' } = {}) {
  const ext = extname(name).toLowerCase();
  try {
    let text = '';
    if (mime === 'application/pdf' || ext === '.pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      text = (await extractPdfText(pdf, { mergePages: true })).text;
    } else if (ext === '.docx') {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (ext === '.xlsx') {
      text = await extractXlsx(buffer);
    } else if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
      text = buffer.toString('utf8');
    }
    return text.slice(0, MAX_CHARS);
  } catch (err) {
    console.warn(`Gagal extract teks dari ${name}: ${err.message}`);
    return '';
  }
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `node --test test/files.test.js`
Expected: PASS, 7 test (warning "Gagal extract teks dari rusak.pdf/rusak.docx" itu wajar).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/files test/files.test.js
git commit -m "feat: file storage dengan hash dan extract teks PDF/docx/xlsx"
```

---

### Task 6: Preview link

**Files:**
- Create: `src/links/preview.js`
- Test: `test/link-preview.test.js`

**Interfaces:**
- Consumes: `ValidationError`
- Produces:
  - `parseLinkPreview(html, url) → { url, title, description, image, siteName }`
  - `fetchLinkPreview(url, { fetchImpl = fetch, timeoutMs = 5000 }?) → Promise<{ url, title, description, image, siteName }>`; URL tidak valid / bukan http(s) → `ValidationError`; gagal fetch, bukan 2xx, atau bukan HTML → fallback hostname

- [ ] **Step 1: Tulis failing test**

`test/link-preview.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkPreview, fetchLinkPreview } from '../src/links/preview.js';
import { ValidationError } from '../src/errors.js';

const ogHtml = `
<html><head>
  <title>Judul cadangan</title>
  <meta content="Dokumentasi VClaim &amp; Antrean" property="og:title">
  <meta property="og:description" content='Referensi "API" BPJS'>
  <meta property="og:image" content="/img/cover.png">
  <meta property="og:site_name" content="BPJS Kesehatan">
</head><body></body></html>`;

const htmlResponse = (html, status = 200) =>
  new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

test('parseLinkPreview: baca og tags (urutan atribut bebas), decode entity, resolve image', () => {
  assert.deepEqual(parseLinkPreview(ogHtml, 'https://dvlp.bpjs-kesehatan.go.id/vclaim/'), {
    url: 'https://dvlp.bpjs-kesehatan.go.id/vclaim/',
    title: 'Dokumentasi VClaim & Antrean',
    description: 'Referensi "API" BPJS',
    image: 'https://dvlp.bpjs-kesehatan.go.id/img/cover.png',
    siteName: 'BPJS Kesehatan',
  });
});

test('parseLinkPreview: fallback ke <title> dan meta description', () => {
  const html = '<title>\n  Laravel Docs  </title><meta name="description" content="Framework PHP">';
  assert.deepEqual(parseLinkPreview(html, 'https://laravel.com/docs'), {
    url: 'https://laravel.com/docs',
    title: 'Laravel Docs',
    description: 'Framework PHP',
    image: '',
    siteName: 'laravel.com',
  });
});

test('fetchLinkPreview: tolak URL tidak valid atau bukan http(s)', async () => {
  await assert.rejects(fetchLinkPreview('bukan url'), ValidationError);
  await assert.rejects(fetchLinkPreview('ftp://files.example.com/a'), ValidationError);
});

test('fetchLinkPreview: parse HTML dari response', async () => {
  const preview = await fetchLinkPreview('https://dvlp.bpjs-kesehatan.go.id/vclaim/', {
    fetchImpl: async () => htmlResponse(ogHtml),
  });
  assert.equal(preview.title, 'Dokumentasi VClaim & Antrean');
  assert.equal(preview.image, 'https://dvlp.bpjs-kesehatan.go.id/img/cover.png');
});

test('fetchLinkPreview: fallback ke hostname kalau gagal', async () => {
  const fallback = {
    url: 'https://intranet.rs.local/laporan',
    title: 'intranet.rs.local',
    description: '',
    image: '',
    siteName: 'intranet.rs.local',
  };
  const cases = [
    async () => { throw new Error('ECONNREFUSED'); },
    async () => htmlResponse('<title>Not found</title>', 404),
    async () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
  ];
  for (const fetchImpl of cases) {
    assert.deepEqual(await fetchLinkPreview('https://intranet.rs.local/laporan', { fetchImpl }), fallback);
  }
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/link-preview.test.js`
Expected: FAIL, `Cannot find module '.../src/links/preview.js'`

- [ ] **Step 3: Implementasi**

`src/links/preview.js`:

```js
import { ValidationError } from '../errors.js';

const MAX_HTML_CHARS = 1_000_000;
const TITLE_MAX = 200;
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

function decodeEntities(text) {
  return text.replace(/&(amp|quot|#39|#x27|lt|gt|nbsp);/g, (entity) => ENTITIES[entity]);
}

function readMetaTags(html) {
  const tags = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const [, name, , doubleQuoted, singleQuoted] of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs[name.toLowerCase()] = doubleQuoted ?? singleQuoted;
    }
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !tags.has(key)) tags.set(key, decodeEntities(attrs.content).trim());
  }
  return tags;
}

function fallbackPreview(url) {
  const { hostname, href } = new URL(url);
  return { url: href, title: hostname, description: '', image: '', siteName: hostname };
}

export function parseLinkPreview(html, url) {
  const meta = readMetaTags(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fallback = fallbackPreview(url);
  const title = meta.get('og:title') || meta.get('twitter:title') || (titleTag && decodeEntities(titleTag).trim()) || fallback.title;

  let image = meta.get('og:image') || meta.get('twitter:image') || '';
  if (image) {
    try {
      image = new URL(image, url).href;
    } catch {
      image = '';
    }
  }

  return {
    url: fallback.url,
    title: title.slice(0, TITLE_MAX),
    description: meta.get('og:description') || meta.get('description') || '',
    image,
    siteName: meta.get('og:site_name') || fallback.siteName,
  };
}

export async function fetchLinkPreview(url, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('URL tidak valid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ValidationError('URL harus http atau https');

  // Preview cuma pemanis: gagal fetch tidak boleh menggagalkan penyimpanan link.
  try {
    const res = await fetchImpl(parsed.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (hesewake-database link preview)', Accept: 'text/html' },
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return fallbackPreview(parsed.href);
    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    return parseLinkPreview(html, res.url || parsed.href);
  } catch {
    return fallbackPreview(parsed.href);
  }
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/link-preview.test.js`
Expected: PASS, 5 test.

- [ ] **Step 5: Commit**

```bash
git add src/links test/link-preview.test.js
git commit -m "feat: preview link dari og tags"
```

---

### Task 7: Import massal (file, folder, bookmark browser)

**Files:**
- Create: `src/import/importer.js`, `src/import/directory.js`
- Test: `test/importer.test.js`

**Interfaces:**
- Consumes: `createItemRepository` (`create`, `findBySourceHash`, `findLinkByUrl`), `createFileStorage` (`save`, `remove`), `extractText`
- Produces:
  - `detectImportType(name, size) → 'query' | 'note' | 'file'` (`.sql` → query, `.md`/`.txt` → note, sisanya atau > 1 MB → file)
  - `guessMime(name) → string`, `slugTag(text) → string`
  - `parseBookmarksHtml(html) → Array<{ url, title, folders: string[] }>` (format Netscape, hasil "Export bookmarks" Chrome/Edge/Firefox)
  - `createImporter({ repo, storage }) → { importFile({ buffer, name, mime?, tags? }) → Promise<{ status: 'created' | 'skipped', item }>, importBookmarks(html, { tags? }) → { created, skipped } }`. Duplikat dideteksi lewat SHA-256 isi (file) atau URL (link).
  - `importDirectory(root, importer, { tags?, maxBytes?, onProgress? }) → Promise<{ created, skipped, failed: Array<{ path, error }> }>`; nama subfolder jadi tag; file/folder diawali `.` dan `node_modules` dilewati

- [ ] **Step 1: Tulis failing test**

`test/importer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter, detectImportType, parseBookmarksHtml, slugTag } from '../src/import/importer.js';
import { importDirectory } from '../src/import/directory.js';

function setup() {
  const repo = createItemRepository(openDb());
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-import-')));
  return { repo, storage, importer: createImporter({ repo, storage }) };
}

const BOOKMARKS = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<DL><p>
  <DT><H3>Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://laravel.com/docs" ADD_DATE="1">Laravel &amp; Docs</A>
    <DT><H3>Kerja SIMRS</H3>
    <DL><p>
      <DT><A HREF="https://dvlp.bpjs-kesehatan.go.id/vclaim">VClaim</A>
      <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://ticket.alfatih-solusindo.com/">Odoo</A>
</DL><p>`;

test('detectImportType dan slugTag', () => {
  assert.equal(detectImportType('pasien.sql', 100), 'query');
  assert.equal(detectImportType('catatan.MD', 100), 'note');
  assert.equal(detectImportType('readme.txt', 100), 'note');
  assert.equal(detectImportType('besar.sql', 2_000_000), 'file');
  assert.equal(detectImportType('laporan.pdf', 100), 'file');
  assert.equal(slugTag('Kerja SIMRS / Rawat Inap'), 'kerja-simrs-rawat-inap');
});

test('importFile: .sql jadi query, duplikat dilewati', async () => {
  const { importer } = setup();
  const buffer = Buffer.from('SELECT * FROM pasien;');
  const first = await importer.importFile({ buffer, name: 'pasien-aktif.sql', tags: ['simrs'] });
  assert.equal(first.status, 'created');
  assert.equal(first.item.type, 'query');
  assert.equal(first.item.title, 'pasien-aktif');
  assert.equal(first.item.content, 'SELECT * FROM pasien;');
  assert.deepEqual(first.item.metadata, { language: 'sql' });
  assert.deepEqual(first.item.tags, ['simrs']);

  const again = await importer.importFile({ buffer, name: 'salinan.sql' });
  assert.equal(again.status, 'skipped');
  assert.equal(again.item.id, first.item.id);
});

test('importFile: PDF jadi file dan isinya bisa dicari', async () => {
  const { repo, importer } = setup();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('Hemoglobin pasien normal', { x: 50, y: 700, size: 14, font });
  const result = await importer.importFile({ buffer: Buffer.from(await doc.save()), name: 'lab.pdf' });
  assert.equal(result.item.type, 'file');
  assert.equal(result.item.file.mime, 'application/pdf');
  assert.deepEqual(repo.search('hemoglobin').map((i) => i.id), [result.item.id]);
});

test('importFile: mime ditebak dari ekstensi kalau kosong', async () => {
  const { importer } = setup();
  const result = await importer.importFile({ buffer: Buffer.from([0x89, 0x50]), name: 'ss.png', mime: '' });
  assert.equal(result.item.file.mime, 'image/png');
});

test('parseBookmarksHtml membaca folder bertingkat', () => {
  assert.deepEqual(parseBookmarksHtml(BOOKMARKS), [
    { url: 'https://laravel.com/docs', title: 'Laravel & Docs', folders: ['Bookmarks bar'] },
    { url: 'https://dvlp.bpjs-kesehatan.go.id/vclaim', title: 'VClaim', folders: ['Bookmarks bar', 'Kerja SIMRS'] },
    { url: 'javascript:alert(1)', title: 'Bookmarklet', folders: ['Bookmarks bar', 'Kerja SIMRS'] },
    { url: 'https://ticket.alfatih-solusindo.com/', title: 'Odoo', folders: [] },
  ]);
});

test('importBookmarks: folder jadi tag, bukan http dilewati, duplikat dilewati', () => {
  const { repo, importer } = setup();
  assert.deepEqual(importer.importBookmarks(BOOKMARKS, { tags: ['bookmark'] }), { created: 3, skipped: 1 });
  const vclaim = repo.findLinkByUrl('https://dvlp.bpjs-kesehatan.go.id/vclaim');
  assert.deepEqual(vclaim.tags, ['bookmark', 'bookmarks-bar', 'kerja-simrs']);
  assert.deepEqual(importer.importBookmarks(BOOKMARKS), { created: 0, skipped: 4 });
});

test('importDirectory: rekursif, subfolder jadi tag, dotfile dilewati', async () => {
  const { repo, importer } = setup();
  const root = mkdtempSync(join(tmpdir(), 'hdb-dir-'));
  mkdirSync(join(root, 'SIMRS', 'Query'), { recursive: true });
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'SIMRS', 'Query', 'kunjungan.sql'), 'SELECT * FROM kunjungan;');
  writeFileSync(join(root, 'SIMRS', 'catatan.md'), '# Catatan rapat');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(root, '.git', 'HEAD'), 'ref');

  const progress = [];
  const summary = await importDirectory(root, importer, { tags: ['impor'], onProgress: (path, status) => progress.push(status) });
  assert.deepEqual(summary, { created: 2, skipped: 0, failed: [] });
  assert.equal(progress.length, 2);
  const [query] = repo.list({ type: 'query' });
  assert.deepEqual(query.tags, ['impor', 'query', 'simrs']);

  const rerun = await importDirectory(root, importer);
  assert.deepEqual(rerun, { created: 0, skipped: 2, failed: [] });
});

test('importDirectory: file terlalu besar dicatat gagal', async () => {
  const { importer } = setup();
  const root = mkdtempSync(join(tmpdir(), 'hdb-dir-'));
  writeFileSync(join(root, 'besar.bin'), Buffer.alloc(64));
  const summary = await importDirectory(root, importer, { maxBytes: 10 });
  assert.equal(summary.created, 0);
  assert.equal(summary.failed.length, 1);
  assert.match(summary.failed[0].error, /terlalu besar/);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/importer.test.js`
Expected: FAIL, `Cannot find module '.../src/import/importer.js'`

- [ ] **Step 3: Implementasi**

`src/import/importer.js`:

```js
import { createHash } from 'node:crypto';
import { extname, basename } from 'node:path';
import { extractText } from '../files/extract.js';

const TEXT_IMPORT_MAX = 1_000_000;
const TITLE_MAX = 200;
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.sql': 'application/sql',
  '.json': 'application/json',
  '.zip': 'application/zip',
};
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export function guessMime(name) {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function detectImportType(name, size) {
  if (size > TEXT_IMPORT_MAX) return 'file';
  const ext = extname(name).toLowerCase();
  if (ext === '.sql') return 'query';
  if (ext === '.md' || ext === '.txt') return 'note';
  return 'file';
}

export function slugTag(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]).trim();

// Format Netscape: <H3> = nama folder, <DL> berikutnya = isi folder itu, </DL> = keluar folder.
export function parseBookmarksHtml(html) {
  const bookmarks = [];
  const stack = [];
  let pendingFolder = null;
  const pattern = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s[^>]*?HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<(\/?)DL\b[^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) {
      pendingFolder = decode(match[1]);
    } else if (match[2] !== undefined) {
      bookmarks.push({ url: decode(match[2]), title: decode(match[3].replace(/<[^>]+>/g, '')), folders: stack.filter(Boolean) });
    } else if (match[4] === '/') {
      stack.pop();
    } else {
      stack.push(pendingFolder);
      pendingFolder = null;
    }
  }
  return bookmarks;
}

export function createImporter({ repo, storage }) {
  async function importFile({ buffer, name, mime = '', tags = [] }) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    const existing = repo.findBySourceHash(hash);
    if (existing) return { status: 'skipped', item: existing };

    const type = detectImportType(name, buffer.length);
    if (type !== 'file') {
      const item = repo.create(
        {
          type,
          title: (basename(name, extname(name)) || name).slice(0, TITLE_MAX),
          content: buffer.toString('utf8'),
          metadata: type === 'query' ? { language: 'sql' } : {},
          tags,
        },
        { sourceHash: hash },
      );
      return { status: 'created', item };
    }

    const fileMime = mime && mime !== 'application/octet-stream' ? mime : guessMime(name);
    const stored = storage.save(buffer, name);
    try {
      const item = repo.create(
        { type: 'file', title: name.slice(0, TITLE_MAX), tags },
        {
          file: {
            name,
            mime: fileMime,
            size: stored.size,
            path: stored.path,
            hash: stored.hash,
            extractedText: await extractText(buffer, { mime: fileMime, name }),
          },
        },
      );
      return { status: 'created', item };
    } catch (err) {
      storage.remove(stored.path);
      throw err;
    }
  }

  function importBookmarks(html, { tags = [] } = {}) {
    let created = 0;
    let skipped = 0;
    for (const bookmark of parseBookmarksHtml(html)) {
      let url;
      try {
        url = new URL(bookmark.url);
      } catch {
        skipped++;
        continue;
      }
      if (!['http:', 'https:'].includes(url.protocol) || repo.findLinkByUrl(url.href)) {
        skipped++;
        continue;
      }
      repo.create({
        type: 'link',
        title: (bookmark.title || url.hostname).slice(0, TITLE_MAX),
        metadata: { url: url.href },
        tags: [...tags, ...bookmark.folders.map(slugTag).filter(Boolean)],
      });
      created++;
    }
    return { created, skipped };
  }

  return { importFile, importBookmarks };
}
```

`src/import/directory.js`:

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { slugTag } from './importer.js';

const SKIP_DIRS = new Set(['node_modules']);
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

export async function importDirectory(root, importer, { tags = [], maxBytes = DEFAULT_MAX_BYTES, onProgress } = {}) {
  const summary = { created: 0, skipped: 0, failed: [] };
  for (const file of walkFiles(root)) {
    const rel = relative(root, file);
    const folderTags = rel.split(sep).slice(0, -1).map(slugTag).filter(Boolean);
    try {
      if (statSync(file).size > maxBytes) throw new Error(`File terlalu besar (maks ${Math.round(maxBytes / 1024 / 1024)} MB)`);
      const result = await importer.importFile({ buffer: readFileSync(file), name: basename(file), tags: [...tags, ...folderTags] });
      summary[result.status]++;
      onProgress?.(rel, result.status);
    } catch (err) {
      summary.failed.push({ path: rel, error: err.message });
      onProgress?.(rel, 'failed');
    }
  }
  return summary;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/importer.test.js`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add src/import test/importer.test.js
git commit -m "feat: import massal file, folder, dan bookmark browser"
```

---

### Task 8: Backup harian + export

**Files:**
- Create: `src/backup/backup.js`, `src/backup/export.js`
- Test: `test/backup.test.js`

**Interfaces:**
- Consumes: `openDb`, `createItemRepository` (`all`), `createFileStorage` (`absolutePath`), `slugTag`
- Produces:
  - `createBackup({ db, filesDir, backupDir, keep = 7, now = new Date() }) → { dbFile, copiedFiles, removed: string[] }`: DB ke `<backupDir>/db/hesewake-YYYY-MM-DD.db` lewat `VACUUM INTO` (aman saat server jalan), file baru disalin ke `<backupDir>/files/` (nama file UUID tidak pernah berubah, jadi cukup salin yang belum ada), simpan `keep` DB terakhir
  - `hasBackupFor(backupDir, now) → boolean`
  - `exportAll({ repo, storage, outDir }) → { items }`: `items.json` (semua item, secret tetap ciphertext), `items/<id>-<slug>.md`, `files/<id>-<nama asli>`

- [ ] **Step 1: Tulis failing test**

`test/backup.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createBackup, hasBackupFor } from '../src/backup/backup.js';
import { exportAll } from '../src/backup/export.js';

const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test('createBackup: salin DB dan file baru saja', () => {
  const db = openDb();
  createItemRepository(db).create({ type: 'note', title: 'Catatan penting' });
  const filesDir = tempDir('hdb-files-');
  mkdirSync(join(filesDir, '2026', '10'), { recursive: true });
  writeFileSync(join(filesDir, '2026', '10', 'a.pdf'), 'pdf');
  const backupDir = tempDir('hdb-backup-');
  const now = new Date('2026-10-07T03:00:00Z');

  assert.equal(hasBackupFor(backupDir, now), false);
  const first = createBackup({ db, filesDir, backupDir, now });
  assert.equal(first.copiedFiles, 1);
  assert.ok(existsSync(first.dbFile));
  assert.equal(hasBackupFor(backupDir, now), true);
  const copy = new Database(first.dbFile, { readonly: true });
  assert.equal(copy.prepare('SELECT title FROM items').get().title, 'Catatan penting');
  copy.close();

  assert.equal(createBackup({ db, filesDir, backupDir, now }).copiedFiles, 0);
  assert.equal(readFileSync(join(backupDir, 'files', '2026', '10', 'a.pdf'), 'utf8'), 'pdf');
});

test('createBackup: simpan hanya N salinan DB terakhir', () => {
  const db = openDb();
  const filesDir = tempDir('hdb-files-');
  const backupDir = tempDir('hdb-backup-');
  for (let day = 1; day <= 9; day++) {
    createBackup({ db, filesDir, backupDir, keep: 7, now: new Date(`2026-10-0${day}T03:00:00Z`) });
  }
  const files = readdirSync(join(backupDir, 'db')).sort();
  assert.equal(files.length, 7);
  assert.equal(files[0], 'hesewake-2026-10-03.db');
  assert.equal(files[6], 'hesewake-2026-10-09.db');
});

test('exportAll: JSON, Markdown, dan file asli', () => {
  const repo = createItemRepository(openDb());
  const storage = createFileStorage(tempDir('hdb-files-'));
  const stored = storage.save(Buffer.from('isi pdf'), 'Laporan Bulanan.pdf');
  const query = repo.create({ type: 'query', title: 'Pasien aktif', content: 'SELECT 1;', metadata: { language: 'sql' }, tags: ['simrs'] });
  const file = repo.create({ type: 'file', title: 'Laporan Bulanan.pdf' }, { file: { name: 'Laporan Bulanan.pdf', mime: 'application/pdf', size: stored.size, path: stored.path } });
  repo.create({ type: 'secret', title: 'DB prod', content: 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0' });

  const outDir = tempDir('hdb-export-');
  assert.deepEqual(exportAll({ repo, storage, outDir }), { items: 3 });

  const json = JSON.parse(readFileSync(join(outDir, 'items.json'), 'utf8'));
  assert.equal(json.items.length, 3);
  assert.equal(json.items[2].content, 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0');

  const md = readFileSync(join(outDir, 'items', `${String(query.id).padStart(4, '0')}-pasien-aktif.md`), 'utf8');
  assert.match(md, /^# Pasien aktif/);
  assert.match(md, /```sql\nSELECT 1;\n```/);
  assert.equal(readFileSync(join(outDir, 'files', `${String(file.id).padStart(4, '0')}-Laporan Bulanan.pdf`), 'utf8'), 'isi pdf');
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/backup.test.js`
Expected: FAIL, `Cannot find module '.../src/backup/backup.js'`

- [ ] **Step 3: Implementasi**

`src/backup/backup.js`:

```js
import { mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_FILE = /^hesewake-\d{4}-\d{2}-\d{2}\.db$/;

const stamp = (now) => now.toISOString().slice(0, 10);
const dbFileFor = (backupDir, now) => join(backupDir, 'db', `hesewake-${stamp(now)}.db`);

export function hasBackupFor(backupDir, now = new Date()) {
  return existsSync(dbFileFor(backupDir, now));
}

function syncFiles(src, dest) {
  if (!existsSync(src)) return 0;
  let copied = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += syncFiles(from, to);
    } else if (!existsSync(to)) {
      mkdirSync(dest, { recursive: true });
      copyFileSync(from, to);
      copied++;
    }
  }
  return copied;
}

export function createBackup({ db, filesDir, backupDir, keep = 7, now = new Date() }) {
  const dbDir = join(backupDir, 'db');
  mkdirSync(dbDir, { recursive: true });
  const dbFile = dbFileFor(backupDir, now);
  rmSync(dbFile, { force: true });
  // VACUUM INTO menghasilkan salinan konsisten walau server sedang menulis.
  db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);

  const copiedFiles = syncFiles(filesDir, join(backupDir, 'files'));

  const snapshots = readdirSync(dbDir).filter((name) => DB_FILE.test(name)).sort();
  const removed = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const name of removed) rmSync(join(dbDir, name), { force: true });

  return { dbFile, copiedFiles, removed };
}
```

`src/backup/export.js`:

```js
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugTag } from '../import/importer.js';

const CODE_TYPES = new Set(['query', 'command', 'config', 'api_request', 'schema']);

const padId = (id) => String(id).padStart(4, '0');
const safeFileName = (name) => name.replace(/[\\/:*?"<>|]/g, '_');

function toMarkdown(item) {
  const lines = [`# ${item.title}`, '', `- Tipe: ${item.type}`];
  if (item.tags.length) lines.push(`- Tag: ${item.tags.join(', ')}`);
  if (item.ticketId) lines.push(`- Tiket: ${item.ticketId}`);
  for (const [key, value] of Object.entries(item.metadata)) lines.push(`- ${key}: ${value}`);
  if (item.file) lines.push(`- File: ${padId(item.id)}-${safeFileName(item.file.name)}`);
  lines.push(`- Dibuat: ${item.createdAt}`, `- Diubah: ${item.updatedAt}`, '');

  if (item.encrypted) {
    lines.push('_Isi secret terenkripsi. Buka lewat aplikasi atau baca ciphertext di items.json._');
  } else if (CODE_TYPES.has(item.type)) {
    lines.push('```' + (item.metadata.language ?? ''), item.content, '```');
  } else if (item.content) {
    lines.push(item.content);
  }
  return lines.join('\n') + '\n';
}

export function exportAll({ repo, storage, outDir }) {
  const items = repo.all();
  mkdirSync(join(outDir, 'items'), { recursive: true });
  mkdirSync(join(outDir, 'files'), { recursive: true });
  writeFileSync(join(outDir, 'items.json'), JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2));

  for (const item of items) {
    const slug = slugTag(item.title).slice(0, 60) || 'item';
    writeFileSync(join(outDir, 'items', `${padId(item.id)}-${slug}.md`), toMarkdown(item));
    if (item.file) {
      copyFileSync(storage.absolutePath(item.file.path), join(outDir, 'files', `${padId(item.id)}-${safeFileName(item.file.name)}`));
    }
  }
  return { items: items.length };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --test test/backup.test.js`
Expected: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add src/backup test/backup.test.js
git commit -m "feat: backup harian dengan retensi dan export JSON/Markdown"
```

---

### Task 9: REST API (Hono)

**Files:**
- Create: `src/api/app.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: repository (semua method di atas), storage (`save`, `openReadStream`, `remove`, `absolutePath`), importer (`importFile`, `importBookmarks`), `extractText`, `fetchLinkPreview`, `TYPES`, error classes
- Produces: `createApp({ repo, storage, importer, linkPreview = fetchLinkPreview, maxUploadBytes = 100 MB, maxImportBytes = 1024 MB }) → Hono`. Plan 2 menambah opsi `auth` dan route `/api/auth/*`.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/types` | - | `TYPES` |
| GET | `/api/tags` | - | `[{ name, count }]` |
| GET | `/api/items` | `?q=&type=&tag=&ticket=&archived=1&trashed=1&limit=&offset=` | `Item[]` |
| GET | `/api/items/:id` | - | `Item` |
| POST | `/api/items` | JSON item (bukan `file`) | `201 Item` |
| PATCH | `/api/items/:id` | JSON patch | `Item` |
| DELETE | `/api/items/:id` | `?permanent=1` opsional | `204` (trash, atau hapus permanen + file fisik) |
| POST | `/api/items/:id/restore` | - | `Item` |
| GET | `/api/items/:id/versions` | - | `Version[]` |
| POST | `/api/items/:id/versions/:versionId/restore` | - | `Item` |
| POST | `/api/files` | multipart: `file`*, `title`, `content`, `tags`, `ticketId` (maks `maxUploadBytes`) | `201 Item` |
| GET | `/api/items/:id/download` | - | stream file + `Content-Disposition` |
| POST | `/api/import/files` | multipart: `files` (banyak), `tags` (maks `maxImportBytes`) | `{ created, skipped, failed, itemIds }` |
| POST | `/api/import/bookmarks` | multipart: `file` (HTML bookmark), `tags` | `{ created, skipped }` |
| GET | `/api/link-preview` | `?url=` | preview |

Melebihi batas ukuran → `413 { error }`.

- [ ] **Step 1: Install dependency**

```bash
npm install hono
```

- [ ] **Step 2: Tulis failing test**

`test/api.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter } from '../src/import/importer.js';
import { createApp } from '../src/api/app.js';

const CIPHER = 'v1.AAAAAAAAAAAAAAAA.c2VjcmV0LWRhdGE';

function setup(options = {}) {
  const repo = createItemRepository(openDb());
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-api-')));
  const app = createApp({ repo, storage, importer: createImporter({ repo, storage }), ...options });
  return { app, storage };
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const ids = (items) => items.map((i) => i.id);

test('GET /api/types', async () => {
  const { app } = setup();
  const res = await app.request('/api/types');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).query.label, 'Query');
});

test('CRUD item: create, get, patch, list, search', async () => {
  const { app } = setup();
  const created = await app.request('/api/items', json('POST', {
    type: 'command', title: 'Restart php-fpm', content: 'sudo systemctl restart php8.2-fpm', tags: ['server'],
  }));
  assert.equal(created.status, 201);
  const item = await created.json();
  assert.equal((await (await app.request(`/api/items/${item.id}`)).json()).content, 'sudo systemctl restart php8.2-fpm');
  assert.equal((await (await app.request(`/api/items/${item.id}`, json('PATCH', { pinned: true }))).json()).pinned, true);
  assert.deepEqual(ids(await (await app.request('/api/items?tag=server')).json()), [item.id]);
  assert.deepEqual(ids(await (await app.request('/api/items?q=systemctl')).json()), [item.id]);
});

test('arsip: hilang dari list default, muncul di ?archived=1', async () => {
  const { app } = setup();
  const item = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Catatan lama' }))).json();
  await app.request(`/api/items/${item.id}`, json('PATCH', { archived: true }));
  assert.deepEqual(await (await app.request('/api/items')).json(), []);
  assert.deepEqual(ids(await (await app.request('/api/items?archived=1')).json()), [item.id]);
});

test('versi: daftar dan kembalikan', async () => {
  const { app } = setup();
  const item = await (await app.request('/api/items', json('POST', { type: 'note', title: 'SOP release', content: 'langkah 1' }))).json();
  await app.request(`/api/items/${item.id}`, json('PATCH', { content: 'langkah 1 dan 2' }));
  const versions = await (await app.request(`/api/items/${item.id}/versions`)).json();
  assert.deepEqual(versions.map((v) => v.content), ['langkah 1']);
  const restored = await (await app.request(`/api/items/${item.id}/versions/${versions[0].id}/restore`, { method: 'POST' })).json();
  assert.equal(restored.content, 'langkah 1');
});

test('trash: delete, restore, hapus permanen', async () => {
  const { app } = setup();
  const item = await (await app.request('/api/items', json('POST', { type: 'note', title: 'Draft', tags: ['tmp'] }))).json();

  assert.equal((await app.request(`/api/items/${item.id}?permanent=1`, { method: 'DELETE' })).status, 400);
  assert.equal((await app.request(`/api/items/${item.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual(await (await app.request('/api/items')).json(), []);
  assert.deepEqual(ids(await (await app.request('/api/items?trashed=1')).json()), [item.id]);

  const restored = await (await app.request(`/api/items/${item.id}/restore`, { method: 'POST' })).json();
  assert.equal(restored.deletedAt, null);

  await app.request(`/api/items/${item.id}`, { method: 'DELETE' });
  assert.equal((await app.request(`/api/items/${item.id}?permanent=1`, { method: 'DELETE' })).status, 204);
  assert.equal((await app.request(`/api/items/${item.id}`)).status, 404);
  assert.deepEqual(await (await app.request('/api/tags')).json(), []);
});

test('secret: hanya menerima ciphertext, list tanpa isi', async () => {
  const { app } = setup();
  assert.equal((await app.request('/api/items', json('POST', { type: 'secret', title: 'Token Odoo', content: 'abc123' }))).status, 400);
  const item = await (await app.request('/api/items', json('POST', { type: 'secret', title: 'Token Odoo', content: CIPHER }))).json();
  assert.equal(item.encrypted, true);
  assert.equal((await (await app.request(`/api/items/${item.id}`)).json()).content, CIPHER);
  const [listed] = await (await app.request('/api/items?type=secret')).json();
  assert.equal(listed.content, null);
});

test('error dikembalikan sebagai JSON dengan status yang sesuai', async () => {
  const { app } = setup();
  const invalid = await app.request('/api/items', json('POST', { type: 'query', title: 'x' }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /metadata.language wajib/);
  assert.equal((await app.request('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await app.request('/api/items', json('POST', { type: 'file', title: 'x' }))).status, 400);
  assert.equal((await app.request('/api/items/abc')).status, 400);
  assert.equal((await app.request('/api/items?ticket=x')).status, 400);
});

test('upload, cari, download (stream), trash, hapus permanen file', async () => {
  const { app, storage } = setup();
  const form = new FormData();
  form.append('file', new Blob(['SELECT * FROM kunjungan;'], { type: 'text/plain' }), 'kunjungan.sql');
  form.append('tags', 'simrs, query');
  form.append('ticketId', '8193');

  const res = await app.request('/api/files', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.type, 'file');
  assert.equal(item.ticketId, 8193);
  assert.deepEqual(item.tags, ['query', 'simrs']);

  assert.deepEqual(ids(await (await app.request('/api/items?q=kunjungan&type=file')).json()), [item.id]);

  const download = await app.request(`/api/items/${item.id}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('Content-Disposition'), /kunjungan\.sql/);
  assert.equal(await download.text(), 'SELECT * FROM kunjungan;');

  const abs = storage.absolutePath(item.file.path);
  await app.request(`/api/items/${item.id}`, { method: 'DELETE' });
  assert.equal(existsSync(abs), true, 'file tetap ada selama item di trash');
  await app.request(`/api/items/${item.id}?permanent=1`, { method: 'DELETE' });
  assert.equal(existsSync(abs), false);
});

test('upload: tanpa file → 400, melebihi batas → 413', async () => {
  const { app } = setup({ maxUploadBytes: 200 });
  const empty = new FormData();
  empty.append('title', 'kosong');
  assert.equal((await app.request('/api/files', { method: 'POST', body: empty })).status, 400);

  const big = new FormData();
  big.append('file', new Blob(['x'.repeat(1000)]), 'besar.txt');
  const res = await app.request('/api/files', { method: 'POST', body: big });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /terlalu besar/);
});

test('import banyak file sekaligus, duplikat dilewati', async () => {
  const { app } = setup();
  const form = new FormData();
  form.append('files', new Blob(['SELECT 1;']), 'satu.sql');
  form.append('files', new Blob(['# Rapat']), 'rapat.md');
  form.append('files', new Blob(['SELECT 1;']), 'salinan-satu.sql');
  form.append('tags', 'impor');
  const res = await app.request('/api/import/files', { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.deepEqual({ created: summary.created, skipped: summary.skipped, failed: summary.failed }, { created: 2, skipped: 1, failed: [] });
  assert.equal(summary.itemIds.length, 2);
  assert.equal((await (await app.request('/api/items?tag=impor')).json()).length, 2);
});

test('import bookmark HTML', async () => {
  const { app } = setup();
  const html = '<DL><p><DT><H3>Kerja</H3><DL><p><DT><A HREF="https://laravel.com/docs">Laravel</A></DL><p></DL>';
  const form = new FormData();
  form.append('file', new Blob([html], { type: 'text/html' }), 'bookmarks.html');
  const res = await app.request('/api/import/bookmarks', { method: 'POST', body: form });
  assert.deepEqual(await res.json(), { created: 1, skipped: 0 });
  const [link] = await (await app.request('/api/items?type=link')).json();
  assert.deepEqual(link.tags, ['kerja']);
});

test('GET /api/link-preview', async () => {
  const calls = [];
  const { app } = setup({
    linkPreview: async (url) => {
      calls.push(url);
      return { url, title: 'Laravel', description: '', image: '', siteName: 'laravel.com' };
    },
  });
  const res = await app.request('/api/link-preview?url=https%3A%2F%2Flaravel.com');
  assert.equal((await res.json()).title, 'Laravel');
  assert.deepEqual(calls, ['https://laravel.com']);
  assert.equal((await app.request('/api/link-preview')).status, 400);
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `node --test test/api.test.js`
Expected: FAIL, `Cannot find module '.../src/api/app.js'`

- [ ] **Step 4: Implementasi**

`src/api/app.js`:

```js
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { TYPES } from '../items/types.js';
import { extractText } from '../files/extract.js';
import { fetchLinkPreview } from '../links/preview.js';
import { AppError, NotFoundError, ValidationError } from '../errors.js';

const MB = 1024 * 1024;

function parseOptionalInt(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${name} harus bilangan bulat`);
  return n;
}

const parseFlag = (value) => value === '1' || value === 'true';
const parseTags = (value) => (value ? String(value).split(',') : []);

function parseId(c, param = 'id') {
  const id = parseOptionalInt(c.req.param(param), param);
  if (!id) throw new ValidationError(`${param} tidak valid`);
  return id;
}

async function readJson(c) {
  let body;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('Body harus JSON valid');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Body harus object');
  return body;
}

function sizeLimit(maxBytes) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => c.json({ error: `File terlalu besar (maks ${Math.round(maxBytes / MB) || 1} MB)` }, 413),
  });
}

export function createApp({
  repo,
  storage,
  importer,
  linkPreview = fetchLinkPreview,
  maxUploadBytes = 100 * MB,
  maxImportBytes = 1024 * MB,
}) {
  const app = new Hono().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  app.get('/types', (c) => c.json(TYPES));
  app.get('/tags', (c) => c.json(repo.tags()));

  app.get('/items', (c) => {
    const q = c.req.query();
    const filters = {
      type: q.type || undefined,
      tag: q.tag || undefined,
      ticketId: parseOptionalInt(q.ticket, 'ticket'),
      archived: parseFlag(q.archived),
      trashed: parseFlag(q.trashed),
      limit: parseOptionalInt(q.limit, 'limit') ?? 50,
      offset: parseOptionalInt(q.offset, 'offset') ?? 0,
    };
    return c.json(q.q ? repo.search(q.q, filters) : repo.list(filters));
  });

  app.get('/items/:id', (c) => c.json(repo.get(parseId(c))));

  app.post('/items', async (c) => {
    const body = await readJson(c);
    if (body.type === 'file') throw new ValidationError('Upload file lewat POST /api/files');
    return c.json(repo.create(body), 201);
  });

  app.patch('/items/:id', async (c) => c.json(repo.update(parseId(c), await readJson(c))));

  app.delete('/items/:id', (c) => {
    const id = parseId(c);
    if (parseFlag(c.req.query('permanent'))) {
      const item = repo.purge(id);
      if (item.file) storage.remove(item.file.path);
    } else {
      repo.trash(id);
    }
    return c.body(null, 204);
  });

  app.post('/items/:id/restore', (c) => c.json(repo.restore(parseId(c))));
  app.get('/items/:id/versions', (c) => c.json(repo.versions(parseId(c))));
  app.post('/items/:id/versions/:versionId/restore', (c) => c.json(repo.restoreVersion(parseId(c), parseId(c, 'versionId'))));

  app.post('/files', sizeLimit(maxUploadBytes), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ValidationError('Field "file" wajib diisi');

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const stored = storage.save(buffer, file.name);
    try {
      const item = repo.create(
        {
          type: 'file',
          title: form.title || file.name,
          content: form.content || '',
          tags: parseTags(form.tags),
          ticketId: parseOptionalInt(form.ticketId, 'ticketId'),
        },
        {
          file: {
            name: file.name,
            mime,
            size: stored.size,
            path: stored.path,
            hash: stored.hash,
            extractedText: await extractText(buffer, { mime, name: file.name }),
          },
        },
      );
      return c.json(item, 201);
    } catch (err) {
      storage.remove(stored.path);
      throw err;
    }
  });

  app.get('/items/:id/download', (c) => {
    const item = repo.get(parseId(c));
    if (!item.file) throw new NotFoundError('Item ini tidak punya file');
    return c.body(Readable.toWeb(storage.openReadStream(item.file.path)), 200, {
      'Content-Type': item.file.mime,
      'Content-Length': String(item.file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.file.name)}`,
    });
  });

  app.post('/import/files', sizeLimit(maxImportBytes), async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = [form.files ?? []].flat().filter((f) => f instanceof File);
    if (!files.length) throw new ValidationError('Pilih minimal satu file');
    const tags = parseTags([form.tags ?? ''].flat()[0]);

    const summary = { created: 0, skipped: 0, failed: [], itemIds: [] };
    for (const file of files) {
      try {
        const result = await importer.importFile({ buffer: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type, tags });
        summary[result.status]++;
        if (result.status === 'created') summary.itemIds.push(result.item.id);
      } catch (err) {
        summary.failed.push({ path: file.name, error: err.message });
      }
    }
    return c.json(summary);
  });

  app.post('/import/bookmarks', sizeLimit(maxUploadBytes), async (c) => {
    const form = await c.req.parseBody();
    if (!(form.file instanceof File)) throw new ValidationError('Field "file" wajib diisi (hasil export bookmark browser)');
    return c.json(importer.importBookmarks(await form.file.text(), { tags: parseTags(form.tags) }));
  });

  app.get('/link-preview', async (c) => {
    const url = c.req.query('url');
    if (!url) throw new ValidationError('Query url wajib diisi');
    return c.json(await linkPreview(url));
  });

  return app;
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS, semua test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/api test/api.test.js
git commit -m "feat: REST API untuk item, versi, trash, file, import, dan link preview"
```

---

### Task 10: Server, config, job harian, CLI, README

**Files:**
- Create: `src/config.js`, `src/server.js`, `src/cli/context.js`, `src/cli/import.js`, `src/cli/export.js`, `src/cli/backup.js`, `README.md`
- Modify: `package.json` (scripts)
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: semua modul di atas
- Produces:
  - `loadConfig(env = process.env) → { dataDir, dbFile, filesDir, backupDir, port, host, trashDays, backupKeep, maxUploadBytes, maxImportBytes }`
  - `openContext(config?) → { config, db, repo, storage, importer }` (dipakai CLI dan Plan 2)
  - `npm start` (server + job harian), `npm run import -- <folder> [--tag a,b] [--bookmarks file.html]`, `npm run export -- <folder>`, `npm run backup`

- [ ] **Step 1: Install dependency**

```bash
npm install @hono/node-server
```

Tambahkan ke `scripts` di `package.json`:

```json
"import": "node src/cli/import.js",
"export": "node src/cli/export.js",
"backup": "node src/cli/backup.js"
```

- [ ] **Step 2: Tulis failing test**

`test/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const MB = 1024 * 1024;

test('loadConfig default', () => {
  const dataDir = join(homedir(), '.hesewake-database');
  assert.deepEqual(loadConfig({}), {
    dataDir,
    dbFile: join(dataDir, 'hesewake.db'),
    filesDir: join(dataDir, 'files'),
    backupDir: join(dataDir, 'backups'),
    port: 4321,
    host: '127.0.0.1',
    trashDays: 30,
    backupKeep: 7,
    maxUploadBytes: 100 * MB,
    maxImportBytes: 1024 * MB,
  });
});

test('loadConfig override lewat env, host tetap localhost', () => {
  const config = loadConfig({
    HDB_DATA_DIR: 'D:/vault',
    HDB_BACKUP_DIR: 'C:/Users/ThinkPad/OneDrive/hesewake-backup',
    HDB_PORT: '5000',
    HDB_HOST: '0.0.0.0',
    HDB_TRASH_DAYS: '7',
    HDB_BACKUP_KEEP: '14',
    HDB_MAX_UPLOAD_MB: '20',
    HDB_MAX_IMPORT_MB: '200',
  });
  assert.equal(config.dbFile, join('D:/vault', 'hesewake.db'));
  assert.equal(config.backupDir, 'C:/Users/ThinkPad/OneDrive/hesewake-backup');
  assert.equal(config.port, 5000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.trashDays, 7);
  assert.equal(config.backupKeep, 14);
  assert.equal(config.maxUploadBytes, 20 * MB);
  assert.equal(config.maxImportBytes, 200 * MB);
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `node --test test/config.test.js`
Expected: FAIL, `Cannot find module '.../src/config.js'`

- [ ] **Step 4: Implementasi**

`src/config.js`:

```js
import { homedir } from 'node:os';
import { join } from 'node:path';

const MB = 1024 * 1024;

export function loadConfig(env = process.env) {
  const dataDir = env.HDB_DATA_DIR || join(homedir(), '.hesewake-database');
  return {
    dataDir,
    dbFile: join(dataDir, 'hesewake.db'),
    filesDir: join(dataDir, 'files'),
    backupDir: env.HDB_BACKUP_DIR || join(dataDir, 'backups'),
    port: Number(env.HDB_PORT || 4321),
    // Akses dari perangkat lain lewat `tailscale serve` (Plan 2), jadi server sendiri cukup di loopback.
    host: '127.0.0.1',
    trashDays: Number(env.HDB_TRASH_DAYS ?? 30),
    backupKeep: Number(env.HDB_BACKUP_KEEP ?? 7),
    maxUploadBytes: Number(env.HDB_MAX_UPLOAD_MB ?? 100) * MB,
    maxImportBytes: Number(env.HDB_MAX_IMPORT_MB ?? 1024) * MB,
  };
}
```

`src/cli/context.js`:

```js
import { mkdirSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { createItemRepository } from '../items/repository.js';
import { createFileStorage } from '../files/storage.js';
import { createImporter } from '../import/importer.js';

export function openContext(config = loadConfig()) {
  mkdirSync(config.filesDir, { recursive: true });
  const db = openDb(config.dbFile);
  const repo = createItemRepository(db);
  const storage = createFileStorage(config.filesDir);
  return { config, db, repo, storage, importer: createImporter({ repo, storage }) };
}
```

`src/server.js`:

```js
import { serve } from '@hono/node-server';
import { openContext } from './cli/context.js';
import { createApp } from './api/app.js';
import { createBackup, hasBackupFor } from './backup/backup.js';

const HOUR_MS = 60 * 60 * 1000;

const { config, db, repo, storage, importer } = openContext();

function dailyJobs() {
  const purged = repo.purgeExpired({ days: config.trashDays });
  for (const item of purged) {
    if (item.file) storage.remove(item.file.path);
  }
  if (purged.length) console.log(`Trash: ${purged.length} item dihapus permanen`);

  if (!hasBackupFor(config.backupDir)) {
    try {
      const result = createBackup({ db, filesDir: config.filesDir, backupDir: config.backupDir, keep: config.backupKeep });
      console.log(`Backup: ${result.dbFile} (+${result.copiedFiles} file)`);
    } catch (err) {
      console.error(`Backup gagal: ${err.message}`);
    }
  }
}

// Dicek tiap jam supaya laptop yang baru bangun dari sleep tetap dapat backup hari itu.
dailyJobs();
setInterval(dailyJobs, HOUR_MS).unref();

const app = createApp({
  repo,
  storage,
  importer,
  maxUploadBytes: config.maxUploadBytes,
  maxImportBytes: config.maxImportBytes,
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`hesewake-database jalan di http://${config.host}:${info.port} (data: ${config.dataDir})`);
});
```

`src/cli/import.js`:

```js
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
```

`src/cli/export.js`:

```js
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
```

`src/cli/backup.js`:

```js
import { openContext } from './context.js';
import { createBackup } from '../backup/backup.js';

const { config, db } = openContext();
const result = createBackup({ db, filesDir: config.filesDir, backupDir: config.backupDir, keep: config.backupKeep });
console.log(`Backup: ${result.dbFile} (+${result.copiedFiles} file baru, ${result.removed.length} salinan lama dihapus)`);
```

`README.md`:

````markdown
# hesewake-database

Database personal untuk dokumen dan catatan kerjaan: file (PDF, Word, Excel, gambar), catatan, query, link,
command, API request, error & solusi, skema tabel, log kerja per tiket, kontak, server, dan secret terenkripsi.

## Jalankan

```bash
npm install
npm start          # http://127.0.0.1:4321
npm test
```

| Env | Default | Keterangan |
|---|---|---|
| `HDB_DATA_DIR` | `~/.hesewake-database` | Lokasi DB dan file |
| `HDB_BACKUP_DIR` | `<data>/backups` | Arahkan ke folder OneDrive/Google Drive supaya backup ada di luar laptop |
| `HDB_BACKUP_KEEP` | `7` | Jumlah salinan DB harian yang disimpan |
| `HDB_PORT` | `4321` | Port HTTP |
| `HDB_TRASH_DAYS` | `30` | Item di trash dihapus permanen setelah sekian hari |
| `HDB_MAX_UPLOAD_MB` | `100` | Batas satu file upload |
| `HDB_MAX_IMPORT_MB` | `1024` | Batas satu request import |

## Import massal

```bash
npm run import -- "D:/Dokumen Kerja" --tag kerja
npm run import -- --bookmarks "C:/Users/ThinkPad/Downloads/bookmarks.html"
```

- Subfolder jadi tag (`SIMRS/Query/x.sql` → tag `simrs`, `query`).
- `.sql` jadi item Query, `.md`/`.txt` jadi Catatan, sisanya jadi File (PDF, docx, dan xlsx ikut bisa dicari isinya).
- File yang isinya sama dan link dengan URL sama dilewati, jadi import boleh diulang.
- Bookmark: di Chrome/Edge buka `chrome://bookmarks` → titik tiga → Export bookmarks.

## Backup dan export

- Server membuat backup sekali sehari (DB + file baru) ke `HDB_BACKUP_DIR`. Manual: `npm run backup`.
- Export semua data ke format terbuka: `npm run export -- D:/export-hesewake` (items.json, Markdown per item, file asli).
- Pulihkan dari backup: matikan server, salin `backups/db/hesewake-<tanggal>.db` jadi `hesewake.db`, salin isi `backups/files/` ke `files/`.
- Secret tetap terenkripsi di backup dan export. Tanpa master password isinya tidak bisa dibaca, dan master password tidak bisa di-reset.
````

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS, semua test.

- [ ] **Step 6: Smoke test manual**

Terminal 1:

```bash
HDB_DATA_DIR=./data npm start
```

Expected: log `Backup: ...hesewake-<hari ini>.db (+0 file)` lalu `hesewake-database jalan di http://127.0.0.1:4321 (data: ./data)`.

Terminal 2:

```bash
curl -s -X POST http://127.0.0.1:4321/api/items -H "Content-Type: application/json" \
  -d '{"type":"link","title":"Odoo tiket","metadata":{"url":"https://ticket.alfatih-solusindo.com"}}'
curl -s "http://127.0.0.1:4321/api/items?q=odoo"
mkdir -p tmp-import/SIMRS && echo "SELECT 1;" > tmp-import/SIMRS/cek.sql
HDB_DATA_DIR=./data npm run import -- tmp-import --tag coba
HDB_DATA_DIR=./data npm run export -- tmp-export
```

Expected: item `Odoo tiket` muncul di search; import mencetak `created  SIMRS\cek.sql` dan `Selesai: 1 dibuat`; folder `tmp-export` berisi `items.json`, `items/`, `files/`. Stop server, hapus `data`, `tmp-import`, `tmp-export`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config.js src/server.js src/cli README.md test/config.test.js
git commit -m "feat: server, job harian trash + backup, CLI import/export/backup, README"
```
