const pad = (n) => String(n).padStart(2, '0');

export const padId = (id) => `#${String(id).padStart(4, '0')}`;

export function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${text.replace('.', ',')} ${units[unit]}`;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Kalimat untuk pane detail: "2 jam lalu", "kemarin".
export function relativeTime(iso, now = new Date()) {
  const seconds = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'baru saja';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'kemarin';
  if (days < 7) return `${days} hari lalu`;
  return formatDate(iso);
}

// Versi ringkas untuk kolom meta di daftar: "2J", "KEMARIN", "3 HARI", "12/09".
export function shortAge(iso, now = new Date()) {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'BARU';
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}J`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'KEMARIN';
  if (days < 7) return `${days} HARI`;
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function daysLeft(deletedAt, trashDays = 30, now = new Date()) {
  const ms = new Date(deletedAt).getTime() + trashDays * 86400000 - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}
