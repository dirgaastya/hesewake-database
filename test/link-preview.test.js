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
