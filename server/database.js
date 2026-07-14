'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');

const DEFAULT_DATABASE_PATH = path.resolve(process.cwd(), 'data', 'site.db');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT NOT NULL DEFAULT '养老金融',
  logo_path TEXT NOT NULL DEFAULT '',
  home_title TEXT NOT NULL DEFAULT '如意人生',
  home_subtitle TEXT NOT NULL DEFAULT '',
  copyright_text TEXT NOT NULL DEFAULT '',
  default_background TEXT NOT NULL DEFAULT '',
  extra_config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(extra_config) AND json_type(extra_config) = 'object')
);

CREATE TABLE IF NOT EXISTS pages (
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
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (template_type = 'home' AND parent_id IS NULL AND slug = '') OR
    (template_type <> 'home' AND length(slug) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS pages_unique_root_slug
  ON pages(slug)
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pages_unique_sibling_slug
  ON pages(parent_id, slug)
  WHERE parent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pages_single_home
  ON pages(template_type)
  WHERE template_type = 'home';

CREATE INDEX IF NOT EXISTS pages_parent_order
  ON pages(parent_id, sort_order, id);

CREATE INDEX IF NOT EXISTS pages_status
  ON pages(status);

CREATE TRIGGER IF NOT EXISTS pages_prevent_parent_cycle
BEFORE UPDATE OF parent_id ON pages
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'page parent cycle')
  WHERE NEW.parent_id = NEW.id
     OR NEW.parent_id IN (
       WITH RECURSIVE descendants(id) AS (
         SELECT id FROM pages WHERE parent_id = NEW.id
         UNION
         SELECT pages.id
         FROM pages
         JOIN descendants ON pages.parent_id = descendants.id
       )
       SELECT id FROM descendants
     );
END;

CREATE TABLE IF NOT EXISTS cards (
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

CREATE INDEX IF NOT EXISTS cards_page_order
  ON cards(page_id, sort_order, id);

CREATE INDEX IF NOT EXISTS cards_target_page
  ON cards(target_page_id);

CREATE INDEX IF NOT EXISTS cards_status
  ON cards(status);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS media_content_hash
  ON media(content_hash);
`;

function resolveOpenArguments(filenameOrOptions, maybeOptions) {
  if (filenameOrOptions && typeof filenameOrOptions === 'object') {
    const options = { ...filenameOrOptions };
    const filename = options.filename || DEFAULT_DATABASE_PATH;
    delete options.filename;
    return { filename, options };
  }
  return {
    filename: filenameOrOptions || DEFAULT_DATABASE_PATH,
    options: { ...(maybeOptions || {}) },
  };
}

function configureDatabase(db, { readonly = false } = {}) {
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });
  if (foreignKeysEnabled !== 1) {
    throw new Error('SQLite foreign_keys pragma could not be enabled');
  }
  return db;
}

function initializeSchema(db) {
  const migrate = db.transaction(() => {
    db.exec(SCHEMA_SQL);
    db.prepare(`
      INSERT INTO site_settings (id)
      VALUES (1)
      ON CONFLICT(id) DO NOTHING
    `).run();
    db.pragma('user_version = 1');
  });
  migrate();
  return db;
}

function openDatabase(filenameOrOptions = DEFAULT_DATABASE_PATH, maybeOptions = {}) {
  const { filename, options } = resolveOpenArguments(filenameOrOptions, maybeOptions);
  const resolvedFilename = filename === ':memory:' ? filename : path.resolve(filename);
  const {
    initialize = true,
    readonly = false,
    fileMustExist = false,
    timeout = 5000,
    verbose,
    nativeBinding,
  } = options;

  if (resolvedFilename !== ':memory:' && !readonly) {
    fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true });
  }

  const driverOptions = { readonly, fileMustExist, timeout };
  if (verbose) driverOptions.verbose = verbose;
  if (nativeBinding) driverOptions.nativeBinding = nativeBinding;

  const db = new BetterSqlite3(resolvedFilename, driverOptions);
  try {
    configureDatabase(db, { readonly });
    if (initialize && !readonly) {
      initializeSchema(db);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function closeDatabase(db) {
  if (db && db.open) {
    db.close();
  }
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  SCHEMA_SQL,
  closeDatabase,
  configureDatabase,
  createDatabase: openDatabase,
  initializeSchema,
  openDatabase,
};
