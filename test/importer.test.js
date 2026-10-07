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
