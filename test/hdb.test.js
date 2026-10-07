import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection.js';
import { createItemRepository } from '../src/items/repository.js';
import { createFileStorage } from '../src/files/storage.js';
import { createImporter } from '../src/import/importer.js';
import { createAccountService } from '../src/auth/account.js';
import { newSalt, deriveKeys, createVaultKey, encryptText, decryptText, unwrapVaultKey } from '../src/shared/vault-crypto.js';
import { runHdb } from '../src/cli/hdb/commands.js';

const PASSWORD = 'kuda-laut-2026';

async function setup({ withAccount = false } = {}) {
  const db = openDb();
  const repo = createItemRepository(db);
  const storage = createFileStorage(mkdtempSync(join(tmpdir(), 'hdb-cli-')));
  const ctx = { db, repo, storage, importer: createImporter({ repo, storage }), config: { port: 4321 } };
  let vaultKey = null;
  if (withAccount) {
    const salt = newSalt();
    const { authKey, wrapKey } = await deriveKeys(PASSWORD, salt, 1000);
    const created = await createVaultKey(wrapKey);
    vaultKey = created.vaultKey;
    createAccountService(db, { minIterations: 1000 }).setup({ salt, iterations: 1000, authKey, wrappedVaultKey: created.wrappedVaultKey, device: 'test' });
  }
  return { ctx, repo, vaultKey };
}

function fakeIo({ answers = [], secrets = [], stdin = '', clipboardLater } = {}) {
  const io = {
    output: [],
    errors: [],
    clipboard: null,
    opened: null,
    out: (text) => io.output.push(text),
    err: (text) => io.errors.push(text),
    prompt: async () => answers.shift() ?? '',
    promptSecret: async () => secrets.shift() ?? '',
    readStdin: async () => stdin,
    copy: async (text) => {
      io.clipboard = text;
    },
    readClipboard: async () => clipboardLater ?? io.clipboard,
    wait: async () => {},
    openUrl: async (url) => {
      io.opened = url;
    },
  };
  return io;
}

const run = (argv, ctx, io, tickets) => runHdb(argv, { ctx, io, tickets });

