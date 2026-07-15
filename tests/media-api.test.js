'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');
const sharp = require('sharp');

const { createTestRuntime, login, readManifest } = require('./helpers/runtime');

const PNG_ONE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const PNG_TWO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8WQAAAAASUVORK5CYII=',
  'base64',
);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('PNG upload and replacement keep one public path while publishing a new hash', async (t) => {
  const runtime = await createTestRuntime(t, { realGenerator: true });
  const agent = request.agent(runtime.app);
  assert.equal((await login(agent)).status, 200);
  const baselineManifest = await readManifest(runtime);

  const upload = await agent
    .post('/api/media')
    .attach('image', PNG_ONE, {
      filename: 'first.png',
      contentType: 'image/png',
    });
  assert.equal(upload.status, 201, upload.text);
  const firstRecord = upload.body.media;
  assert.match(firstRecord.stored_name, /^[a-f0-9-]+\.png$/i);
  assert.equal(firstRecord.relative_path, `/uploads/${firstRecord.stored_name}`);
  assert.equal(firstRecord.mime_type, 'image/png');
  assert.equal(firstRecord.file_size, PNG_ONE.length);
  assert.equal(firstRecord.content_hash, sha256(PNG_ONE));

  const sourcePath = path.join(runtime.uploadsDir, firstRecord.stored_name);
  assert.deepEqual(await fs.readFile(sourcePath), PNG_ONE);
  const firstManifest = await readManifest(runtime);
  const firstVersion = firstManifest[firstRecord.relative_path];
  assert.equal(firstVersion, sha256(PNG_ONE).slice(0, 10));
  assert.equal(
    firstManifest['/assets/js/site.js'],
    baselineManifest['/assets/js/site.js'],
  );
  assert.deepEqual(
    await fs.readFile(
      path.join(runtime.generatedDir, 'uploads', firstRecord.stored_name),
    ),
    PNG_ONE,
  );

  const firstPublicResponse = await request(runtime.app).get(
    `${firstRecord.relative_path}?v=${firstVersion}`,
  );
  assert.equal(firstPublicResponse.status, 200);
  assert.equal(
    firstPublicResponse.headers['cache-control'],
    'public, max-age=31536000, immutable',
  );

  const replacement = await agent
    .post(`/api/media/${firstRecord.id}/replace`)
    .attach('image', PNG_TWO, {
      filename: 'replacement.png',
      contentType: 'image/png',
    });
  assert.equal(replacement.status, 200, replacement.text);
  const secondRecord = replacement.body.media;
  assert.equal(secondRecord.id, firstRecord.id);
  assert.equal(secondRecord.stored_name, firstRecord.stored_name);
  assert.equal(secondRecord.relative_path, firstRecord.relative_path);
  assert.equal(secondRecord.content_hash, sha256(PNG_TWO));
  assert.notEqual(secondRecord.content_hash, firstRecord.content_hash);
  assert.deepEqual(await fs.readFile(sourcePath), PNG_TWO);

  const secondManifest = await readManifest(runtime);
  const secondVersion = secondManifest[secondRecord.relative_path];
  assert.equal(secondVersion, sha256(PNG_TWO).slice(0, 10));
  assert.notEqual(secondVersion, firstVersion);
  assert.equal(
    secondManifest['/assets/js/site.js'],
    firstManifest['/assets/js/site.js'],
    'an unchanged asset hash must remain stable',
  );
  assert.deepEqual(
    await fs.readFile(
      path.join(runtime.generatedDir, 'uploads', secondRecord.stored_name),
    ),
    PNG_TWO,
  );

  const secondPublicResponse = await request(runtime.app).get(
    `${secondRecord.relative_path}?v=${secondVersion}`,
  );
  assert.equal(secondPublicResponse.status, 200);
  assert.equal(
    secondPublicResponse.headers['cache-control'],
    'public, max-age=31536000, immutable',
  );
});

test('mobile page uploads are resized, converted to PNG, and rendered without decorations', async (t) => {
  const runtime = await createTestRuntime(t, { realGenerator: true });
  const agent = request.agent(runtime.app);
  assert.equal((await login(agent)).status, 200);

  const source = await sharp({
    create: {
      width: 1440,
      height: 2400,
      channels: 3,
      background: { r: 184, g: 53, b: 63 },
    },
  }).jpeg({ quality: 90 }).toBuffer();
  const upload = await agent
    .post('/api/media/mobile-page')
    .attach('image', source, {
      filename: 'mobile-poster.jpg',
      contentType: 'image/jpeg',
    });
  assert.equal(upload.status, 201, upload.text);
  const media = upload.body.media;
  assert.match(media.stored_name, /^[a-f0-9-]+\.png$/iu);
  assert.equal(media.mime_type, 'image/png');

  const sourcePath = path.join(runtime.uploadsDir, media.stored_name);
  const metadata = await sharp(sourcePath).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1200);

  const pageResponse = await agent.post('/api/pages').send({
    parent_id: runtime.rootPage.id,
    title: '手机整图展示',
    slug: 'mobile-poster',
    template_type: 'image-only',
    decorative_character: '不应显示',
    title_image: media.relative_path,
    background_image: 'hui',
    content: '<h1>不应显示的正文</h1>',
    sort_order: 0,
    status: 'published',
  });
  assert.equal(pageResponse.status, 201, pageResponse.text);

  const pageHtml = await fs.readFile(
    path.join(runtime.generatedDir, 'mobile-poster', 'index.html'),
    'utf8',
  );
  assert.match(pageHtml, /<body class="template-image-only">/u);
  assert.match(
    pageHtml,
    new RegExp(`class="image-only-page__image" src="/uploads/${media.stored_name}\\?v=[a-f0-9]{10}"`),
  );
  assert.equal((pageHtml.match(/<img\b/gu) || []).length, 2);
  assert.match(pageHtml, /class="back-button" href="\/"/u);
  assert.doesNotMatch(
    pageHtml,
    /page-background|page-heading|site-footer|<h1|不应显示的正文|不应显示/u,
  );

  const replacementSource = await sharp({
    create: {
      width: 1200,
      height: 1200,
      channels: 4,
      background: { r: 32, g: 95, b: 141, alpha: 0.8 },
    },
  }).webp().toBuffer();
  const replacement = await agent
    .post(`/api/media/${media.id}/replace`)
    .attach('image', replacementSource, {
      filename: 'replacement.webp',
      contentType: 'image/webp',
    });
  assert.equal(replacement.status, 200, replacement.text);
  assert.equal(replacement.body.media.stored_name, media.stored_name);
  assert.equal(replacement.body.media.mime_type, 'image/png');
  assert.notEqual(replacement.body.media.content_hash, media.content_hash);

  const replacementMetadata = await sharp(sourcePath).metadata();
  assert.equal(replacementMetadata.format, 'png');
  assert.equal(replacementMetadata.width, 720);
  assert.equal(replacementMetadata.height, 720);
});

module.exports = { PNG_ONE, PNG_TWO };
