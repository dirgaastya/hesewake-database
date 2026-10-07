import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { extractText, canOcr } from '../src/files/extract.js';
import { createOcr } from '../src/files/ocr.js';

const fakeOcr = (text) => {
  const calls = [];
  return { calls, recognize: async (buffer) => (calls.push(buffer.length), text) };
};

test('extractText memakai OCR untuk gambar saja', async () => {
  const ocr = fakeOcr('ECONNREFUSED 127.0.0.1:5432');
  assert.equal(await extractText(Buffer.from([1, 2, 3]), { mime: 'image/png', name: 'error.png', ocr }), 'ECONNREFUSED 127.0.0.1:5432');
  assert.equal(await extractText(Buffer.from('x'), { mime: '', name: 'ss.JPG', ocr }), 'ECONNREFUSED 127.0.0.1:5432');
  assert.equal(await extractText(Buffer.from('a,b'), { mime: 'text/csv', name: 'x.csv', ocr }), 'a,b');
  assert.equal(await extractText(Buffer.from([1]), { mime: 'image/png', name: 'x.png' }), '', 'tanpa OCR gambar tidak punya teks');
  assert.equal(ocr.calls.length, 2);
  assert.equal(canOcr('image/svg+xml', 'logo.svg'), false);
  assert.equal(canOcr('image/gif', 'a.gif'), false);
});

test('extractText: OCR gagal tidak menggagalkan upload', async () => {
  const ocr = { recognize: async () => { throw new Error('worker mati'); } };
  assert.equal(await extractText(Buffer.from([1]), { mime: 'image/png', name: 'x.png', ocr }), '');
});

test('createOcr: satu worker dipakai ulang, job berurutan', async () => {
  let created = 0;
  let active = 0;
  let maxActive = 0;
  const createWorker = async (langs, oem, options) => {
    created++;
    assert.deepEqual(langs, ['ind', 'eng']);
    assert.equal(options.cachePath, undefined);
    return {
      recognize: async (buffer) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { data: { text: `teks ${buffer.toString()}  \nbaris 2 ` } };
      },
      terminate: async () => {},
    };
  };
  const ocr = createOcr({ createWorker });
  const results = await Promise.all([ocr.recognize(Buffer.from('a')), ocr.recognize(Buffer.from('b'))]);
  assert.deepEqual(results, ['teks a\nbaris 2', 'teks b\nbaris 2']);
  assert.equal(created, 1);
  assert.equal(maxActive, 1);
  await ocr.terminate();
});

test('createOcr: timeout membuang worker, job berikutnya pakai worker baru', async () => {
  let created = 0;
  let terminated = 0;
  const createWorker = async () => {
    created++;
    const slow = created === 1;
    return {
      recognize: () => (slow ? new Promise(() => {}) : Promise.resolve({ data: { text: 'ok' } })),
      terminate: async () => {
        terminated++;
      },
    };
  };
  const ocr = createOcr({ createWorker, timeoutMs: 20 });
  await assert.rejects(ocr.recognize(Buffer.from('x')), /OCR lebih dari/);
  assert.equal(terminated, 1);
  assert.equal(await ocr.recognize(Buffer.from('y')), 'ok');
  assert.equal(created, 2);
});

test('repo: gambar tanpa teks, lalu teks OCR bisa dicari', () => {
  const repo = createItemRepository(openDb());
  const image = repo.create({ type: 'file', title: 'error-login.png' }, { file: { name: 'error-login.png', mime: 'image/png', size: 10, path: '2026/10/a.png' } });
  repo.create({ type: 'file', title: 'spek.pdf' }, { file: { name: 'spek.pdf', mime: 'application/pdf', size: 10, path: '2026/10/b.pdf', extractedText: 'isi' } });
  assert.deepEqual(repo.imagesWithoutText().map((i) => i.id), [image.id]);
  repo.setExtractedText(image.id, 'SQLSTATE[08006] connection refused');
  assert.deepEqual(repo.search('sqlstate').map((i) => i.id), [image.id]);
  assert.deepEqual(repo.imagesWithoutText(), []);
});
