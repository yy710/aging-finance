'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ContentService } = require('../server/content-service');
const {
  DATABASE_VERSION,
  closeDatabase,
  initializeSchema,
  openDatabase,
} = require('../server/database');

test('existing databases migrate to support the image-only page template', (t) => {
  const db = openDatabase(':memory:', { initialize: false });
  t.after(() => closeDatabase(db));
  db.exec(`
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES pages(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      slug TEXT NOT NULL,
      template_type TEXT NOT NULL CHECK (template_type IN ('home', 'card-list', 'content', 'link-list')),
      decorative_character TEXT NOT NULL DEFAULT '',
      title_image TEXT NOT NULL DEFAULT '',
      background_image TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO pages (
      id, parent_id, title, slug, template_type, decorative_character,
      title_image, background_image, content, sort_order, status
    ) VALUES (
      1, NULL, '旧首页', '', 'home', '',
      '/assets/images/home/main-title.png', 'home', '', 0, 'published'
    );
    INSERT INTO pages (
      id, parent_id, title, slug, template_type, decorative_character,
      title_image, background_image, content, sort_order, status
    ) VALUES (
      2, 1, '旧子页面', 'legacy-child', 'content', '惠',
      '/assets/images/titles/hui-consulting.png', 'hui', '旧正文', 0, 'published'
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON UPDATE CASCADE ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('image_card', 'text_link')),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      image_alt TEXT NOT NULL DEFAULT '',
      target_page_id INTEGER REFERENCES pages(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      external_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO cards (
      id, page_id, item_type, title, description, image_path, image_alt,
      target_page_id, external_url, sort_order, status
    ) VALUES (
      1, 2, 'text_link', '旧链接', '', '', '', 2, '', 0, 'published'
    );
    PRAGMA user_version = 1;
  `);

  initializeSchema(db);
  const service = new ContentService(db);
  assert.equal(service.getPage(1).title, '旧首页');
  assert.equal(service.getPage(2).title, '旧子页面');
  assert.equal(service.getCard(1).title, '旧链接');
  const imagePage = service.createPage({
    parent_id: 1,
    title: '迁移后的单图页',
    slug: 'migrated-image',
    template_type: 'image-only',
    decorative_character: '',
    title_image: '/assets/images/home/logo.png',
    background_image: '',
    content: '',
    status: 'published',
  });
  assert.equal(imagePage.template_type, 'image-only');
  assert.equal(db.pragma('user_version', { simple: true }), DATABASE_VERSION);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
