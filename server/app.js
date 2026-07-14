const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const express = require('express');

const { createApiRouter, apiErrorHandler } = require('./api');
const { createAuth } = require('./auth');
const { createPublicUrl } = require('./public-url');

const VERSION_PATTERN = /^[a-f0-9]{8,12}$/i;

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function publicCacheHeaders(req, res, next) {
  if (VERSION_PATTERN.test(String(req.query.v || ''))) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.set('Cache-Control', 'no-cache');
  }
  next();
}

function noCache(_req, res, next) {
  res.set('Cache-Control', 'no-cache');
  next();
}

function allowSameOriginPreview(_req, res, next) {
  const policy = String(res.get('Content-Security-Policy') || '');
  res.set('Content-Security-Policy', policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
}

function rejectUnsafeGeneratedAssetPath(req, res, next) {
  const rawPath = String(req.originalUrl || req.url || '').split('?', 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath).replace(/\\/gu, '/');
  } catch {
    res.set('Cache-Control', 'no-cache');
    return res.status(400).send('资源路径无效。');
  }
  const segments = decodedPath.split('/');
  if (segments.includes('..') || segments.includes('.')) {
    res.set('Cache-Control', 'no-cache');
    return res.status(404).send('资源不存在。');
  }
  return next();
}

function createGeneratedDirectoryRedirect(config, publicUrl) {
  const generatedRoot = `${path.resolve(config.generatedDir)}${path.sep}`;

  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.path.endsWith('/')) {
      return next();
    }

    const requestPath = String(req.path || '');
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestPath).replace(/\\/gu, '/');
    } catch {
      return next();
    }

    const segments = decodedPath.split('/');
    if (segments.includes('..') || segments.includes('.')) {
      return next();
    }

    const relativePath = decodedPath.replace(/^\/+|\/+$/gu, '');
    if (!relativePath) {
      return next();
    }

    const indexPath = path.resolve(config.generatedDir, relativePath, 'index.html');
    if (!indexPath.startsWith(generatedRoot) || !fs.existsSync(indexPath)) {
      return next();
    }

    const queryIndex = String(req.originalUrl || '').indexOf('?');
    const query = queryIndex >= 0 ? String(req.originalUrl).slice(queryIndex) : '';
    res.set('Cache-Control', 'no-cache');
    return res.redirect(301, `${publicUrl(`${requestPath}/`)}${query}`);
  };
}

function securityHeaders(config) {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: https:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
      ].join('; '),
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.nodeEnv === 'production' && req.secure) {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

function createApp({ config, service, generate, authOptions } = {}) {
  if (!config || !service || typeof generate !== 'function') {
    throw new TypeError('createApp requires config, content service, and generator');
  }

  const app = express();
  const publicUrl = createPublicUrl(config.publicBasePath);
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders(config));

  app.get('/health', (_req, res) => {
    let database = 'ok';
    try {
      service.countPages();
    } catch {
      database = 'error';
    }
    const status = database === 'ok' ? 200 : 503;
    res.status(status).json({
      status: status === 200 ? 'ok' : 'unhealthy',
      database,
      generatedSite: fs.existsSync(config.generatedDir),
      timestamp: new Date().toISOString(),
    });
  });

  const auth = createAuth(config, authOptions);
  app.use('/api/auth', noStore, auth.router);
  app.use('/api', noStore, auth.requireAdmin, createApiRouter({ config, service, generate }));
  app.use('/api', noStore, (_req, res) => res.status(404).json({ error: '管理 API 不存在。' }));
  app.use('/api', apiErrorHandler);

  app.get(/^\/admin$/, noStore, (_req, res) => res.redirect(301, publicUrl('/admin/')));
  app.get('/admin/', noStore, async (req, res, next) => {
    try {
      const html = await ejs.renderFile(path.join(config.adminDir, 'index.ejs'), {
        publicBasePath: config.publicBasePath || '',
        publicUrl,
      });
      res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  });
  for (const filename of ['app.js', 'styles.css']) {
    app.get(`/admin/${filename}`, noStore, (_req, res) => {
      res.sendFile(path.join(config.adminDir, filename), { dotfiles: 'deny' });
    });
  }
  app.use('/admin', noStore, (_req, res) => res.status(404).send('管理页面不存在。'));

  const generatedStaticOptions = {
    dotfiles: 'deny',
    etag: true,
    fallthrough: true,
    index: false,
    lastModified: true,
    redirect: false,
  };
  for (const directory of ['assets', 'uploads', '_assets']) {
    const mountPath = `/${directory}`;
    app.use(
      mountPath,
      rejectUnsafeGeneratedAssetPath,
      publicCacheHeaders,
      express.static(path.join(config.generatedDir, directory), generatedStaticOptions),
    );
    app.use(mountPath, noCache, (_req, res) => res.status(404).send('资源不存在。'));
  }

  app.use(createGeneratedDirectoryRedirect(config, publicUrl));
  app.use(noCache);
  app.use(allowSameOriginPreview);
  app.use(express.static(config.generatedDir, {
    dotfiles: 'deny',
    etag: true,
    fallthrough: true,
    index: 'index.html',
    lastModified: true,
    redirect: false,
  }));

  app.use((req, res) => {
    res.status(404).type('html').send(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>页面不存在</title><body><main><h1>页面不存在</h1><p><a href="${publicUrl('/')}">返回首页</a></p></main></body></html>`,
    );
  });

  app.use(apiErrorHandler);
  return { app, auth };
}

module.exports = {
  VERSION_PATTERN,
  allowSameOriginPreview,
  createApp,
  createGeneratedDirectoryRedirect,
  noCache,
  noStore,
  publicCacheHeaders,
  rejectUnsafeGeneratedAssetPath,
  securityHeaders,
};
