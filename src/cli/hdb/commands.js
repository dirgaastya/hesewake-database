import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { deriveKeys, unwrapVaultKey, encryptText, decryptText } from '../../shared/vault-crypto.js';
import { TYPES } from '../../items/types.js';
import { parseSearch } from '../../../web/src/lib/search-query.js';
import { findPlaceholders, fillPlaceholders } from '../../../web/src/lib/placeholders.js';
import { buildCurl } from '../../../web/src/lib/clipboard.js';
import { TYPE_META } from '../../../web/src/lib/types.js';
import { shortAge, padId, formatBytes } from '../../../web/src/lib/format.js';

export const HELP = `hdb: hesewake-database dari terminal

  hdb search <kata...> [--type T] [--tag T] [--ticket N] [--archived] [--trash] [--limit N] [--json]
      Operator boleh ditulis langsung: hdb search type:query tag:simrs rawat inap
  hdb show <id> [--reveal] [--json]     Tampilkan item (secret hanya dengan --reveal)
  hdb copy <id>                         Salin isi ke clipboard (isi {{variabel}}, secret dikosongkan setelah 30 detik)
  hdb add <tipe> --title "..." [--content "..." | --content -] [--tag a,b] [--ticket N] [--meta key=value]...
      Tipe: ${Object.keys(TYPES).join(', ')}
      Tipe file: hdb add file --path <file> [--tag a,b]   Tipe secret: nilai ditanya tanpa ditampilkan
  hdb ticket <id> [--worklog "teks"] [--json]   Info tiket Odoo + item yang terkait
  hdb open <id>                         Buka item di browser
`;

const COPY_FIELD = { link: (item) => item.metadata.url, api_request: (item) => buildCurl(item.metadata) };

function table(items) {
  return items.map((item) => {
    const meta = TYPE_META[item.type];
    const aside = [item.ticketId && `T-${item.ticketId}`, item.archived && 'ARSIP', item.deletedAt && 'TRASH', shortAge(item.updatedAt)].filter(Boolean).join(' · ');
    const lines = [`${padId(item.id).padEnd(7)}${meta.code.padEnd(8)}${item.title}${aside ? `   ${aside}` : ''}`];
    const snippet = item.snippet ? item.snippet.replace(/\[([^\]]*)\]/g, '$1') : null;
    if (snippet) lines.push(`${' '.repeat(15)}${snippet.replace(/\s+/g, ' ').slice(0, 110)}`);
    return lines.join('\n');
  });
}

async function openVault(ctx, io) {
  const account = ctx.db.prepare('SELECT kdf_salt, kdf_iterations, wrapped_vault_key FROM account WHERE id = 1').get();
  if (!account) throw new Error('Akun belum dibuat. Buka http://127.0.0.1:4321 dan buat master password dulu.');
  const password = await io.promptSecret('Master password: ');
  const { wrapKey } = await deriveKeys(password, account.kdf_salt, account.kdf_iterations);
  return unwrapVaultKey(wrapKey, account.wrapped_vault_key);
}

