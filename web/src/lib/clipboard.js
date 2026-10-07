export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback untuk konteks yang menolak Clipboard API.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  }
}

// Kosongkan clipboard hanya kalau isinya masih secret tadi. Browser sering menolak membaca clipboard
// (izin, tab tidak aktif, HP); dalam kasus itu jangan menimpa isi lain milik pengguna.
export async function clearClipboardIfUnchanged(secret) {
  if (!document.hasFocus()) return false;
  try {
    const current = await navigator.clipboard.readText();
    if (current !== secret) return true;
    await navigator.clipboard.writeText('');
    return true;
  } catch {
    return false;
  }
}

export function buildCurl(metadata) {
  const lines = [`curl -X ${metadata.method} '${metadata.url}'`];
  for (const header of (metadata.headers ?? '').split('\n').map((h) => h.trim()).filter(Boolean)) lines.push(`  -H '${header.replace(/'/g, "'\\''")}'`);
  if (metadata.body) lines.push(`  -d '${metadata.body.replace(/'/g, "'\\''")}'`);
  return lines.join(' \\\n');
}
