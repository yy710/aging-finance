const crypto = require('node:crypto');
const express = require('express');

const { cookiePathForBase } = require('./public-url');

const COOKIE_NAME = 'af_admin_session';

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function constantTimeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function createToken(secret, ttlMs, now = Date.now()) {
  const payload = encode(JSON.stringify({
    version: 1,
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString('hex'),
  }));
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = sign(payload, secret);
  if (!constantTimeEqual(signature, expected)) return false;
  try {
    const parsed = JSON.parse(decode(payload));
    return parsed.version === 1
      && Number.isFinite(parsed.expiresAt)
      && parsed.expiresAt > now
      && parsed.issuedAt <= now + 60_000;
  } catch {
    return false;
  }
}

function createRateLimiter({ maxAttempts = 6, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  return {
    check(key, now = Date.now()) {
      const current = attempts.get(key);
      if (!current || current.resetAt <= now) {
        attempts.set(key, { count: 0, resetAt: now + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count >= maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    failure(key, now = Date.now()) {
      const current = attempts.get(key);
      if (!current || current.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        current.count += 1;
      }
    },
    success(key) {
      attempts.delete(key);
    },
    clear() {
      attempts.clear();
    },
  };
}

function createAuth(config, options = {}) {
  const limiter = options.rateLimiter || createRateLimiter(options.rateLimit);

  function isAuthenticated(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return verifyToken(token, config.cookieSecret);
  }

  function requireAdmin(req, res, next) {
    if (isAuthenticated(req)) return next();
    return res.status(401).json({ error: '请先登录管理后台。' });
  }

  function cookieOptions(req) {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies || req.secure,
      path: cookiePathForBase(config.publicBasePath),
      maxAge: config.sessionTtlMs,
    };
  }

  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
  });

  router.post('/login', express.json({ limit: '8kb' }), (req, res) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const rate = limiter.check(key);
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试。' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!constantTimeEqual(password, config.adminPassword)) {
      limiter.failure(key);
      return res.status(401).json({ error: '管理密码不正确。' });
    }
    limiter.success(key);
    res.cookie(COOKIE_NAME, createToken(config.cookieSecret, config.sessionTtlMs), cookieOptions(req));
    return res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const optionsForClear = cookieOptions(req);
    delete optionsForClear.maxAge;
    res.clearCookie(COOKIE_NAME, optionsForClear);
    res.json({ ok: true });
  });

  return { router, requireAdmin, isAuthenticated, limiter };
}

module.exports = {
  COOKIE_NAME,
  constantTimeEqual,
  createAuth,
  createRateLimiter,
  createToken,
  parseCookies,
  verifyToken,
};
