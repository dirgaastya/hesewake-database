import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { CIPHERTEXT_PATTERN } from '../items/types.js';
import { AuthError, ForbiddenError, ValidationError } from '../errors.js';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DAY_MS = 24 * 60 * 60 * 1000;
const B64URL = /^[A-Za-z0-9_-]+$/;

function hashAuthKey(authKey) {
  const salt = randomBytes(16);
  return `scrypt.${salt.toString('base64url')}.${scryptSync(authKey, salt, 32, SCRYPT).toString('base64url')}`;
}

function verifyAuthKey(authKey, stored) {
  if (typeof authKey !== 'string') return false;
  const [, salt, hash] = stored.split('.');
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(authKey, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const tokenId = (token) => createHash('sha256').update(String(token)).digest('hex');

function validateCredentials({ salt, iterations, authKey, wrappedVaultKey }, minIterations) {
  if (typeof salt !== 'string' || salt.length < 16 || !B64URL.test(salt)) throw new ValidationError('salt tidak valid');
  if (!Number.isInteger(iterations) || iterations < minIterations) throw new ValidationError(`iterations minimal ${minIterations}`);
  if (typeof authKey !== 'string' || authKey.length < 40 || !B64URL.test(authKey)) throw new ValidationError('authKey tidak valid');
  if (typeof wrappedVaultKey !== 'string' || !CIPHERTEXT_PATTERN.test(wrappedVaultKey)) throw new ValidationError('wrappedVaultKey tidak valid');
}

export function createAccountService(db, { sessionDays = 30, minIterations = 100_000, now = () => new Date() } = {}) {
  const stmts = {
    account: db.prepare('SELECT * FROM account WHERE id = 1'),
    insertAccount: db.prepare(`
      INSERT INTO account (id, kdf_salt, kdf_iterations, auth_hash, wrapped_vault_key)
      VALUES (1, @salt, @iterations, @authHash, @wrappedVaultKey)
    `),
    updateAccount: db.prepare(`
      UPDATE account
      SET kdf_salt = @salt, kdf_iterations = @iterations, auth_hash = @authHash, wrapped_vault_key = @wrappedVaultKey,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = 1
    `),
    insertSession: db.prepare('INSERT INTO sessions (id, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    deleteOthers: db.prepare('DELETE FROM sessions WHERE id != ?'),
    sessions: db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC'),
  };

  function requireAccount() {
    const account = stmts.account.get();
    if (!account) throw new AuthError('Akun belum dibuat');
    return account;
  }

  function createSession(device) {
    const token = randomBytes(32).toString('base64url');
    const created = now();
    const expiresAt = new Date(created.getTime() + sessionDays * DAY_MS).toISOString();
    const name = String(device || 'Perangkat tanpa nama').slice(0, 80);
    stmts.insertSession.run(tokenId(token), name, created.toISOString(), created.toISOString(), expiresAt);
    return { token, expiresAt };
  }

  return {
    hasAccount: () => Boolean(stmts.account.get()),

    params() {
      const account = stmts.account.get();
      return account ? { salt: account.kdf_salt, iterations: account.kdf_iterations } : null;
    },

    setup(input) {
      if (stmts.account.get()) throw new ForbiddenError('Akun sudah dibuat');
      validateCredentials(input, minIterations);
      stmts.insertAccount.run({
        salt: input.salt,
        iterations: input.iterations,
        authHash: hashAuthKey(input.authKey),
        wrappedVaultKey: input.wrappedVaultKey,
      });
      return createSession(input.device);
    },

    login({ authKey, device } = {}) {
      const account = stmts.account.get();
      if (!account || !verifyAuthKey(authKey, account.auth_hash)) throw new AuthError('Master password salah');
      return createSession(device);
    },

    verifySession(token) {
      if (!token) return null;
      stmts.deleteExpired.run(now().toISOString());
      const session = stmts.session.get(tokenId(token));
      if (!session) return null;
      stmts.touchSession.run(now().toISOString(), session.id);
      return { id: session.id, device: session.device };
    },

    logout(token) {
      if (token) stmts.deleteSession.run(tokenId(token));
    },

    sessions(currentId) {
      stmts.deleteExpired.run(now().toISOString());
      return stmts.sessions.all().map((s) => ({
        id: s.id,
        device: s.device,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        current: s.id === currentId,
      }));
    },

    revokeSession(id) {
      stmts.deleteSession.run(id);
    },

    wrappedVaultKey: () => requireAccount().wrapped_vault_key,

    changePassword({ currentAuthKey, ...next }, { keepSessionId }) {
      const account = requireAccount();
      if (!verifyAuthKey(currentAuthKey, account.auth_hash)) throw new AuthError('Master password lama salah');
      validateCredentials(next, minIterations);
      db.transaction(() => {
        stmts.updateAccount.run({
          salt: next.salt,
          iterations: next.iterations,
          authHash: hashAuthKey(next.authKey),
          wrappedVaultKey: next.wrappedVaultKey,
        });
        stmts.deleteOthers.run(keepSessionId);
      })();
    },
  };
}
