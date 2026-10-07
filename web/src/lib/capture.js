const SQL = /^\s*(select|with|insert|update|delete|create|alter|drop|truncate)\b/i;
const SHELL = /^\s*(\$\s|git\s|npm\s|npx\s|pnpm\s|yarn\s|php artisan\b|composer\s|docker\s|kubectl\s|sudo\s|cd\s|ssh\s|scp\s|systemctl\s|psql\s|mysql\s)/i;
const ERROR_LINE = /(error|exception|econn\w*|sqlstate|fatal|traceback|warning:)/i;
const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function parseCurl(text) {
  const flat = text.replace(/\\\r?\n/g, ' ');
  const url = flat.match(/https?:\/\/[^\s'"]+/)?.[0] ?? '';
  const explicit = flat.match(/(?:-X|--request)\s+['"]?([A-Za-z]+)/)?.[1];
  const data = flat.match(/(?:-d|--data(?:-raw|-binary)?|--json)\s+(['"])([\s\S]*?)\1/)?.[2];
  const method = (explicit ?? (data ? 'POST' : 'GET')).toUpperCase();
  const headers = [...flat.matchAll(/(?:-H|--header)\s+(['"])(.*?)\1/g)].map((m) => m[2]).join('\n');
  let title = method;
  try {
    title = `${method} ${new URL(url).pathname}`;
  } catch {
    title = method;
  }
  const metadata = { method, url };
  if (headers) metadata.headers = headers;
  if (data) metadata.body = data;
  return { type: 'api_request', title, metadata, content: '' };
}

// Tebak tipe item dari teks yang ditempel (aturan di design system, komponen QuickCapture).
export function guessCapture(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0].trim();

  if (/^https?:\/\/\S+$/i.test(text)) return { type: 'link', title: '', metadata: { url: text }, content: '' };
  if (/^curl\s/i.test(text)) return parseCurl(text);
  if (SQL.test(text)) return { type: 'query', title: '', metadata: { language: 'sql' }, content: text };
  if (ERROR_LINE.test(firstLine) || lines.slice(1).some((line) => /^\s+at\s/.test(line))) {
    return { type: 'error_solution', title: firstLine.slice(0, 120), metadata: { error_message: text.slice(0, 2000) }, content: '' };
  }
  if (SHELL.test(text)) return { type: 'command', title: '', metadata: { shell: 'bash' }, content: text.replace(/^\$\s/gm, '') };
  const meaningful = lines.map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (meaningful.length && meaningful.every((line) => ENV_LINE.test(line))) {
    return { type: 'config', title: '', metadata: { format: 'env' }, content: text };
  }
  return { type: 'note', title: firstLine.slice(0, 120), metadata: {}, content: text };
}

// Satu baris tanpa spasi berisi campuran huruf, angka, dan simbol: jangan disimpan sebagai catatan biasa tanpa ditanya.
export function looksLikeSecret(raw) {
  const text = String(raw ?? '').trim();
  return (
    text.length >= 8 &&
    text.length <= 200 &&
    !/\s/.test(text) &&
    !/^https?:/i.test(text) &&
    /[a-z]/i.test(text) &&
    /[0-9]/.test(text) &&
    /[^A-Za-z0-9]/.test(text)
  );
}
