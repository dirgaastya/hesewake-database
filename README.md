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