function requireId(value) {
  const id = Number(String(value ?? '').replace(/^#/, ''));
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID item tidak valid. Contoh: hdb show 128');
  return id;
}

const COMMANDS = {
  async search({ ctx, io, positionals, values }) {
    const parsed = parseSearch(positionals.join(' '));
    const filters = {
      type: values.type ?? parsed.type,
      tag: values.tag ?? parsed.tag,
      ticketId: values.ticket ? Number(values.ticket) : parsed.ticket ? Number(parsed.ticket) : undefined,
      archived: values.archived || parsed.archived,
      trashed: values.trash || parsed.trashed,
      pinned: parsed.pinned || undefined,
      limit: values.limit ? Number(values.limit) : 30,
    };
    const items = parsed.text ? ctx.repo.search(parsed.text, filters) : ctx.repo.list(filters);
    if (values.json) return io.out(JSON.stringify(items, null, 2));
    if (!items.length) return io.out(parsed.text ? `Tidak ada yang cocok dengan "${parsed.text}".` : 'Belum ada item.');
    io.out(table(items).join('\n'));
  },

  async show({ ctx, io, positionals, values }) {
    const item = ctx.repo.get(requireId(positionals[0]));
    let content = item.content;
    if (item.encrypted) content = values.reveal ? await decryptText(await openVault(ctx, io), item.content) : '••••••••••••  (pakai --reveal untuk menampilkan)';
    if (values.json) return io.out(JSON.stringify({ ...item, content }, null, 2));
    const lines = [
      `${padId(item.id)}  ${TYPE_META[item.type].label}${item.ticketId ? `  ·  Tiket ${item.ticketId}` : ''}${item.deletedAt ? '  ·  TRASH' : ''}`,
      item.title,
      item.tags.length ? item.tags.map((t) => `#${t}`).join(' ') : null,
      '',
      ...Object.entries(item.metadata).map(([key, value]) => `${key}: ${value}`),
      item.file ? `file: ${item.file.name} (${formatBytes(item.file.size)})` : null,
      Object.keys(item.metadata).length || item.file ? '' : null,
      content || null,
    ].filter((line) => line !== null);
    io.out(lines.join('\n'));
  },

  async copy({ ctx, io, positionals }) {
    const item = ctx.repo.get(requireId(positionals[0]));
    if (item.type === 'file') throw new Error('Item file tidak bisa disalin sebagai teks. Pakai: hdb open ' + item.id);
    if (item.encrypted) {
      const secret = await decryptText(await openVault(ctx, io), item.content);
      await io.copy(secret);
      io.out('Secret disalin. Clipboard dikosongkan dalam 30 detik (Ctrl+C untuk membiarkan).');
      await io.wait(30_000);
      if ((await io.readClipboard()) === secret) {
        await io.copy('');
        io.out('Clipboard dikosongkan.');
      } else {
        io.out('Clipboard sudah berisi hal lain, tidak diubah.');
      }
      return;
    }
    let text = COPY_FIELD[item.type]?.(item) ?? item.content;
    const names = findPlaceholders(text);
    if (names.length) {
      const values = {};
      for (const name of names) values[name] = await io.prompt(`{{${name}}}: `);
      text = fillPlaceholders(text, values);
    }
    await io.copy(text);
    io.out(`"${item.title}" disalin.`);
  },

  async add({ ctx, io, positionals, values }) {
    const type = positionals[0];
    if (!TYPES[type]) throw new Error(`Tipe tidak dikenal: ${type ?? '(kosong)'}. Pilihan: ${Object.keys(TYPES).join(', ')}`);
    const tags = values.tag ? values.tag.split(',') : [];
    const ticketId = values.ticket ? Number(values.ticket) : null;

    if (type === 'file') {
      if (!values.path) throw new Error('Tipe file butuh --path <file>');
      const result = await ctx.importer.importFile({ buffer: readFileSync(values.path), name: basename(values.path), tags });
      return io.out(result.status === 'created' ? `${padId(result.item.id)} dibuat dari ${basename(values.path)}` : `Sudah ada: ${padId(result.item.id)} ${result.item.title}`);
    }

    const metadata = {};
    for (const pair of values.meta ?? []) {
      const at = pair.indexOf('=');
      if (at < 1) throw new Error(`--meta harus berbentuk key=value: ${pair}`);
      metadata[pair.slice(0, at)] = pair.slice(at + 1);
    }
    if (type === 'query' && !metadata.language) metadata.language = 'sql';

    let content = values.content === '-' ? await io.readStdin() : (values.content ?? '');
    if (type === 'secret') {
      if (values.content) throw new Error('Jangan menulis secret di argumen (tersimpan di riwayat shell). Nilainya akan ditanyakan.');
      const vaultKey = await openVault(ctx, io);
      const secret = await io.promptSecret('Nilai secret: ');
      if (!secret) throw new Error('Nilai secret kosong.');
      content = await encryptText(vaultKey, secret);
    }
    const item = ctx.repo.create({ type, title: values.title, content, metadata, tags, ticketId });
    io.out(`${padId(item.id)} ${TYPE_META[type].label.toLowerCase()} disimpan: ${item.title}`);
  },

  async ticket({ ctx, io, positionals, values, tickets }) {
    const id = requireId(positionals[0]);
    let info = null;
    let note = null;
    try {
      info = tickets ? await tickets.get(id) : null;
      if (!tickets) note = 'Integrasi Odoo tidak aktif (hesewake-cli tidak ditemukan).';
    } catch (err) {
      note = err.message;
    }

    if (values.worklog) {
      const date = new Date().toISOString().slice(0, 10);
      const item = ctx.repo.create({ type: 'worklog', title: `Log ${date} · ${info?.name ?? `Tiket ${id}`}`.slice(0, 200), content: values.worklog, ticketId: id, tags: [] });
      io.out(`${padId(item.id)} log kerja ditambahkan ke tiket ${id}.`);
    }

    const items = ctx.repo.list({ ticketId: id, limit: 100 });
    if (values.json) return io.out(JSON.stringify({ ticket: info, items }, null, 2));
    if (info) io.out(`Tiket #${info.id}  ${info.name}\n${[info.project, info.stage, info.deadline && `deadline ${info.deadline.slice(0, 10)}`].filter(Boolean).join(' · ')}\n${info.url}\n`);
    else io.out(`Tiket #${id}${note ? `  (${note})` : ''}\n`);
    io.out(items.length ? table(items).join('\n') : 'Belum ada item untuk tiket ini.');
  },

  async open({ ctx, io, positionals }) {
    const item = ctx.repo.get(requireId(positionals[0]));
    const url = `http://127.0.0.1:${ctx.config.port}/items/${item.id}`;
    await io.openUrl(url);
    io.out(url);
  },

  async help({ io }) {
    io.out(HELP);
  },
};

const OPTIONS = {
  type: { type: 'string' },
  tag: { type: 'string' },
  ticket: { type: 'string' },
  limit: { type: 'string' },
  title: { type: 'string' },
  content: { type: 'string' },
  path: { type: 'string' },
  worklog: { type: 'string' },
  meta: { type: 'string', multiple: true },
  archived: { type: 'boolean' },
  trash: { type: 'boolean' },
  reveal: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export async function runHdb(argv, { ctx, io, tickets }) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    io.err(err.message);
    return 2;
  }
  const [name = 'help', ...positionals] = parsed.positionals;
  const command = parsed.values.help ? COMMANDS.help : COMMANDS[name];
  if (!command) {
    io.err(`Perintah tidak dikenal: ${name}\n\n${HELP}`);
    return 2;
  }
  try {
    await command({ ctx, io, positionals, values: parsed.values, tickets });
    return 0;
  } catch (err) {
    io.err(/OperationError|Master password salah/.test(`${err.name} ${err.message}`) ? 'Master password salah.' : err.message);
    return 1;
  }
}
