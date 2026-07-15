'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ContentService, seedExampleData } = require('../server/content-service');
const { openDatabase } = require('../server/database');

function expectCode(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

test('content service rejects publication states that cannot form a valid site tree', () => {
  const db = openDatabase(':memory:');
  const service = new ContentService(db);
  const home = service.createPage({
    parent_id: null,
    title: '首页',
    slug: '',
    template_type: 'home',
    title_image: '/assets/images/home/main-title.png',
    status: 'published',
  });
  const draftParent = service.createPage({
    parent_id: home.id,
    title: '草稿父页',
    slug: 'draft-parent',
    template_type: 'card-list',
    status: 'draft',
  });

  expectCode(() => service.updatePage(home.id, { status: 'draft' }), 'HOME_MUST_BE_PUBLISHED');
  expectCode(() => service.createPage({
    parent_id: null,
    title: '无父级草稿',
    slug: 'orphan',
    template_type: 'content',
    status: 'draft',
  }), 'PAGE_PARENT_REQUIRED');
  expectCode(() => service.createPage({
    parent_id: home.id,
    title: '保留路由',
    slug: 'api',
    template_type: 'content',
    status: 'draft',
  }), 'RESERVED_ROOT_SLUG');
  expectCode(() => service.createPage({
    parent_id: draftParent.id,
    title: '错误发布子页',
    slug: 'bad-child',
    template_type: 'content',
    title_image: '/assets/images/titles/hui-consulting.png',
    status: 'published',
  }), 'PUBLISHED_PARENT_REQUIRED');
  expectCode(() => service.createCard({
    page_id: draftParent.id,
    item_type: 'text_link',
    title: '错误 owner',
    external_url: 'https://example.com/',
    status: 'published',
  }), 'PUBLISHED_CARD_OWNER_REQUIRED');

  const publishedPage = service.createPage({
    parent_id: home.id,
    title: '发布页',
    slug: 'published',
    template_type: 'content',
    title_image: '/assets/images/titles/hui-consulting.png',
    status: 'published',
  });
  expectCode(() => service.createCard({
    page_id: publishedPage.id,
    item_type: 'text_link',
    title: '错误 target',
    target_page_id: draftParent.id,
    status: 'published',
  }), 'PUBLISHED_CARD_TARGET_REQUIRED');
  expectCode(() => service.createCard({
    page_id: publishedPage.id,
    item_type: 'image_card',
    title: '缺图片',
    external_url: 'https://example.com/',
    status: 'published',
  }), 'CARD_IMAGE_REQUIRED');
  expectCode(() => service.createCard({
    page_id: publishedPage.id,
    item_type: 'text_link',
    title: '缺链接',
    status: 'published',
  }), 'CARD_TARGET_REQUIRED');
  expectCode(() => service.updatePage(home.id, { status: 'archived' }), 'HOME_MUST_BE_PUBLISHED');

  const child = service.createPage({
    parent_id: publishedPage.id,
    title: '已发布后代',
    slug: 'child',
    template_type: 'content',
    title_image: '/assets/images/titles/hui-consulting.png',
    status: 'published',
  });
  assert.ok(child.id);
  expectCode(
    () => service.updatePage(publishedPage.id, { status: 'draft' }),
    'PAGE_HAS_PUBLISHED_DESCENDANTS',
  );
  db.close();
});

test('replace seed deletes a self-referencing page tree leaf-first and reseeds deterministically', () => {
  const db = openDatabase(':memory:');
  const first = seedExampleData(db);
  const second = seedExampleData(db, { replace: true });
  assert.equal(first.pageCount, 24);
  assert.equal(first.cardCount, 32);
  assert.equal(second.pageCount, 24);
  assert.equal(second.cardCount, 32);
  assert.equal(second.fourthLevelExampleUrl, '/hui/human-resources/national-policies/');
  assert.equal(
    new ContentService(db).getSiteSettings().copyright_text,
    '中国工商银行云南省分行 · 养老金融与资产托管部',
  );
  db.close();
});
