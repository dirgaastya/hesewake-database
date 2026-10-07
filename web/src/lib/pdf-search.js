const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Kata dari kotak search (operator sudah dibuang oleh parseSearch). Kata 1 huruf diabaikan supaya tidak menyorot semua halaman.
export function searchTerms(text) {
  const terms = String(text ?? '')
    .split(/\s+/)
    .map((term) => term.replace(/["*]/g, '').trim())
    .filter((term) => term.length >= 2)
    .map(normalize);
  return [...new Set(terms)];
}

// Halaman dianggap cocok kalau memuat salah satu kata (sama seperti pencarian prefix di daftar).
export function pageMatches(pageText, terms) {
  if (!terms.length) return false;
  const haystack = normalize(pageText);
  return terms.some((term) => haystack.includes(term));
}

// Pecah teks jadi potongan biasa dan potongan yang cocok, untuk diberi <mark> di layer teks PDF.
export function highlightSegments(text, terms) {
  const source = String(text ?? '');
  if (!terms.length || !source) return [{ text: source, match: false }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|')})`, 'gi');
  const normalized = normalize(source);
  // normalize() tidak mengubah panjang untuk huruf Latin biasa; kalau berubah (huruf beraksen), cocokkan pada teks asli saja.
  const target = normalized.length === source.length ? normalized : source;
  const segments = [];
  let last = 0;
  for (const match of target.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: source.slice(last, match.index), match: false });
    segments.push({ text: source.slice(match.index, match.index + match[0].length), match: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last), match: false });
  return segments.length ? segments : [{ text: source, match: false }];
}

export const clampZoom = (zoom) => Math.min(3, Math.max(0.5, Math.round(zoom * 100) / 100));
