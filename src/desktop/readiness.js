export const READY_PREFIX = 'HDB_READY ';

export function formatReady({ url, port, pid }) {
  return `${READY_PREFIX}${JSON.stringify({ url, port, pid })}`;
}

export function parseReady(line) {
  if (!String(line).startsWith(READY_PREFIX)) return null;
  try {
    const ready = JSON.parse(String(line).slice(READY_PREFIX.length));
    if (!Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65_535) return null;
    if (!Number.isInteger(ready.pid) || ready.pid < 1) return null;
    if (ready.url !== `http://127.0.0.1:${ready.port}`) return null;
    return ready;
  } catch {
    return null;
  }
}
