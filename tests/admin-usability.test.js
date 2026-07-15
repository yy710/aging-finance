'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { TEST_PASSWORD, createTestRuntime } = require('./helpers/runtime');

test('admin exposes friendly labels, a complete image library, and same-origin page previews', async (t) => {
  const runtime = await createTestRuntime(t, { realGenerator: true });
  const agent = request.agent(runtime.app);
  await agent.post('/api/auth/login').send({ password: TEST_PASSWORD }).expect(200);

  const library = await agent.get('/api/media').expect(200);
  assert.deepEqual(library.body.media, []);
  assert.ok(library.body.images.length >= 79, 'all built-in website images should be available');
  assert.equal(new Set(library.body.images.map((image) => image.relative_path)).size, library.body.images.length);
  assert.ok(library.body.images.every((image) => image.relative_path.startsWith('/assets/')));

  const admin = await request(runtime.app).get('/admin/').expect(200);
  const visibleText = admin.text
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ');
  assert.doesNotMatch(visibleText, /\b(?:slug|cms|card|html|url)\b/iu);
  assert.doesNotMatch(visibleText, /配置文件|私有配置|内容哈希|静态路径/u);
  assert.match(visibleText, /页面预览/u);
  assert.match(visibleText, /图片库/u);
  assert.match(visibleText, /页面模板/u);
  assert.match(visibleText, /单张图片页/u);
  assert.match(visibleText, /上传手机页面图片/u);
  assert.match(visibleText, /最大 720px 宽.*PNG/u);
  assert.match(visibleText, /设置点击链接/u);
  assert.match(visibleText, /仅显示本页面的下级页面/u);
  assert.match(admin.text, /id="card-target-children-only"[^>]+checked/u);
  assert.match(admin.text, /id="card-external-url-field"[^>]+hidden/u);
  assert.doesNotMatch(visibleText, /点击后打开本站页面|或打开其他网站/u);
  assert.doesNotMatch(visibleText, /页面展示方式/u);
  assert.match(
    admin.text,
    /id="page-content-field"[^>]+data-hidden-for-templates="home card-list image-only"/u,
  );

  const publicPage = await request(runtime.app).get('/').expect(200);
  assert.equal(publicPage.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(publicPage.headers['content-security-policy'], /frame-ancestors 'self'/u);

  assert.equal(admin.headers['x-frame-options'], 'DENY');
  assert.match(admin.headers['content-security-policy'], /frame-ancestors 'none'/u);
});