test('search dengan operator dan output tabel', async () => {
  const { ctx, repo } = await setup();
  repo.create({ type: 'query', title: 'Pasien rawat inap aktif', content: 'SELECT * FROM pasien_rawat_inap', metadata: { language: 'sql' }, tags: ['simrs'], ticketId: 8193 });
  repo.create({ type: 'note', title: 'Rapat UAT' });
  const io = fakeIo();
  assert.equal(await run(['search', 'type:query', 'rawat'], ctx, io), 0);
  assert.match(io.output[0], /#0001  QUERY   Pasien rawat inap aktif   T-8193/);
  assert.match(io.output[0], /pasien_rawat_inap/);

  const json = fakeIo();
  await run(['search', '--tag', 'simrs', '--json'], ctx, json);
  assert.equal(JSON.parse(json.output[0]).length, 1);

  const none = fakeIo();
  await run(['search', 'tidakada'], ctx, none);
  assert.equal(none.output[0], 'Tidak ada yang cocok dengan "tidakada".');
});

test('add query dari stdin, lalu copy dengan placeholder', async () => {
  const { ctx, repo } = await setup();
  const io = fakeIo({ stdin: "SELECT * FROM pasien WHERE bangsal = {{bangsal}};" });
  assert.equal(await run(['add', 'query', '--title', 'Pasien per bangsal', '--content', '-', '--tag', 'simrs', '--ticket', '8193'], ctx, io), 0);
  assert.match(io.output[0], /#0001 query disimpan: Pasien per bangsal/);
  const item = repo.get(1);
  assert.deepEqual(item.metadata, { language: 'sql' });
  assert.equal(item.ticketId, 8193);

  const copyIo = fakeIo({ answers: ["'MELATI'"] });
  assert.equal(await run(['copy', '1'], ctx, copyIo), 0);
  assert.equal(copyIo.clipboard, "SELECT * FROM pasien WHERE bangsal = 'MELATI';");
});

test('copy link dan api_request', async () => {
  const { ctx, repo } = await setup();
  repo.create({ type: 'link', title: 'Laravel', metadata: { url: 'https://laravel.com/docs' } });
  repo.create({ type: 'api_request', title: 'Pasien', metadata: { method: 'GET', url: 'https://api.rs.local/pasien' } });
  const io = fakeIo();
  await run(['copy', '#1'], ctx, io);
  assert.equal(io.clipboard, 'https://laravel.com/docs');
  await run(['copy', '2'], ctx, io);
  assert.equal(io.clipboard, "curl -X GET 'https://api.rs.local/pasien'");
});

test('secret: add meminta password dan nilai, show --reveal dan copy membuka dengan password', async () => {
  const { ctx, repo } = await setup({ withAccount: true });
  const io = fakeIo({ secrets: [PASSWORD, 'Stg#rsud-2026!pg'] });
  assert.equal(await run(['add', 'secret', '--title', 'DB staging'], ctx, io), 0);
  const stored = repo.get(1).content;
  assert.match(stored, /^v1\./);

  const hidden = fakeIo();
  await run(['show', '1'], ctx, hidden);
  assert.match(hidden.output[0], /••••/);
  assert.doesNotMatch(hidden.output[0], /Stg#rsud/);

  const reveal = fakeIo({ secrets: [PASSWORD] });
  await run(['show', '1', '--reveal'], ctx, reveal);
  assert.match(reveal.output[0], /Stg#rsud-2026!pg/);

  const copy = fakeIo({ secrets: [PASSWORD] });
  await run(['copy', '1'], ctx, copy);
  assert.equal(copy.clipboard, '', 'clipboard dikosongkan karena isinya belum berubah');
  assert.match(copy.output.join('\n'), /Clipboard dikosongkan/);

  const changed = fakeIo({ secrets: [PASSWORD], clipboardLater: 'teks lain' });
  await run(['copy', '1'], ctx, changed);
  assert.equal(changed.clipboard, 'Stg#rsud-2026!pg');

  const wrong = fakeIo({ secrets: ['salah-total'] });
  assert.equal(await run(['show', '1', '--reveal'], ctx, wrong), 1);
  assert.deepEqual(wrong.errors, ['Master password salah.']);
});

test('secret: menolak nilai dari argumen', async () => {
  const { ctx } = await setup({ withAccount: true });
  const io = fakeIo();
  assert.equal(await run(['add', 'secret', '--title', 'x', '--content', 'p@ss'], ctx, io), 1);
  assert.match(io.errors[0], /riwayat shell/);
});

test('add file lewat importer', async () => {
  const { ctx, repo } = await setup();
  const dir = mkdtempSync(join(tmpdir(), 'hdb-cli-file-'));
  const path = join(dir, 'catatan rapat.txt');
  writeFileSync(path, 'Rapat UAT farmasi');
  const io = fakeIo();
  await run(['add', 'file', '--path', path], ctx, io);
  assert.equal(repo.get(1).type, 'note');
  const again = fakeIo();
  await run(['add', 'file', '--path', path], ctx, again);
  assert.match(again.output[0], /Sudah ada/);
});

test('ticket: info Odoo, daftar item, dan --worklog', async () => {
  const { ctx, repo } = await setup();
  repo.create({ type: 'query', title: 'Query tarif', content: 'SELECT 1', metadata: { language: 'sql' }, ticketId: 8193 });
  const tickets = { get: async (id) => ({ id, name: 'Hotfix tarif kamar VIP', stage: 'TODO', project: 'Medicare', deadline: '2026-10-09 10:00:00', url: 'https://x/web#id=8193' }) };
  const io = fakeIo();
  assert.equal(await run(['ticket', '8193', '--worklog', 'Ubah join tarif ke kelas_kamar'], ctx, io, tickets), 0);
  const text = io.output.join('\n');
  assert.match(text, /log kerja ditambahkan/);
  assert.match(text, /Tiket #8193  Hotfix tarif kamar VIP/);
  assert.match(text, /Medicare · TODO · deadline 2026-10-09/);
  assert.match(text, /LOG     Log \d{4}-\d{2}-\d{2} · Hotfix tarif kamar VIP/);
  assert.match(text, /QUERY   Query tarif/);

  const offline = fakeIo();
  await run(['ticket', '8193'], ctx, offline, undefined);
  assert.match(offline.output[0], /Integrasi Odoo tidak aktif/);
});

test('open, help, dan perintah tidak dikenal', async () => {
  const { ctx, repo } = await setup();
  repo.create({ type: 'note', title: 'x' });
  const io = fakeIo();
  await run(['open', '1'], ctx, io);
  assert.equal(io.opened, 'http://127.0.0.1:4321/items/1');
  const help = fakeIo();
  await run([], ctx, help);
  assert.match(help.output[0], /hdb search/);
  const bad = fakeIo();
  assert.equal(await run(['hapus'], ctx, bad), 2);
  assert.match(bad.errors[0], /Perintah tidak dikenal: hapus/);
});

test('vault-crypto dipakai konsisten dengan browser', async () => {
  const { ctx, vaultKey } = await setup({ withAccount: true });
  const io = fakeIo({ secrets: [PASSWORD, 'token-odoo'] });
  await run(['add', 'secret', '--title', 'Token'], ctx, io);
  assert.equal(await decryptText(vaultKey, ctx.repo.get(1).content), 'token-odoo');
  const account = ctx.db.prepare('SELECT * FROM account').get();
  const { wrapKey } = await deriveKeys(PASSWORD, account.kdf_salt, account.kdf_iterations);
  assert.equal(await decryptText(await unwrapVaultKey(wrapKey, account.wrapped_vault_key), await encryptText(vaultKey, 'a')), 'a');
});
