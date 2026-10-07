# hesewake-database CLI + Integrasi Odoo (Fase 3) Implementation Plan

> **For agentic workers:** Kerjakan task berurutan. Tiap task: test dulu, implementasi, `npm test` hijau, commit.

**Goal:** Akses hesewake-database dari terminal (`hdb`) tanpa membuka browser, dan sambungkan item dengan tiket Odoo lewat hesewake-cli: lihat judul/stage tiket di UI dan CLI, daftar item per tiket, dan tulis log kerja langsung dari terminal.

**Architecture:**
- `hdb` membaca DB langsung lewat `openContext()` (server tidak perlu jalan). Secret didekripsi di proses CLI dengan `src/shared/vault-crypto.js` setelah meminta master password (input tersembunyi). Parameter KDF dan `wrappedVaultKey` dibaca dari tabel `account`.
- Integrasi Odoo memakai `callOdoo` milik hesewake-cli (`HESEWAKE_CLI_DIR`, default `C:/Users/ThinkPad/Desktop/project/hesewake-cli`). API key tetap dikelola hesewake-cli (Windows Credential Manager); hesewake-database tidak pernah membaca atau menyimpan kredensial Odoo.
- `GET /api/tickets/:id` untuk UI, dengan cache memori 5 menit. Integrasi tidak tersedia → `503` dan UI diam.

**Tech Stack:** Node 22 (`node:util` parseArgs, `node:readline`), hesewake-cli (opsional).

## Global Constraints

- `hdb` tidak pernah mencetak isi secret kecuali `--reveal` diberikan; `hdb copy` untuk secret mengosongkan clipboard setelah 30 detik bila isinya belum berubah.
- Master password dibaca dari TTY dengan echo mati; tidak pernah dari argumen.
- Output default teks rapi untuk manusia; `--json` untuk dipakai skrip lain (misalnya hesewake-cli).
- URL tiket: `<odooUrl>/web#id=<id>&model=project.task&view_type=form`, `odooUrl` dari `~/.hesewake-cli/config.json`.

## Tasks

### Task 1: Layanan tiket Odoo
- `src/integrations/odoo.js`: `createTicketService({ loader, odooUrl, ttlMs, now })` → `get(id)` mengembalikan `{ id, name, stage, project, deadline, url }`, cache per id, `TicketUnavailableError` (503) kalau loader tidak ada/gagal koneksi, `NotFoundError` kalau task tidak ada. `loadHesewakeCli(dir)` → loader dari `utils/odoo/client.js` (search_read `project.task`, `active_test: false`).
- Test dengan loader palsu: bentuk data, cache, error.

### Task 2: Endpoint `/api/tickets/:id` + config
- `createApp({ tickets })`; `loadConfig` menambah `hesewakeCliDir`. Server membuat ticket service kalau folder hesewake-cli ada.
- Test API: 200, 404, 503 tanpa layanan.

### Task 3: CLI `hdb`
- `bin/hdb.js` + `src/cli/hdb/*.js`: `search`, `show`, `copy`, `add`, `ticket`, `help`. Fungsi perintah menerima `{ ctx, args, io }` supaya bisa dites tanpa TTY; `io` = `{ out, err, prompt, promptSecret, copy, readStdin }`.
- `ticket <id>`: info tiket (kalau integrasi ada) + item dengan `ticketId` itu; `--worklog "teks"` membuat item `worklog` dengan judul `Log <tanggal> · <nama tiket>`.
- Test: tiap perintah dengan ctx `:memory:` dan io palsu, termasuk dekripsi secret dengan password benar/salah dan placeholder di `copy`.
- `package.json` `bin: { hdb: "bin/hdb.js" }`, README bagian CLI, `npm link` agar `hdb` tersedia global.
