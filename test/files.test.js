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
