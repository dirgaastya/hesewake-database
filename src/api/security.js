import { secureHeaders } from 'hono/secure-headers';
import { ForbiddenError, TooManyRequestsError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const toSet = (hosts) => new Set(hosts.map((host) => host.toLowerCase()));

// Header Host selalu ada di request HTTP sungguhan; Request buatan (test, fetch internal) hanya membawa URL.
export function requestHost(c) {
  return (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
}

// Menangkal DNS rebinding: situs jahat yang mengarahkan domainnya ke 127.0.0.1 tetap mengirim Host miliknya.
export function hostGuard(allowedHosts) {
  const allowed = toSet(allowedHosts);
  return async (c, next) => {
    const host = requestHost(c);
    if (!allowed.has(host)) throw new ForbiddenError(`Host tidak diizinkan: ${host || '(kosong)'}`);
    await next();
  };
}

// Menangkal CSRF: request yang mengubah data harus datang dari UI sendiri.
export function originGuard(allowedHosts) {
  const allowed = toSet(allowedHosts);
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      const fetchSite = c.req.header('sec-fetch-site');
      if (origin !== undefined) {
        let host = '';
        try {
          host = new URL(origin).host.toLowerCase();
        } catch {
          host = '';
        }
        if (!allowed.has(host)) throw new ForbiddenError('Origin tidak diizinkan');
      } else if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        throw new ForbiddenError('Request lintas situs ditolak');
      }
    }
    await next();
  };
}

export function securityHeaders() {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
  });
}

export function clientKey(c) {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : 'local';
}

export function createRateLimiter({ limit = 5, windowMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map();

  function entry(key) {
    const current = hits.get(key);
    if (current && current.resetAt > now()) return current;
    const fresh = { count: 0, resetAt: now() + windowMs };
    hits.set(key, fresh);
    return fresh;
  }

  return {
    check(key) {
      if (entry(key).count >= limit) throw new TooManyRequestsError();
    },
    fail(key) {
      entry(key).count++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
