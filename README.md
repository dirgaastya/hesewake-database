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

## Akses dari HP dan laptop lain (Tailscale)

Server tetap hanya listen di `127.0.0.1`. Perangkat lain masuk lewat jaringan privat Tailscale, tidak lewat internet publik.

1. Install Tailscale di laptop ini dan di HP/laptop lain, login dengan akun yang sama.
2. Di admin Tailscale (DNS), aktifkan **MagicDNS** dan **HTTPS Certificates**.
3. Di laptop server: `tailscale serve --bg 4321`. Cek URL-nya dengan `tailscale serve status`, misalnya `https://thinkpad.tail1234.ts.net`.
4. Jalankan server dengan host itu diizinkan:
   `HDB_ALLOWED_HOSTS=thinkpad.tail1234.ts.net npm start`
5. Buat akun pertama kali dari laptop server (`http://127.0.0.1:4321`). Setelah itu login dari perangkat lain lewat URL `ts.net`.
6. Laptop harus menyala dan tidak sleep. Supaya server jalan otomatis saat login Windows:
   `schtasks /Create /SC ONLOGON /TN hesewake-database /TR "cmd /c cd /d C:\Users\ThinkPad\Desktop\project\personal\hesewake-database && set HDB_ALLOWED_HOSTS=thinkpad.tail1234.ts.net && npm start"`

Jangan pakai `tailscale funnel`: itu membuka server ke internet publik.

| Env | Default | Keterangan |
|---|---|---|
| `HDB_ALLOWED_HOSTS` | (kosong) | Nama host `ts.net`, pisahkan dengan koma |
| `HDB_SESSION_DAYS` | `30` | Lama login bertahan per perangkat |

Semua endpoint `/api/*` butuh login, kecuali `/api/auth/status`, `/api/auth/params`, `/api/auth/setup`, dan `/api/auth/login`.
Master password tidak pernah dikirim ke server: browser menurunkan kunci login dan kunci enkripsi darinya (`src/shared/vault-crypto.js`).

## CLI `hdb`

`npm link` sekali di folder ini, lalu `hdb` bisa dipanggil dari mana saja. CLI membaca DB langsung, server tidak perlu jalan.

```bash
hdb search type:query tag:simrs rawat inap      # cari, operator sama dengan UI
hdb show 128                                    # detail (secret disembunyikan)
hdb show 119 --reveal                           # minta master password, tampilkan secret
hdb copy 128                                    # salin ke clipboard, isi {{variabel}} dulu
cat pasien.sql | hdb add query --title "Pasien per bangsal" --content - --tag simrs --ticket 8193
hdb add secret --title "DB staging" --meta username=root   # nilai ditanya tanpa ditampilkan
hdb add file --path "D:/Dokumen/spek.pdf" --tag laporan
hdb ticket 8193                                 # info tiket Odoo + item terkait
hdb ticket 8193 --worklog "Ubah join tarif ke kelas_kamar"
hdb open 128                                    # buka di browser
```

Tambah `--json` di `search`, `show`, dan `ticket` untuk dipakai skrip lain (misalnya hesewake-cli).

## Integrasi Odoo

Kalau hesewake-cli ada di `~/Desktop/project/hesewake-cli` (atau `HESEWAKE_CLI_DIR`) dan sudah login, server dan `hdb ticket` menampilkan judul, stage, dan link tiket Odoo untuk item yang punya nomor tiket. Kredensial Odoo tetap dikelola hesewake-cli; hesewake-database tidak membaca atau menyimpannya.

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
