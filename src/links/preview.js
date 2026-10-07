import { ValidationError } from '../errors.js';

const MAX_HTML_CHARS = 1_000_000;
const TITLE_MAX = 200;
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

function decodeEntities(text) {
  return text.replace(/&(amp|quot|#39|#x27|lt|gt|nbsp);/g, (entity) => ENTITIES[entity]);
}

function readMetaTags(html) {
  const tags = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const [, name, , doubleQuoted, singleQuoted] of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs[name.toLowerCase()] = doubleQuoted ?? singleQuoted;
    }
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !tags.has(key)) tags.set(key, decodeEntities(attrs.content).trim());
  }
  return tags;
}

function fallbackPreview(url) {
  const { hostname, href } = new URL(url);
  return { url: href, title: hostname, description: '', image: '', siteName: hostname };
}

export function parseLinkPreview(html, url) {
  const meta = readMetaTags(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fallback = fallbackPreview(url);
  const title = meta.get('og:title') || meta.get('twitter:title') || (titleTag && decodeEntities(titleTag).trim()) || fallback.title;

  let image = meta.get('og:image') || meta.get('twitter:image') || '';
  if (image) {
    try {
      image = new URL(image, url).href;
    } catch {
      image = '';
    }
  }

  return {
    url: fallback.url,
    title: title.slice(0, TITLE_MAX),
    description: meta.get('og:description') || meta.get('description') || '',
    image,
    siteName: meta.get('og:site_name') || fallback.siteName,
  };
}

export async function fetchLinkPreview(url, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('URL tidak valid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new ValidationError('URL harus http atau https');

  // Preview cuma pemanis: gagal fetch tidak boleh menggagalkan penyimpanan link.
  try {
    const res = await fetchImpl(parsed.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (hesewake-database link preview)', Accept: 'text/html' },
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return fallbackPreview(parsed.href);
    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    return parseLinkPreview(html, res.url || parsed.href);
  } catch {
    return fallbackPreview(parsed.href);
  }
}
