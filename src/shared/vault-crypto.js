// Dipakai di browser (UI) dan Node (test). Hanya WebCrypto, tanpa dependency dan tanpa API Node.
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HKDF_SALT = new Uint8Array(32);

export const KDF_ITERATIONS = 600_000;

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

export function newSalt() {
  return toBase64Url(randomBytes(16));
}

export async function deriveKeys(password, salt, iterations = KDF_ITERATIONS) {
  const material = await subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations }, material, 256);
  const master = await subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const authBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode('hesewake-auth') },
    master,
    256,
  );
  const wrapKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode('hesewake-wrap') },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { authKey: toBase64Url(new Uint8Array(authBits)), wrapKey };
}

async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return `v1.${toBase64Url(iv)}.${toBase64Url(data)}`;
}

async function decryptBytes(key, payload) {
  const [version, iv, data] = String(payload).split('.');
  if (version !== 'v1' || !iv || !data) throw new Error('Format ciphertext tidak dikenal');
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(data)));
}

const importVaultKey = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

async function openWrapped(wrapKey, wrappedVaultKey) {
  try {
    return await decryptBytes(wrapKey, wrappedVaultKey);
  } catch {
    throw new Error('Master password salah');
  }
}

export async function createVaultKey(wrapKey) {
  const raw = randomBytes(32);
  const wrappedVaultKey = await encryptBytes(wrapKey, raw);
  const vaultKey = await importVaultKey(raw);
  raw.fill(0);
  return { vaultKey, wrappedVaultKey };
}

export async function unwrapVaultKey(wrapKey, wrappedVaultKey) {
  const raw = await openWrapped(wrapKey, wrappedVaultKey);
  const vaultKey = await importVaultKey(raw);
  raw.fill(0);
  return vaultKey;
}

export async function rewrapVaultKey(oldWrapKey, wrappedVaultKey, newWrapKey) {
  const raw = await openWrapped(oldWrapKey, wrappedVaultKey);
  const rewrapped = await encryptBytes(newWrapKey, raw);
  raw.fill(0);
  return rewrapped;
}

export const encryptText = (vaultKey, text) => encryptBytes(vaultKey, encoder.encode(text));
export const decryptText = async (vaultKey, payload) => decoder.decode(await decryptBytes(vaultKey, payload));
