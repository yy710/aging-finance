'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../../server/app');
const { ContentService } = require('../../server/content-service');
const { openDatabase } = require('../../server/database');
const { createGenerator } = require('../../server/generator');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const TEST_PASSWORD = 'test-admin-password';
const TEST_COOKIE_SECRET = 'test-cookie-secret-0123456789-abcdef';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function createTestRuntime(testContext, options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aging-finance-test-'));
  const dataDir = path.join(rootDir, 'data');
  const generatedDir = path.join(rootDir, 'public-generated');
  const uploadsDir = path.join(rootDir, 'uploads');
  const configDir = path.join(rootDir, 'config');
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(uploadsDir, { recursive: true }),
    fs.mkdir(configDir, { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(configDir, 'private.json'),
    JSON.stringify({ secretMarker: 'must-never-be-public' }),
    'utf8',
  );

  const dbPath = path.join(dataDir, 'site.db');
  const db = openDatabase(dbPath);
  const service = new ContentService(db);
  const rootPage = options.seedHome === false
    ? null
    : service.createPage({
        parent_id: null,
        title: '测试首页',
        slug: '',
        template_type: 'home',
        decorative_character: '',
        title_image: '/assets/images/home/main-title.png',
        background_image: 'home',
        content: '',
        status: 'published',
      });

  const config = {
    rootDir,
    host: '127.0.0.1',
    port: 0,
    nodeEnv: 'test',
    dbPath,
    generatedDir,
    assetsDir: path.join(REPOSITORY_ROOT, 'public-assets'),
    uploadsDir,
    viewsDir: path.join(REPOSITORY_ROOT, 'views'),
    adminDir: path.join(REPOSITORY_ROOT, 'admin'),
    adminPassword: TEST_PASSWORD,
    cookieSecret: TEST_COOKIE_SECRET,
    secureCookies: false,
    sessionTtlMs: 60 * 60 * 1000,
    uploadMaxBytes: 1024 * 1024,
  };

  let generationCount = 0;
  const realGenerate = createGenerator({
    projectRoot: rootDir,
    viewsDir: config.viewsDir,
    outputDir: generatedDir,
    assetsDir: config.assetsDir,
    uploadsDir,
    database: db,
  });
  const generate = options.realGenerator
    ? async () => {
        generationCount += 1;
        return realGenerate();
      }
    : async () => {
        generationCount += 1;
        return {
          pageCount: service.countPages(),
          cardCount: service.countCards(),
          assetCount: 0,
          urls: service.listPages({ status: 'published' }).map((page) => page.url),
          cleanupWarning: null,
        };
      };

  if (options.realGenerator && options.initialGenerate !== false) {
    await generate();
  }

  const { app, auth } = createApp({ config, service, generate });
  const runtime = {
    app,
    auth,
    config,
    db,
    dbPath,
    generate,
    generatedDir,
    get generationCount() {
      return generationCount;
    },
    rootDir,
    rootPage,
    service,
    uploadsDir,
  };

  testContext.after(async () => {
    if (db.open) db.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  return runtime;
}

async function login(agent, password = TEST_PASSWORD) {
  return agent.post('/api/auth/login').send({ password });
}

async function readManifest(runtime) {
  const source = await fs.readFile(
    path.join(runtime.generatedDir, 'asset-manifest.json'),
    'utf8',
  );
  return JSON.parse(source);
}

module.exports = {
  REPOSITORY_ROOT,
  TEST_COOKIE_SECRET,
  TEST_PASSWORD,
  createTestRuntime,
  exists,
  login,
  readManifest,
};
