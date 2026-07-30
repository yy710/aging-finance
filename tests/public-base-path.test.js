'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

const { COOKIE_NAME } = require('../server/auth');
const { loadConfig } = require('../server/config');
const {
  cookiePathForBase,
  createPageUrl,
  createPublicUrl,
  normalizePublicBasePath,
  stripPublicBasePath,
} = require('../server/public-url');
const { parseArguments } = require('../scripts/generate');
const { TEST_PASSWORD, createTestRuntime, readManifest } = require('./helpers/runtime');

test('production generation defaults are pinned to the /af deployment path', async () => {
  const args = parseArguments(['--public-base-path', '/af']);
  assert.equal(args.publicBasePath, '/af');

  const packageJson = JSON.parse(
    await fs.readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.scripts.generate, 'node scripts/generate.js --public-base-path /af');
  assert.equal(packageJson.scripts['generate:root'], 'node scripts/generate.js');

  const privateConfig = {
    adminPassword: TEST_PASSWORD,
    cookieSecret: 'test-cookie-secret-0123456789-abcdef',
  };
  assert.equal(loadConfig({ nodeEnv: 'production', privateConfig }).publicBasePath, '/af');
  assert.equal(
    loadConfig({ nodeEnv: 'production', publicBasePath: '', privateConfig }).publicBasePath,
    '',
    'an explicit root deployment must remain available',
  );
});

test('public URL helpers normalize and prefix local references exactly once', () => {
  assert.equal(normalizePublicBasePath(''), '');
  assert.equal(normalizePublicBasePath('/'), '');
  assert.equal(normalizePublicBasePath(' /af/ '), '/af');
  assert.equal(normalizePublicBasePath('/af//finance/'), '/af/finance');
  assert.throws(() => normalizePublicBasePath('af'), /start with/);
  assert.throws(() => normalizePublicBasePath('/af/../admin'), /cannot contain/);

  const publicUrl = createPublicUrl('/af');
  assert.equal(publicUrl('/assets/css/style.css'), '/af/assets/css/style.css');
  assert.equal(publicUrl('/uploads/bg.png?v=8f31c9a2'), '/af/uploads/bg.png?v=8f31c9a2');
  assert.equal(publicUrl('/api/pages'), '/af/api/pages');
  assert.equal(publicUrl('/admin/'), '/af/admin/');
  assert.equal(publicUrl('/af/admin/'), '/af/admin/');
  assert.equal(publicUrl('https://example.com/image.png'), 'https://example.com/image.png');
  assert.equal(publicUrl('#content'), '#content');
  assert.equal(stripPublicBasePath('/af/uploads/bg.png?v=1', '/af'), '/uploads/bg.png?v=1');
  assert.equal(cookiePathForBase('/af/'), '/af');
  assert.equal(cookiePathForBase(''), '/');

  const pageUrl = createPageUrl('/af', (id) => ({ id, url: '/hui/' }));
  assert.equal(pageUrl(2), '/af/hui/');
  assert.equal(pageUrl({ url: '/yi/' }), '/af/yi/');
});

test('generated site, admin, API, redirects, and cookie honor PUBLIC_BASE_PATH', async (t) => {
  const runtime = await createTestRuntime(t, {
    initialGenerate: false,
    publicBasePath: '/af',
    realGenerator: true,
  });
  runtime.service.createPage({
    parent_id: runtime.rootPage.id,
    title: '惠民服务',
    slug: 'hui',
    template_type: 'card-list',
    decorative_character: '惠',
    title_image: '/assets/images/titles/hui-consulting.png',
    background_image: 'hui',
    content: '',
    status: 'published',
  });
  const publication = await runtime.generate();
  assert.deepEqual(publication.urls, ['/af/', '/af/hui/']);

  const manifest = await readManifest(runtime);
  const homeHtml = await fs.readFile(path.join(runtime.generatedDir, 'index.html'), 'utf8');
  const css = await fs.readFile(
    path.join(runtime.generatedDir, 'assets', 'css', 'site.css'),
    'utf8',
  );
  assert.match(homeHtml, /href="\/af\/assets\/css\/site\.css\?v=[a-f0-9]{10}"/u);
  assert.match(homeHtml, /src="\/af\/assets\/js\/site\.js\?v=[a-f0-9]{10}"/u);
  assert.match(homeHtml, /href="\/af\/hui\/"/u);
  assert.doesNotMatch(homeHtml, /\b(?:href|src)="\/(?!af(?:\/|"))/u);
  assert.match(css, /url\("\/af\/assets\/images\/.+\?v=[a-f0-9]{10}"\)/u);
  assert.doesNotMatch(css, /url\(["']?\/(?!af\/)/u);

  const adminRedirect = await request(runtime.app).get('/admin');
  assert.equal(adminRedirect.status, 301);
  assert.equal(adminRedirect.headers.location, '/af/admin/');

  const pageRedirect = await request(runtime.app).get('/hui?preview=1');
  assert.equal(pageRedirect.status, 301);
  assert.equal(pageRedirect.headers.location, '/af/hui/?preview=1');

  const admin = await request(runtime.app).get('/admin/');
  assert.equal(admin.status, 200);
  assert.match(admin.text, /name="public-base-path" content="\/af"/u);
  assert.match(admin.text, /href="\/af\/admin\/styles\.css"/u);
  assert.match(admin.text, /src="\/af\/admin\/app\.js"/u);
  assert.match(admin.text, /href="\/af\/"/u);

  const login = await request(runtime.app)
    .post('/api/auth/login')
    .send({ password: TEST_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].find((value) => value.startsWith(`${COOKIE_NAME}=`));
  assert.ok(cookie);
  assert.equal(COOKIE_NAME, 'af_admin_session');
  assert.match(cookie, /; Path=\/af(?:;|$)/iu);
  const cookieHeader = cookie.split(';', 1)[0];

  const pages = await request(runtime.app)
    .get('/api/pages')
    .set('Cookie', cookieHeader);
  assert.equal(pages.status, 200);
  assert.deepEqual(pages.body.pages.map((page) => page.url), ['/af/', '/af/hui/']);
  assert.ok(pages.body.pages.every((page) => /^\/af\/assets\/.+\?v=[a-f0-9]{10}$/u.test(page.title_image_url)));

  const republish = await request(runtime.app)
    .post('/api/generate')
    .set('Cookie', cookieHeader)
    .send({});
  assert.equal(republish.status, 200);
  assert.equal(republish.body.publicBasePath, '/af');
  assert.equal(republish.body.pageCount, 2);

  const media = await request(runtime.app)
    .get('/api/media')
    .set('Cookie', cookieHeader);
  assert.equal(media.status, 200);
  assert.ok(media.body.images.length > 0);
  assert.ok(media.body.images.every((image) => /^\/af\/(?:assets|uploads)\/.+\?v=[a-f0-9]{10}$/u.test(image.public_url)));
  assert.ok(media.body.images.every((image) => !image.relative_path.startsWith('/af/')));

  const cssResponse = await request(runtime.app).get(
    `/assets/css/site.css?v=${manifest['/assets/css/site.css']}`,
  );
  assert.equal(cssResponse.status, 200);
  assert.equal(cssResponse.headers['cache-control'], 'public, max-age=31536000, immutable');

  const directPrefixedRequest = await request(runtime.app).get('/af/admin/');
  assert.equal(directPrefixedRequest.status, 404, 'Nginx, not Express, removes the external prefix');

  const missing = await request(runtime.app).get('/missing-page');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /href="\/af\/"/u);
});
