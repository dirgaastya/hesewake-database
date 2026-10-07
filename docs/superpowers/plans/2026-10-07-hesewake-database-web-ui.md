# hesewake-database Web UI (Fase 2) Implementation Plan

> **For agentic workers:** Kerjakan task berurutan. Tiap task: tulis test (kalau ada logika), implementasi, `npm run test:web` + `npm test` hijau, commit.

**Goal:** Antarmuka web React untuk seluruh fitur backend (Plan 1 + 2): login dan vault di browser, daftar berkolom dengan search, detail per tipe, form tambah/edit, riwayat versi, command palette, tempel cepat, import massal, dan pengaturan perangkat. Mengikuti design system Hesewake.

**Architecture:** Single-page app di `web/` (Vite + React 19 + Tailwind v4), ditulis dalam JavaScript (JSX) seperti backend. Data lewat TanStack Query ke `/api/*`. Kunci vault hanya hidup di memori (`VaultProvider`), dibuang setelah 15 menit idle. Build (`web/dist`) disajikan oleh server Hono yang sama, jadi UI dan API satu origin (cookie `SameSite=Strict` dan guard Origin tetap berlaku). Saat development, Vite proxy `/api` ke `127.0.0.1:4321`.

**Tech Stack:** React, Vite, `@vitejs/plugin-react`, Tailwind v4 (`@tailwindcss/vite`), `@tanstack/react-query`, `cmdk`, `@uiw/react-codemirror` + `@codemirror/lang-sql`/`lang-json`/`lang-javascript`/`legacy-modes` + `@uiw/codemirror-theme-github`, `sql-formatter`, `react-markdown` + `remark-gfm`, `mermaid` (lazy), `motion`, `lucide-react`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`. Test: `vitest` + `jsdom` + `@testing-library/react`.

**Design system:** https://claude.ai/artifact/65tE6KrCyvfoMsXsrSemkt (token, komponen, motion, shortcut, aturan copy).

## Global Constraints

- Semua constraint Plan 1 dan 2 tetap berlaku. Master password, `wrapKey`, dan `vaultKey` tidak pernah disimpan di `localStorage`/`sessionStorage`/IndexedDB.
- Hanya token semantik di class Tailwind (`bg-surface`, `text-fg-muted`, `border-line`, `bg-accent`…). Nama warna Tailwind langsung hanya untuk kotak kategori TypeStamp lewat token `cat-*`.
- Radius hanya `rounded-xs` (2px), `rounded-sm` (4px), `rounded-md` (6px). Shadow hanya `shadow-float`.
- Bahasa UI: Indonesia, sentence case, tanpa emoji.
- Shortcut: Ctrl K, Ctrl Shift P, `/`, `n`, `e`, `c`, `h`, ↑ ↓, Ctrl Enter, Esc. Shortcut satu huruf mati saat fokus di input.
- Motion: preset `snappy`/`smooth`/`bouncy` dari design system, `<MotionConfig reducedMotion="user">`.
- UI dan API satu origin di produksi. Saat dev, jalankan server dengan `HDB_ALLOWED_HOSTS=localhost:5173`.

## File Structure

```
web/
├─ index.html · vite.config.js
└─ src/
   ├─ main.jsx · App.jsx · styles.css          # entry, router sederhana, token Tailwind
   ├─ lib/
   │  ├─ api.js           # fetch wrapper + ApiError
   │  ├─ types.js         # kode/kategori/label/ikon per tipe item, field per tipe
   │  ├─ search-query.js  # parse "type:query tag:simrs rawat"
   │  ├─ capture.js       # tebak tipe dari teks clipboard
   │  ├─ placeholders.js  # {{variabel}} di query/command
   │  ├─ format.js        # tanggal relatif, ukuran file, ID
   │  ├─ motion.js        # preset spring
   │  └─ shortcuts.js     # hook keyboard
   ├─ vault/VaultProvider.jsx   # vaultKey di memori, auto-lock, encrypt/decrypt
   ├─ components/        # Button, Kbd, TypeStamp, MetaLabel, ItemRow, NavItem, CodeView, CodeEditor,
   │                     # SecretField, VaultStatus, Toast, Dialog, Banner, EmptyState, TagInput, ...
   └─ screens/           # AuthScreen, Workspace, ItemDetail, ItemForm, VersionHistory, CommandPalette,
                         # QuickCapture, ImportScreen, SettingsScreen
