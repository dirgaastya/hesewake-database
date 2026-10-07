# hesewake-database Extra (Fase 4) Implementation Plan

> **For agentic workers:** Kerjakan task berurutan. Tiap task: test dulu, implementasi, `npm test` + `npm run test:web` hijau, commit.

**Goal:** Tiga fitur lanjutan: relasi antar item (error ↔ query ↔ log kerja), koleksi (kelompok item lintas tipe, misalnya "Release v2.3"), dan OCR supaya teks di screenshot bisa dicari.

**Architecture:**
- Migrasi 3: `item_links (a_id, b_id)` tidak berarah dengan `CHECK (a_id < b_id)`, `collections (id, name UNIQUE NOCASE)`, `collection_items (collection_id, item_id)`. Semua `ON DELETE CASCADE`.
- `src/items/relations.js`: `createRelations(db)` untuk link dan koleksi. Filter `collection` ditambahkan ke `repo.list/search`.
- OCR: `src/files/ocr.js` membungkus `tesseract.js` (bahasa `ind+eng`, worker dipakai ulang, timeout). `extractText` menerima opsi `ocr` untuk gambar (png, jpg, webp, bmp). `npm run ocr` memproses ulang gambar lama yang belum punya teks. Data bahasa diunduh tesseract.js sekali ke cache (`<dataDir>/ocr-cache`), setelah itu offline.
- UI: bagian "Terkait" dan "Koleksi" di pane detail, daftar koleksi + "Koleksi baru" di sidebar.

**Tech Stack:** `tesseract.js`.

## Global Constraints

- Relasi tidak boleh ke diri sendiri; relasi ganda diabaikan (idempoten).
- Nama koleksi 1–80 karakter, unik tanpa memperhatikan huruf besar/kecil.
- Hitungan item koleksi tidak termasuk item di trash.
- OCR best-effort: gagal atau timeout (60 detik) tidak menggagalkan upload. `HDB_OCR=0` mematikan OCR.

## Tasks

### Task 1: Relasi antar item
- Migrasi 3, `relations.link(a, b)`, `unlink`, `linksOf(id)` (item ringkas, tanpa yang di-purge).
- API: `GET/POST /api/items/:id/links`, `DELETE /api/items/:id/links/:targetId`.
- Test repo + API.

### Task 2: Koleksi
- `relations.collections()` (dengan `count`), `createCollection(name)`, `renameCollection`, `deleteCollection`, `addToCollection`, `removeFromCollection`, `collectionsOf(itemId)`; filter `collection` di list/search.
- API: `GET/POST /api/collections`, `PATCH/DELETE /api/collections/:id`, `POST /api/collections/:id/items`, `DELETE /api/collections/:id/items/:itemId`, `GET /api/items/:id/collections`, `GET /api/items?collection=<id>`.
- UI: sidebar "Koleksi" + tombol buat, bagian Koleksi di detail (tambah/lepas), filter.

### Task 3: OCR screenshot
- `createOcr({ cacheDir, langs, timeoutMs })` → `{ recognize(buffer), terminate() }`; `extractText(buffer, { mime, name, ocr })`.
- Importer dan `/api/files` meneruskan `ocr`. `repo.setExtractedText(id, text)` + `npm run ocr`.
- Test: `extractText` memanggil `ocr` untuk gambar dan tidak untuk PDF; repo reindex; smoke test manual dengan gambar berisi teks.
