'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

const { createApp } = require('../server/app');
const { ContentService } = require('../server/content-service');
const { openDatabase } = require('../server/database');
const {
  REPOSITORY_ROOT,
  TEST_COOKIE_SECRET,
  TEST_PASSWORD,
} = require('./helpers/runtime');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function assertSavedPublicationFailure(response, entityKey) {
  assert.equal(response.status, 500, response.text);
  assert.equal(response.body.code, 'PUBLICATION_FAILED');
  assert.equal(response.body.saved, true);
  assert.deepEqual(response.body.publication, {
    ok: false,
    status: 'failed',
    causeCode: 'SYNTHETIC_GENERATION_FAILURE',
  });
  assert.ok(response.body[entityKey], `response must retain ${entityKey}`);
  assert.match(response.body.error, /保存.*生成失败/u);
}

test('create failures return the saved page, Card, and media instead of inviting blind retries', async (t) => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'aging-finance-publication-failure-'),
  );
  const dataDir = path.join(rootDir, 'data');
  const uploadsDir = path.join(rootDir, 'uploads');
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(uploadsDir, { recursive: true }),
  ]);
  const db = openDatabase(path.join(dataDir, 'site.db'));
  t.after(async () => {
    if (db.open) db.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const service = new ContentService(db);
  const home = service.createPage({
    parent_id: null,
    title: '首页',
    slug: '',
    template_type: 'home',
    decorative_character: '',
    title_image: '/assets/images/home/main-title.png',
    background_image: 'home',
    content: '',
    status: 'published',
  });
  let generationAttempts = 0;
  const generate = async () => {
    generationAttempts += 1;
    const error = new Error('synthetic generator outage');
    error.code = 'SYNTHETIC_GENERATION_FAILURE';
    throw error;
  };
  const config = {
    rootDir,
    host: '127.0.0.1',
    port: 0,
    nodeEnv: 'test',
    dbPath: path.join(dataDir, 'site.db'),
    generatedDir: path.join(rootDir, 'public-generated'),
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
  const { app } = createApp({ config, service, generate });
  const agent = request.agent(app);
  assert.equal(
    (await agent.post('/api/auth/login').send({ password: TEST_PASSWORD })).status,
    200,
  );

  const pageResponse = await agent.post('/api/pages').send({
    parent_id: home.id,
    title: '已保存但未发布的页面',
    slug: 'saved-page',
    template_type: 'card-list',
    decorative_character: '惠',
    title_image: '/assets/images/titles/hui-consulting.png',
    background_image: 'hui',
    content: '',
    status: 'published',
  });
  assertSavedPublicationFailure(pageResponse, 'page');
  assert.equal(pageResponse.body.page.url, '/saved-page/');
  assert.equal(
    service.getPage(pageResponse.body.page.id).title,
    '已保存但未发布的页面',
  );

  const cardResponse = await agent.post('/api/cards').send({
    page_id: pageResponse.body.page.id,
    item_type: 'text_link',
    title: '已保存但未发布的 Card',
    description: '',
    image_path: '',
    image_alt: '',
    target_page_id: null,
    external_url: 'https://example.com/saved-card',
    status: 'published',
  });
  assertSavedPublicationFailure(cardResponse, 'card');
  assert.equal(
    service.getCard(cardResponse.body.card.id).title,
    '已保存但未发布的 Card',
  );

  const mediaResponse = await agent
    .post('/api/media')
    .attach('image', PNG, {
      filename: 'saved-image.png',
      contentType: 'image/png',
    });
  assertSavedPublicationFailure(mediaResponse, 'media');
  const media = service.getMedia(mediaResponse.body.media.id);
  assert.equal(media.relative_path, mediaResponse.body.media.relative_path);
  assert.equal(
    Buffer.isBuffer(await fs.readFile(path.join(uploadsDir, media.stored_name))),
    true,
  );

  assert.equal(generationAttempts, 3);
  assert.equal(service.countPages(), 2);
  assert.equal(service.countCards(), 1);
  assert.equal(service.listMedia().length, 1);
});
