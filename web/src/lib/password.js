const SETS = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%^&*-_=+?',
];

const defaultRandom = (n) => globalThis.crypto.getRandomValues(new Uint32Array(n));

// Generator password tanpa karakter yang mirip (l/1, O/0). Tiap jenis karakter muncul minimal sekali.
export function generatePassword(length = 20, random = defaultRandom) {
  const all = SETS.join('');
  const values = random(length * 2);
  const chars = SETS.map((set, i) => set[values[i] % set.length]);
  for (let i = chars.length; i < length; i++) chars.push(all[values[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = values[length + i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
