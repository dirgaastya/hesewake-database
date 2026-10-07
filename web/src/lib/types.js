// Kode, kategori, dan label per tipe item (README design system, bagian "Kode tipe item").
export const TYPE_META = {
  note: { code: 'NOTE', category: 'catatan', label: 'Catatan' },
  idea: { code: 'IDEA', category: 'catatan', label: 'Ide / TODO' },
  learning: { code: 'LEARN', category: 'catatan', label: 'Learning' },
  meeting: { code: 'MEET', category: 'catatan', label: 'Meeting' },
  template: { code: 'TMPL', category: 'catatan', label: 'Template' },
  sop: { code: 'SOP', category: 'catatan', label: 'Prosedur' },
  query: { code: 'QUERY', category: 'kode', label: 'Query', language: 'sql' },
  command: { code: 'CMD', category: 'kode', label: 'Command', language: 'shell' },
  config: { code: 'CONF', category: 'kode', label: 'Config', language: 'properties' },
  api_request: { code: 'API', category: 'kode', label: 'API request', language: 'markdown' },
  schema: { code: 'SCHEMA', category: 'kode', label: 'Skema tabel', language: 'sql' },
  error_solution: { code: 'ERROR', category: 'error', label: 'Error & solusi' },
  worklog: { code: 'LOG', category: 'kerja', label: 'Log kerja' },
  contact: { code: 'PIC', category: 'kerja', label: 'Kontak' },
  server: { code: 'SERVER', category: 'kerja', label: 'Server' },
  link: { code: 'LINK', category: 'referensi', label: 'Link' },
  file: { code: 'FILE', category: 'referensi', label: 'File' },
  secret: { code: 'SECRET', category: 'secret', label: 'Secret' },
};

export const TYPE_ORDER = Object.keys(TYPE_META);

export const CODE_TYPES = new Set(['query', 'command', 'config', 'schema']);

export const FIELD_LABELS = {
  language: 'Bahasa',
  database: 'Database',
  shell: 'Shell',
  format: 'Format',
  url: 'URL',
  description: 'Deskripsi',
  image: 'Gambar',
  method: 'Method',
  headers: 'Headers',
  body: 'Body',
  error_message: 'Pesan error',
  cause: 'Penyebab',
  table: 'Tabel',
  branch: 'Branch',
  role: 'Peran',
  organization: 'Organisasi',
  phone: 'Telepon',
  email: 'Email',
  host: 'Host',
  port: 'Port',
  environment: 'Environment',
  status: 'Status',
  source: 'Sumber',
  date: 'Tanggal',
  participants: 'Peserta',
  username: 'Username',
};

// Field metadata yang isinya panjang atau berupa kode: tampil sebagai textarea mono.
export const MULTILINE_FIELDS = new Set(['headers', 'body', 'error_message', 'description']);
export const MONO_FIELDS = new Set(['url', 'headers', 'body', 'error_message', 'host', 'port', 'table', 'database', 'branch', 'username']);

export const CONTENT_LABEL = {
  query: 'Isi query',
  command: 'Command',
  config: 'Isi config',
  schema: 'DDL atau catatan skema',
  error_solution: 'Solusi',
  api_request: 'Catatan',
  link: 'Catatan',
  server: 'Catatan',
  contact: 'Catatan',
  secret: 'Nilai secret',
};

export const typeMeta = (type) => TYPE_META[type] ?? { code: type.toUpperCase(), category: 'catatan', label: type };
