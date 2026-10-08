import { ValidationError } from '../errors.js';

const TITLE_MAX = 200;

// Format ciphertext dari browser (Plan 2): v1.<iv 12 byte base64url>.<ciphertext+tag base64url>
export const CIPHERTEXT_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;

export const TYPES = {
  note: { label: 'Catatan', fields: [] },
  idea: { label: 'Ide / TODO', fields: [{ key: 'status', options: ['open', 'done'] }] },
  learning: { label: 'Learning', fields: [{ key: 'source' }] },
  meeting: { label: 'Meeting', fields: [{ key: 'date' }, { key: 'participants' }] },
  template: { label: 'Template', fields: [] },
  sop: { label: 'Prosedur / SOP', fields: [] },
  query: { label: 'Query', fields: [{ key: 'language', required: true }, { key: 'database' }] },
  command: { label: 'Command', fields: [{ key: 'shell' }] },
  config: { label: 'Config / Env', fields: [{ key: 'format' }] },
  link: { label: 'Link', fields: [{ key: 'url', required: true }, { key: 'description' }, { key: 'image' }, { key: 'imageFile' }, { key: 'imageMime' }] },
  api_request: {
    label: 'API Request',
    fields: [
      { key: 'method', required: true, options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', required: true },
      { key: 'headers' },
      { key: 'body' },
    ],
  },
  error_solution: { label: 'Error & Solusi', fields: [{ key: 'error_message', required: true }, { key: 'cause' }] },
  schema: { label: 'Skema Tabel', fields: [{ key: 'database' }, { key: 'table', required: true }] },
  worklog: { label: 'Log Kerja', fields: [{ key: 'branch' }], requiresTicket: true },
  contact: {
    label: 'Kontak / PIC',
    fields: [{ key: 'role' }, { key: 'organization' }, { key: 'phone' }, { key: 'email' }],
  },
  server: {
    label: 'Server / Environment',
    fields: [
      { key: 'host', required: true },
      { key: 'port' },
      { key: 'environment', options: ['dev', 'staging', 'prod'] },
    ],
  },
  file: { label: 'File', fields: [], requiresFile: true },
  secret: { label: 'Secret', fields: [{ key: 'username' }, { key: 'url' }], encrypted: true },
};

export function validateItem(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Body harus object');

  const def = TYPES[input.type];
  if (!def) throw new ValidationError(`Tipe tidak dikenal: ${input.type}`);

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new ValidationError('title wajib diisi');
  if (title.length > TITLE_MAX) throw new ValidationError(`title maksimal ${TITLE_MAX} karakter`);

  const content = input.content ?? '';
  if (typeof content !== 'string') throw new ValidationError('content harus string');
  if (def.encrypted && !CIPHERTEXT_PATTERN.test(content)) {
    throw new ValidationError('Isi secret harus sudah terenkripsi di browser (format v1.<iv>.<data>)');
  }

  const ticketId = input.ticketId ?? null;
  if (ticketId !== null && !(Number.isInteger(ticketId) && ticketId > 0)) {
    throw new ValidationError('ticketId harus bilangan bulat positif');
  }
  if (def.requiresTicket && ticketId === null) {
    throw new ValidationError(`Tipe ${input.type} wajib punya ticketId`);
  }

  return {
    type: input.type,
    title,
    content,
    metadata: normalizeMetadata(def, input.metadata ?? {}),
    ticketId,
    pinned: Boolean(input.pinned),
    archived: Boolean(input.archived),
    tags: normalizeTags(input.tags ?? []),
  };
}

function normalizeMetadata(def, metadata) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new ValidationError('metadata harus object');
  }
  const fields = new Map(def.fields.map((f) => [f.key, f]));
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    const field = fields.get(key);
    if (!field) throw new ValidationError(`Field metadata tidak dikenal: ${key}`);
    if (value === null || value === '') continue;
    if (typeof value !== 'string') throw new ValidationError(`metadata.${key} harus string`);
    if (field.options && !field.options.includes(value)) {
      throw new ValidationError(`metadata.${key} harus salah satu dari: ${field.options.join(', ')}`);
    }
    out[key] = value;
  }
  for (const field of def.fields) {
    if (field.required && !out[field.key]) throw new ValidationError(`metadata.${field.key} wajib diisi`);
  }
  return out;
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) throw new ValidationError('tags harus array');
  const out = new Set();
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new ValidationError('tag harus string');
    const name = tag.trim().toLowerCase();
    if (name) out.add(name);
  }
  return [...out];
}
