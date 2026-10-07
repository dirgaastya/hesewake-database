const KEYS = { type: 'type', tag: 'tag', ticket: 'ticket', tiket: 'ticket', is: 'is' };
const FLAGS = { archived: 'archived', arsip: 'archived', trash: 'trashed', pinned: 'pinned', disematkan: 'pinned' };

// "type:query tag:#simrs ticket:8193 is:arsip rawat inap" → filter API + teks bebas.
export function parseSearch(input) {
  const parsed = { text: '', type: undefined, tag: undefined, ticket: undefined, archived: false, trashed: false, pinned: false };
  const words = [];
  for (const token of String(input ?? '').trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^([a-z]+):(.+)$/i);
    const key = match && KEYS[match[1].toLowerCase()];
    if (!key) {
      words.push(token);
      continue;
    }
    const value = match[2].toLowerCase().replace(/^#/, '');
    if (key === 'is') {
      if (FLAGS[value]) parsed[FLAGS[value]] = true;
      else words.push(token);
    } else {
      parsed[key] = value;
    }
  }
  parsed.text = words.join(' ');
  return parsed;
}

export function toItemsQuery(parsed, { limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (parsed.text) params.set('q', parsed.text);
  if (parsed.type) params.set('type', parsed.type);
  if (parsed.tag) params.set('tag', parsed.tag);
  if (parsed.ticket) params.set('ticket', parsed.ticket);
  if (parsed.archived) params.set('archived', '1');
  if (parsed.trashed) params.set('trashed', '1');
  if (parsed.pinned) params.set('pinned', '1');
  params.set('limit', String(limit));
  return params.toString();
}
