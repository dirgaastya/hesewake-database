const PATTERN = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function findPlaceholders(text) {
  return [...new Set([...String(text ?? '').matchAll(PATTERN)].map((match) => match[1]))];
}

// Placeholder yang belum diisi dibiarkan apa adanya supaya kelihatan saat ditempel.
export function fillPlaceholders(text, values) {
  return String(text ?? '').replace(PATTERN, (whole, name) => {
    const value = values[name];
    return value === undefined || value === '' ? whole : value;
  });
}
