const fs = require('node:fs');
const path = require('node:path');

const { normalizePublicBasePath } = require('./public-url');

const ROOT_DIR = path.resolve(__dirname, '..');

function readPrivateConfig(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Private configuration is missing at ${filePath}. Copy config/private.example.json to config/private.json first.`,
      );
    }
    throw new Error(`Unable to read private configuration: ${error.message}`);
  }
}

function loadConfig(overrides = {}) {
  const privateConfigPath = overrides.privateConfigPath
    || process.env.PRIVATE_CONFIG_PATH
    || path.join(ROOT_DIR, 'config', 'private.json');
  const privateConfig = overrides.privateConfig || readPrivateConfig(privateConfigPath);

  const adminPassword = process.env.ADMIN_PASSWORD || privateConfig.adminPassword;
  const cookieSecret = process.env.COOKIE_SECRET || privateConfig.cookieSecret;
  if (typeof adminPassword !== 'string' || adminPassword.length < 8) {
    throw new Error('The admin password must contain at least 8 characters.');
  }
  if (typeof cookieSecret !== 'string' || cookieSecret.length < 32) {
    throw new Error('The cookie secret must contain at least 32 characters.');
  }

  return {
    rootDir: ROOT_DIR,
    host: overrides.host || process.env.HOST || '127.0.0.1',
    port: Number(overrides.port || process.env.PORT || 3100),
    nodeEnv: overrides.nodeEnv || process.env.NODE_ENV || 'development',
    publicBasePath: normalizePublicBasePath(
      overrides.publicBasePath ?? process.env.PUBLIC_BASE_PATH ?? '',
    ),
    dbPath: overrides.dbPath || process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'site.db'),
    generatedDir: overrides.generatedDir || path.join(ROOT_DIR, 'public-generated'),
    assetsDir: overrides.assetsDir || path.join(ROOT_DIR, 'public-assets'),
    uploadsDir: overrides.uploadsDir || path.join(ROOT_DIR, 'uploads'),
    viewsDir: overrides.viewsDir || path.join(ROOT_DIR, 'views'),
    adminDir: overrides.adminDir || path.join(ROOT_DIR, 'admin'),
    adminPassword,
    cookieSecret,
    secureCookies: overrides.secureCookies
      ?? (process.env.COOKIE_SECURE === 'true' || privateConfig.secureCookies === true),
    sessionTtlMs: Number(overrides.sessionTtlMs || process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000),
    uploadMaxBytes: Number(overrides.uploadMaxBytes || process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024),
  };
}

module.exports = { ROOT_DIR, loadConfig };