```

## Tasks

### Task 1: Scaffold web + server menyajikan UI
- Install dependency, `web/vite.config.js` (root `web`, proxy `/api`, vitest jsdom), `web/index.html`, `styles.css` dengan token design system (light/dark via `.dark`), font self-host.
- `src/server.js`: Hono root app = API + `serveStatic` dari `web/dist` + fallback `index.html` untuk path non-API, security headers juga untuk halaman.
- Test (`test/static.test.js`): `createRootApp` menyajikan `index.html` untuk `/`, `/import`; `/api/...` tetap ke API; path traversal ditolak.

### Task 2: Library klien murni (dites dengan vitest)
- `search-query.js`: `parseSearch("type:query tag:SIMRS ticket:8193 rawat inap")` → `{ type, tag, ticket, archived, trashed, text }`; operator `is:archived`, `is:trash`, `is:pinned`.
- `capture.js`: `guessCapture(text)` sesuai tabel QuickCapture (url, curl, sql, error, command, env, note).
- `placeholders.js`: `findPlaceholders(text)` dan `fillPlaceholders(text, values)`.
- `types.js`: `TYPE_META[type] = { code, category, label, icon, codeLanguage }`, `CODE_TYPES`.
- `format.js`: `relativeTime`, `formatBytes`, `padId`.
- `api.js`: `api(path, options)` JSON, `ApiError` dengan status + pesan.

### Task 3: Vault + layar auth
- `VaultProvider`: state `{ unlocked, lockAt }`, `unlock(password)`, `lock()`, `encrypt(text)`, `decrypt(payload)`, `touch()`; auto-lock 15 menit idle; tidak menyimpan kunci di storage. Test vitest dengan `deriveKeys` iterasi rendah.
- `AuthScreen`: setup (hanya di 127.0.0.1/localhost), login (nama perangkat otomatis dari user agent), error + shake.
- `UnlockDialog`.

### Task 4: Workspace (layout, sidebar, daftar)
- Top bar (wordmark, SearchField dengan operator, VaultStatus, tombol Item baru), sidebar (Semua/Disematkan/Arsip/Trash, tipe, tag dari `/api/tags`), daftar berkolom `ItemRow` dengan highlight snippet, ↑↓ navigasi, EmptyState dan skeleton.

### Task 5: Detail item
- Tampilan per tipe: CodeView (CodeMirror read-only + format SQL + salin dengan isi placeholder), Markdown + Mermaid (lazy), link dengan preview, file (download, gambar/PDF preview), secret (SecretField), metadata, tiket.
- Aksi: pin, arsip, trash/restore, hapus permanen (Dialog), salin (C), edit (E), riwayat (H). Toast.

### Task 6: Form tambah/edit
- Pemilih tipe, field metadata per tipe, CodeEditor, TagInput dengan saran, URL link → isi otomatis dari `/api/link-preview`, secret dienkripsi sebelum dikirim, upload file untuk tipe file. Ctrl Enter simpan.

### Task 7: Riwayat versi
- Daftar versi + diff baris (`diffLines` di `lib/diff.js`, dites) + kembalikan versi.

### Task 8: Command palette, shortcut, QuickCapture
- `cmdk` mode item (search API) dan perintah. Shortcut global. Tempel/seret di luar input → QuickCapture → simpan / buka form / import.

### Task 9: Import + Pengaturan
- ImportScreen: drop/pilih file & folder (`webkitdirectory`), unggah bertahap 20 file per request, progres, laporan; bookmark HTML.
- SettingsScreen: tema (sistem/terang/gelap), perangkat login + keluarkan, ganti master password (rewrap), logout.

### Task 10: Build + verifikasi di browser
- `npm run build`, server menyajikan UI, cek manual di Chrome: setup akun, tambah query/link/secret, search, palette, import, dark mode.
