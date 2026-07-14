'use strict';

const {
  ConflictError,
  NotFoundError,
  ValidationError,
  positiveId,
  validateCardRecord,
  validateCardStatus,
  validateMediaRecord,
  validatePageRecord,
  validatePageStatus,
  validateSiteSettingsRecord,
} = require('./validation');

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const RESERVED_ROOT_SLUGS = new Set(['_assets', 'admin', 'api', 'assets', 'health', 'uploads']);

function currentTimestamp() {
  return new Date().toISOString();
}

function clampPosition(value, length) {
  return Math.max(0, Math.min(Number(value), length));
}

function parseExtraConfig(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function encodePathSegment(value) {
  return encodeURIComponent(value);
}

class ContentService {
  constructor(db, { ownsDatabase = false } = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
      throw new TypeError('ContentService requires an open better-sqlite3 database');
    }
    this.db = db;
    this.ownsDatabase = ownsDatabase;
    this.statements = this.#prepareStatements();
  }

  #prepareStatements() {
    return {
      getSettings: this.db.prepare('SELECT * FROM site_settings WHERE id = 1'),
      updateSettings: this.db.prepare(`
        UPDATE site_settings
        SET site_name = @site_name,
            logo_path = @logo_path,
            home_title = @home_title,
            home_subtitle = @home_subtitle,
            copyright_text = @copyright_text,
            default_background = @default_background,
            extra_config = @extra_config,
            updated_at = @updated_at
        WHERE id = 1
      `),

      countPages: this.db.prepare('SELECT COUNT(*) AS count FROM pages'),
      getPage: this.db.prepare('SELECT * FROM pages WHERE id = ?'),
      listPages: this.db.prepare(`
        SELECT * FROM pages
        ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
                 parent_id,
                 sort_order,
                 id
      `),
      listPagesByStatus: this.db.prepare(`
        SELECT * FROM pages
        WHERE status = ?
        ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
                 parent_id,
                 sort_order,
                 id
      `),
      listChildPages: this.db.prepare(`
        SELECT * FROM pages
        WHERE parent_id IS ?
        ORDER BY sort_order, id
      `),
      nextPageOrder: this.db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
        FROM pages
        WHERE parent_id IS ?
      `),
      duplicateSiblingSlug: this.db.prepare(`
        SELECT id FROM pages
        WHERE parent_id IS @parent_id
          AND slug = @slug
          AND id <> @exclude_id
        LIMIT 1
      `),
      descendantContains: this.db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE parent_id = @page_id
          UNION
          SELECT pages.id
          FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        SELECT id FROM descendants WHERE id = @candidate_parent_id LIMIT 1
      `),
      childCount: this.db.prepare('SELECT COUNT(*) AS count FROM pages WHERE parent_id = ?'),
      inboundCardCount: this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM cards
        WHERE target_page_id = @page_id AND page_id <> @page_id
      `),
      insertPage: this.db.prepare(`
        INSERT INTO pages (
          parent_id, title, slug, template_type, decorative_character,
          title_image, background_image, content, sort_order, status
        ) VALUES (
          @parent_id, @title, @slug, @template_type, @decorative_character,
          @title_image, @background_image, @content, @sort_order, @status
        )
      `),
      updatePage: this.db.prepare(`
        UPDATE pages
        SET parent_id = @parent_id,
            title = @title,
            slug = @slug,
            template_type = @template_type,
            decorative_character = @decorative_character,
            title_image = @title_image,
            background_image = @background_image,
            content = @content,
            sort_order = @sort_order,
            status = @status,
            updated_at = @updated_at
        WHERE id = @id
      `),
      deletePage: this.db.prepare('DELETE FROM pages WHERE id = ?'),
      deleteLeafPages: this.db.prepare(`
        DELETE FROM pages
        WHERE id NOT IN (
          SELECT DISTINCT parent_id FROM pages WHERE parent_id IS NOT NULL
        )
      `),

      countCards: this.db.prepare('SELECT COUNT(*) AS count FROM cards'),
      getCard: this.db.prepare('SELECT * FROM cards WHERE id = ?'),
      listCards: this.db.prepare(`
        SELECT * FROM cards
        WHERE page_id = ?
        ORDER BY sort_order, id
      `),
      listCardsByStatus: this.db.prepare(`
        SELECT * FROM cards
        WHERE page_id = ? AND status = ?
        ORDER BY sort_order, id
      `),
      listAllCards: this.db.prepare('SELECT * FROM cards ORDER BY page_id, sort_order, id'),
      listAllCardsByStatus: this.db.prepare(`
        SELECT * FROM cards
        WHERE status = ?
        ORDER BY page_id, sort_order, id
      `),
      nextCardOrder: this.db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
        FROM cards
        WHERE page_id = ?
      `),
      orderedCardIds: this.db.prepare(`
        SELECT id FROM cards
        WHERE page_id = ?
        ORDER BY sort_order, id
      `),
      insertCard: this.db.prepare(`
        INSERT INTO cards (
          page_id, item_type, title, description, image_path, image_alt,
          target_page_id, external_url, sort_order, status
        ) VALUES (
          @page_id, @item_type, @title, @description, @image_path, @image_alt,
          @target_page_id, @external_url, @sort_order, @status
        )
      `),
      updateCard: this.db.prepare(`
        UPDATE cards
        SET page_id = @page_id,
            item_type = @item_type,
            title = @title,
            description = @description,
            image_path = @image_path,
            image_alt = @image_alt,
            target_page_id = @target_page_id,
            external_url = @external_url,
            sort_order = @sort_order,
            status = @status,
            updated_at = @updated_at
        WHERE id = @id
      `),
      setCardOrder: this.db.prepare('UPDATE cards SET sort_order = ? WHERE id = ?'),
      deleteCard: this.db.prepare('DELETE FROM cards WHERE id = ?'),

      getMedia: this.db.prepare('SELECT * FROM media WHERE id = ?'),
      listMedia: this.db.prepare('SELECT * FROM media ORDER BY created_at DESC, id DESC'),
      insertMedia: this.db.prepare(`
        INSERT INTO media (
          original_name, stored_name, relative_path, mime_type, file_size, content_hash
        ) VALUES (
          @original_name, @stored_name, @relative_path, @mime_type, @file_size, @content_hash
        )
      `),
      updateMedia: this.db.prepare(`
        UPDATE media
        SET original_name = @original_name,
            stored_name = @stored_name,
            relative_path = @relative_path,
            mime_type = @mime_type,
            file_size = @file_size,
            content_hash = @content_hash
        WHERE id = @id
      `),
      deleteMedia: this.db.prepare('DELETE FROM media WHERE id = ?'),
    };
  }

  #requirePage(pageId) {
    const id = positiveId(pageId, 'page_id');
    const page = this.statements.getPage.get(id);
    if (!page) {
      throw new NotFoundError(`页面 ${id} 不存在`, 'PAGE_NOT_FOUND', { pageId: id });
    }
    return page;
  }

  #requireCard(cardId) {
    const id = positiveId(cardId, 'card_id');
    const card = this.statements.getCard.get(id);
    if (!card) {
      throw new NotFoundError(`Card ${id} 不存在`, 'CARD_NOT_FOUND', { cardId: id });
    }
    return card;
  }

  #requireMedia(mediaId) {
    const id = positiveId(mediaId, 'media_id');
    const media = this.statements.getMedia.get(id);
    if (!media) {
      throw new NotFoundError(`媒体 ${id} 不存在`, 'MEDIA_NOT_FOUND', { mediaId: id });
    }
    return media;
  }

  #allPagesMap() {
    return new Map(this.statements.listPages.all().map((page) => [page.id, page]));
  }

  #pageUrl(pageId, pagesById = this.#allPagesMap()) {
    const id = positiveId(pageId, 'page_id');
    let page = pagesById.get(id);
    if (!page) {
      throw new NotFoundError(`页面 ${id} 不存在`, 'PAGE_NOT_FOUND', { pageId: id });
    }

    const segments = [];
    const seen = new Set();
    while (page) {
      if (seen.has(page.id)) {
        throw new ConflictError('页面父子关系存在循环', 'PAGE_PARENT_CYCLE', {
          pageId: page.id,
        });
      }
      seen.add(page.id);
      if (page.slug) segments.unshift(page.slug);
      page = page.parent_id === null ? null : pagesById.get(page.parent_id);
      if (page === undefined) {
        throw new ConflictError('页面引用了不存在的父页面', 'ORPHAN_PAGE', { pageId: id });
      }
    }
    return segments.length ? `/${segments.map(encodePathSegment).join('/')}/` : '/';
  }

  #decoratePage(page, pagesById = this.#allPagesMap()) {
    if (!page) return null;
    return { ...page, url: this.#pageUrl(page.id, pagesById) };
  }

  #decorateCard(card, pagesById = this.#allPagesMap()) {
    if (!card) return null;
    let resolvedUrl = '';
    let isExternal = false;
    if (card.target_page_id !== null) {
      resolvedUrl = this.#pageUrl(card.target_page_id, pagesById);
    } else if (card.external_url) {
      resolvedUrl = card.external_url;
      isExternal = true;
    }
    return { ...card, resolved_url: resolvedUrl, is_external: isExternal };
  }

  #assertParentAllowed(pageId, parentId) {
    if (parentId === null) return;
    this.#requirePage(parentId);
    if (pageId !== null && pageId === parentId) {
      throw new ConflictError('页面不能将自身设为父页面', 'PAGE_PARENT_CYCLE', {
        pageId,
        parentId,
      });
    }
    if (
      pageId !== null &&
      this.statements.descendantContains.get({
        page_id: pageId,
        candidate_parent_id: parentId,
      })
    ) {
      throw new ConflictError('不能将页面移动到其后代页面下', 'PAGE_PARENT_CYCLE', {
        pageId,
        parentId,
      });
    }
  }

  #assertPublishedParentChain(parentId) {
    if (parentId === null) return;
    const pagesById = this.#allPagesMap();
    const seen = new Set();
    let parent = pagesById.get(parentId);
    while (parent) {
      if (seen.has(parent.id)) {
        throw new ConflictError('页面父子关系存在循环', 'PAGE_PARENT_CYCLE');
      }
      seen.add(parent.id);
      if (parent.status !== 'published') {
        throw new ConflictError(
          `发布页面的父级“${parent.title}”尚未发布`,
          'PUBLISHED_PARENT_REQUIRED',
          { parentId: parent.id },
        );
      }
      parent = parent.parent_id === null ? null : pagesById.get(parent.parent_id);
    }
  }

  #assertPageCanLeavePublished(pageId) {
    const pagesById = this.#allPagesMap();
    const publishedDependents = [];
    for (const page of pagesById.values()) {
      if (page.id === pageId || page.status !== 'published') continue;
      const seen = new Set();
      let parentId = page.parent_id;
      while (parentId !== null && !seen.has(parentId)) {
        if (parentId === pageId) {
          publishedDependents.push(page.id);
          break;
        }
        seen.add(parentId);
        parentId = pagesById.get(parentId)?.parent_id ?? null;
      }
    }
    if (publishedDependents.length > 0) {
      throw new ConflictError(
        '该页面仍有已发布的后代页面，不能取消发布',
        'PAGE_HAS_PUBLISHED_DESCENDANTS',
        { pageId, descendantIds: publishedDependents },
      );
    }

    const dependentCards = this.statements.listAllCardsByStatus
      .all('published')
      .filter((card) => card.page_id === pageId || card.target_page_id === pageId)
      .map((card) => card.id);
    if (dependentCards.length > 0) {
      throw new ConflictError(
        '该页面仍拥有或被已发布 Card 引用，不能取消发布',
        'PAGE_HAS_PUBLISHED_CARDS',
        { pageId, cardIds: dependentCards },
      );
    }
  }

  #assertSiblingSlugAvailable(parentId, slug, excludeId = 0) {
    const duplicate = this.statements.duplicateSiblingSlug.get({
      parent_id: parentId,
      slug,
      exclude_id: excludeId,
    });
    if (duplicate) {
      throw new ConflictError('同一父页面下已存在相同 slug', 'DUPLICATE_SIBLING_SLUG', {
        parentId,
        slug,
        conflictingPageId: duplicate.id,
      });
    }
  }

  #assertRootSlugAvailable(parentId, slug) {
    if (parentId === null) return;
    const parent = this.#requirePage(parentId);
    if (parent.parent_id === null && RESERVED_ROOT_SLUGS.has(String(slug).toLowerCase())) {
      throw new ConflictError(
        `顶级 slug“${slug}”由服务器保留，不能用于公开页面`,
        'RESERVED_ROOT_SLUG',
        { parentId, slug },
      );
    }
  }

  #assertCardReferences(record) {
    const owner = this.#requirePage(record.page_id);
    if (record.status === 'published' && owner.status !== 'published') {
      throw new ConflictError('发布的 Card 必须属于已发布页面', 'PUBLISHED_CARD_OWNER_REQUIRED', {
        pageId: owner.id,
      });
    }
    if (record.target_page_id !== null) {
      const target = this.#requirePage(record.target_page_id);
      if (record.status === 'published' && target.status !== 'published') {
        throw new ConflictError('发布的 Card 必须链接到已发布页面', 'PUBLISHED_CARD_TARGET_REQUIRED', {
          targetPageId: target.id,
        });
      }
    }
  }

  #orderedCardIds(pageId) {
    return this.statements.orderedCardIds.all(pageId).map((row) => row.id);
  }

  #resequenceCards(pageId, orderedIds = this.#orderedCardIds(pageId)) {
    orderedIds.forEach((id, index) => this.statements.setCardOrder.run(index, id));
  }

  getSiteSettings() {
    const row = this.statements.getSettings.get();
    if (!row) {
      throw new NotFoundError('网站设置不存在', 'SITE_SETTINGS_NOT_FOUND');
    }
    return { ...row, extra_config: parseExtraConfig(row.extra_config) };
  }

  updateSiteSettings(patch = {}) {
    const existing = this.getSiteSettings();
    const record = validateSiteSettingsRecord({ ...existing, ...patch });
    this.statements.updateSettings.run({ ...record, updated_at: currentTimestamp() });
    return this.getSiteSettings();
  }

  countPages() {
    return this.statements.countPages.get().count;
  }

  getPage(pageId) {
    const page = this.#requirePage(pageId);
    return this.#decoratePage(page);
  }

  getPagePath(pageId) {
    return this.#pageUrl(pageId);
  }

  getPageBreadcrumbs(pageId) {
    const id = positiveId(pageId, 'page_id');
    const pagesById = this.#allPagesMap();
    let page = pagesById.get(id);
    if (!page) this.#requirePage(id);

    const breadcrumbs = [];
    const seen = new Set();
    while (page) {
      if (seen.has(page.id)) {
        throw new ConflictError('页面父子关系存在循环', 'PAGE_PARENT_CYCLE');
      }
      seen.add(page.id);
      breadcrumbs.unshift(this.#decoratePage(page, pagesById));
      page = page.parent_id === null ? null : pagesById.get(page.parent_id);
    }
    return breadcrumbs;
  }

  getPageByPath(urlPath) {
    if (typeof urlPath !== 'string') {
      throw new ValidationError('页面路径必须是字符串', 'INVALID_PAGE_PATH');
    }
    let normalized;
    try {
      const segments = urlPath.split('/').filter(Boolean);
      normalized = segments.length === 0
        ? '/'
        : `/${segments.map(decodeURIComponent).map(encodePathSegment).join('/')}/`;
    } catch {
      throw new ValidationError('页面路径包含无效的 URL 编码', 'INVALID_PAGE_PATH');
    }
    const pagesById = this.#allPagesMap();
    for (const page of pagesById.values()) {
      if (this.#pageUrl(page.id, pagesById) === normalized) {
        return this.#decoratePage(page, pagesById);
      }
    }
    return null;
  }

  listPages({ status } = {}) {
    const rows = status === undefined
      ? this.statements.listPages.all()
      : this.statements.listPagesByStatus.all(validatePageStatus(status));
    const pagesById = this.#allPagesMap();
    return rows.map((page) => this.#decoratePage(page, pagesById));
  }

  listChildPages(parentId, { status } = {}) {
    const normalizedParentId = parentId === null ? null : positiveId(parentId, 'parent_id');
    if (normalizedParentId !== null) this.#requirePage(normalizedParentId);
    const pages = this.statements.listChildPages.all(normalizedParentId);
    const filtered = status === undefined
      ? pages
      : pages.filter((page) => page.status === validatePageStatus(status));
    const pagesById = this.#allPagesMap();
    return filtered.map((page) => this.#decoratePage(page, pagesById));
  }

  getPageTree({ status } = {}) {
    const pages = this.listPages({ status });
    const nodesById = new Map(pages.map((page) => [page.id, { ...page, children: [] }]));
    const roots = [];
    for (const node of nodesById.values()) {
      if (node.parent_id !== null && nodesById.has(node.parent_id)) {
        nodesById.get(node.parent_id).children.push(node);
      } else {
        if (node.parent_id !== null) node.orphaned = true;
        roots.push(node);
      }
    }
    return roots;
  }

  createPage(input = {}) {
    return this.db.transaction(() => {
      const parentId = input.parent_id === undefined || input.parent_id === null || input.parent_id === ''
        ? null
        : positiveId(input.parent_id, 'parent_id');
      if (parentId !== null) this.#requirePage(parentId);
      const nextOrder = this.statements.nextPageOrder.get(parentId).next_order;
      const record = validatePageRecord({
        parent_id: parentId,
        title: input.title,
        slug: input.slug ?? '',
        template_type: input.template_type ?? 'content',
        decorative_character: input.decorative_character ?? '',
        title_image: input.title_image ?? '',
        background_image: input.background_image ?? '',
        content: input.content ?? '',
        sort_order: input.sort_order ?? nextOrder,
        status: input.status ?? 'draft',
      });

      this.#assertParentAllowed(null, record.parent_id);
      if (record.status === 'published') this.#assertPublishedParentChain(record.parent_id);
      this.#assertRootSlugAvailable(record.parent_id, record.slug);
      this.#assertSiblingSlugAvailable(record.parent_id, record.slug);

      try {
        const result = this.statements.insertPage.run(record);
        return this.getPage(Number(result.lastInsertRowid));
      } catch (error) {
        if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
          throw new ConflictError('页面与现有页面冲突', 'PAGE_CONSTRAINT', {
            cause: error.message,
          });
        }
        throw error;
      }
    })();
  }

  updatePage(pageId, patch = {}) {
    return this.db.transaction(() => {
      const id = positiveId(pageId, 'page_id');
      const existing = this.#requirePage(id);
      const previousUrl = this.#pageUrl(id);
      const record = validatePageRecord({
        parent_id: hasOwn(patch, 'parent_id') ? patch.parent_id : existing.parent_id,
        title: hasOwn(patch, 'title') ? patch.title : existing.title,
        slug: hasOwn(patch, 'slug') ? patch.slug : existing.slug,
        template_type: hasOwn(patch, 'template_type') ? patch.template_type : existing.template_type,
        decorative_character: hasOwn(patch, 'decorative_character')
          ? patch.decorative_character
          : existing.decorative_character,
        title_image: hasOwn(patch, 'title_image') ? patch.title_image : existing.title_image,
        background_image: hasOwn(patch, 'background_image')
          ? patch.background_image
          : existing.background_image,
        content: hasOwn(patch, 'content') ? patch.content : existing.content,
        sort_order: hasOwn(patch, 'sort_order') ? patch.sort_order : existing.sort_order,
        status: hasOwn(patch, 'status') ? patch.status : existing.status,
      });

      if (existing.template_type === 'home' && record.template_type !== 'home') {
        throw new ConflictError('首页不能改为其他模板', 'HOME_TEMPLATE_IMMUTABLE');
      }
      this.#assertParentAllowed(id, record.parent_id);
      if (record.status === 'published') {
        this.#assertPublishedParentChain(record.parent_id);
      } else if (existing.status === 'published') {
        this.#assertPageCanLeavePublished(id);
      }
      this.#assertRootSlugAvailable(record.parent_id, record.slug);
      this.#assertSiblingSlugAvailable(record.parent_id, record.slug, id);

      try {
        this.statements.updatePage.run({ ...record, id, updated_at: currentTimestamp() });
      } catch (error) {
        if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
          throw new ConflictError('页面与现有页面冲突', 'PAGE_CONSTRAINT', {
            cause: error.message,
          });
        }
        throw error;
      }
      return { ...this.getPage(id), previous_url: previousUrl };
    })();
  }

  deletePage(pageId) {
    return this.db.transaction(() => {
      const id = positiveId(pageId, 'page_id');
      const existing = this.#requirePage(id);
      if (existing.template_type === 'home') {
        throw new ConflictError('不能删除网站首页', 'CANNOT_DELETE_HOME', { pageId: id });
      }
      const childCount = this.statements.childCount.get(id).count;
      if (childCount > 0) {
        throw new ConflictError('该页面仍有子页面，默认拒绝删除', 'PAGE_HAS_CHILDREN', {
          pageId: id,
          childCount,
        });
      }
      const inboundCardCount = this.statements.inboundCardCount.get({ page_id: id }).count;
      if (inboundCardCount > 0) {
        throw new ConflictError('该页面仍被其他 Card 链接，不能删除', 'PAGE_HAS_INBOUND_LINKS', {
          pageId: id,
          inboundCardCount,
        });
      }
      const previousUrl = this.#pageUrl(id);
      this.statements.deletePage.run(id);
      return { ...existing, url: previousUrl, deleted: true };
    })();
  }

  countCards() {
    return this.statements.countCards.get().count;
  }

  getCard(cardId) {
    const card = this.#requireCard(cardId);
    return this.#decorateCard(card);
  }

  listCards(pageId, { status } = {}) {
    const id = positiveId(pageId, 'page_id');
    this.#requirePage(id);
    const rows = status === undefined
      ? this.statements.listCards.all(id)
      : this.statements.listCardsByStatus.all(id, validateCardStatus(status));
    const pagesById = this.#allPagesMap();
    return rows.map((card) => this.#decorateCard(card, pagesById));
  }

  listAllCards({ status } = {}) {
    const rows = status === undefined
      ? this.statements.listAllCards.all()
      : this.statements.listAllCardsByStatus.all(validateCardStatus(status));
    const pagesById = this.#allPagesMap();
    return rows.map((card) => this.#decorateCard(card, pagesById));
  }

  createCard(input = {}) {
    return this.db.transaction(() => {
      const pageId = positiveId(input.page_id, 'page_id');
      this.#requirePage(pageId);
      const requestedOrder = hasOwn(input, 'sort_order') ? input.sort_order : null;
      const nextOrder = this.statements.nextCardOrder.get(pageId).next_order;
      const record = validateCardRecord({
        page_id: pageId,
        item_type: input.item_type ?? 'image_card',
        title: input.title,
        description: input.description ?? '',
        image_path: input.image_path ?? '',
        image_alt: input.image_alt ?? '',
        target_page_id: input.target_page_id ?? null,
        external_url: input.external_url ?? '',
        sort_order: requestedOrder ?? nextOrder,
        status: input.status ?? 'draft',
      });
      this.#assertCardReferences(record);

      const result = this.statements.insertCard.run({ ...record, sort_order: nextOrder });
      const id = Number(result.lastInsertRowid);
      const orderedIds = this.#orderedCardIds(record.page_id).filter((cardId) => cardId !== id);
      const position = requestedOrder === null
        ? orderedIds.length
        : clampPosition(record.sort_order, orderedIds.length);
      orderedIds.splice(position, 0, id);
      this.#resequenceCards(record.page_id, orderedIds);
      return this.getCard(id);
    })();
  }

  updateCard(cardId, patch = {}) {
    return this.db.transaction(() => {
      const id = positiveId(cardId, 'card_id');
      const existing = this.#requireCard(id);
      const requestedOrder = hasOwn(patch, 'sort_order') ? patch.sort_order : null;
      const originalIds = this.#orderedCardIds(existing.page_id);
      const originalIndex = originalIds.indexOf(id);
      const record = validateCardRecord({
        page_id: hasOwn(patch, 'page_id') ? patch.page_id : existing.page_id,
        item_type: hasOwn(patch, 'item_type') ? patch.item_type : existing.item_type,
        title: hasOwn(patch, 'title') ? patch.title : existing.title,
        description: hasOwn(patch, 'description') ? patch.description : existing.description,
        image_path: hasOwn(patch, 'image_path') ? patch.image_path : existing.image_path,
        image_alt: hasOwn(patch, 'image_alt') ? patch.image_alt : existing.image_alt,
        target_page_id: hasOwn(patch, 'target_page_id')
          ? patch.target_page_id
          : existing.target_page_id,
        external_url: hasOwn(patch, 'external_url') ? patch.external_url : existing.external_url,
        sort_order: requestedOrder ?? existing.sort_order,
        status: hasOwn(patch, 'status') ? patch.status : existing.status,
      });
      this.#assertCardReferences(record);

      this.statements.updateCard.run({
        ...record,
        id,
        sort_order: 2_147_483_647,
        updated_at: currentTimestamp(),
      });

      if (existing.page_id !== record.page_id) {
        this.#resequenceCards(existing.page_id);
      }

      const destinationIds = this.#orderedCardIds(record.page_id).filter((currentId) => currentId !== id);
      let position;
      if (requestedOrder !== null) {
        position = clampPosition(record.sort_order, destinationIds.length);
      } else if (existing.page_id === record.page_id) {
        position = clampPosition(originalIndex, destinationIds.length);
      } else {
        position = destinationIds.length;
      }
      destinationIds.splice(position, 0, id);
      this.#resequenceCards(record.page_id, destinationIds);
      return this.getCard(id);
    })();
  }

  deleteCard(cardId) {
    return this.db.transaction(() => {
      const id = positiveId(cardId, 'card_id');
      const existing = this.#requireCard(id);
      this.statements.deleteCard.run(id);
      this.#resequenceCards(existing.page_id);
      return { ...existing, deleted: true };
    })();
  }

  moveCard(cardId, direction) {
    return this.db.transaction(() => {
      const id = positiveId(cardId, 'card_id');
      const existing = this.#requireCard(id);
      const delta = direction === 'up' || direction === -1
        ? -1
        : direction === 'down' || direction === 1
          ? 1
          : 0;
      if (delta === 0) {
        throw new ValidationError('direction 必须是 up 或 down', 'INVALID_MOVE_DIRECTION');
      }

      const orderedIds = this.#orderedCardIds(existing.page_id);
      const currentIndex = orderedIds.indexOf(id);
      const targetIndex = currentIndex + delta;
      if (targetIndex < 0 || targetIndex >= orderedIds.length) {
        return { ...this.getCard(id), moved: false };
      }
      [orderedIds[currentIndex], orderedIds[targetIndex]] = [
        orderedIds[targetIndex],
        orderedIds[currentIndex],
      ];
      this.#resequenceCards(existing.page_id, orderedIds);
      return { ...this.getCard(id), moved: true };
    })();
  }

  getMedia(mediaId) {
    return this.#requireMedia(mediaId);
  }

  listMedia() {
    return this.statements.listMedia.all();
  }

  createMedia(input) {
    const record = validateMediaRecord(input);
    try {
      const result = this.statements.insertMedia.run(record);
      return this.getMedia(Number(result.lastInsertRowid));
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('媒体文件名或公开路径已存在', 'MEDIA_CONFLICT', {
          cause: error.message,
        });
      }
      throw error;
    }
  }

  updateMedia(mediaId, patch = {}) {
    const id = positiveId(mediaId, 'media_id');
    const existing = this.#requireMedia(id);
    const record = validateMediaRecord({ ...existing, ...patch });
    try {
      this.statements.updateMedia.run({ ...record, id });
      return this.getMedia(id);
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('媒体文件名或公开路径已存在', 'MEDIA_CONFLICT', {
          cause: error.message,
        });
      }
      throw error;
    }
  }

  deleteMedia(mediaId) {
    const id = positiveId(mediaId, 'media_id');
    const existing = this.#requireMedia(id);
    this.statements.deleteMedia.run(id);
    return { ...existing, deleted: true };
  }

  getSiteSnapshot({ status = 'published' } = {}) {
    const pageStatus = validatePageStatus(status);
    const cardStatus = validateCardStatus(status);
    const pages = this.listPages({ status: pageStatus });
    const cards = this.listAllCards({ status: cardStatus });
    const cardsByPageId = new Map();
    for (const card of cards) {
      if (!cardsByPageId.has(card.page_id)) cardsByPageId.set(card.page_id, []);
      cardsByPageId.get(card.page_id).push(card);
    }
    return {
      settings: this.getSiteSettings(),
      pages: pages.map((page) => ({ ...page, cards: cardsByPageId.get(page.id) || [] })),
      cards,
      tree: this.getPageTree({ status: pageStatus }),
    };
  }

  close() {
    if (this.ownsDatabase && this.db && this.db.open) {
      this.db.close();
    }
  }
}

function createContentService(options = {}) {
  const { openDatabase } = require('./database');
  if (options && typeof options.prepare === 'function') {
    return new ContentService(options);
  }
  if (options.db && typeof options.db.prepare === 'function') {
    return new ContentService(options.db, { ownsDatabase: false });
  }

  const filename = options.databasePath || options.filename;
  const db = openDatabase(filename, {
    initialize: options.initialize !== false,
    readonly: options.readonly === true,
    fileMustExist: options.fileMustExist === true,
  });
  return new ContentService(db, { ownsDatabase: true });
}

function seedExampleData(db, { replace = false } = {}) {
  const service = new ContentService(db);
  const seed = db.transaction(() => {
    const existingCount = service.countPages();
    if (existingCount > 0 && !replace) {
      return {
        seeded: false,
        reason: 'database-not-empty',
        pageCount: existingCount,
        cardCount: service.countCards(),
      };
    }

    if (replace) {
      db.prepare('DELETE FROM cards').run();
      while (service.countPages() > 0) {
        const result = service.statements.deleteLeafPages.run();
        if (result.changes === 0) {
          throw new ConflictError('无法清空存在循环关系的页面树', 'PAGE_PARENT_CYCLE');
        }
      }
    }

    service.updateSiteSettings({
      site_name: '云南养老金融生态圈',
      logo_path: '/assets/images/home/logo.png',
      home_title: '如意人生',
      home_subtitle: '一点接入 养老无忧',
      copyright_text: '中国工商银行云南省分行 · 养老金融服务',
      default_background: 'home',
      extra_config: {
        homeTitleImage: '/assets/images/home/main-title.png',
        homeBannerImage: '/assets/images/home/ecosystem-banner.png',
        homeSubtitleImage: '/assets/images/home/tagline.png',
        homeEntryImages: {
          hui: '/assets/images/home/entry-hui.png',
          yi: '/assets/images/home/entry-yi.png',
          yang: '/assets/images/home/entry-yang.png',
          le: '/assets/images/home/entry-le.png',
          chuan: '/assets/images/home/entry-chuan.png',
        },
        backButtonImage: '/assets/images/global/back.png',
        backgroundDecorations: {
          home: { top: '/assets/images/decor/home-top.png', bottom: '/assets/images/decor/home-bottom.png' },
          hui: { top: '/assets/images/decor/hui-top.png', bottom: '/assets/images/decor/hui-bottom.png' },
          yi: { top: '/assets/images/decor/yi-top.png', bottom: '/assets/images/decor/yi-bottom.png' },
          yang: { top: '/assets/images/decor/yang-top.png', bottom: '/assets/images/decor/yang-bottom.png' },
          le: { top: '/assets/images/decor/le-top.png', bottom: '/assets/images/decor/le-bottom.png' },
          chuan: { top: '/assets/images/decor/chuan-top.png', bottom: '/assets/images/decor/chuan-bottom.png' },
        },
      },
    });

    const createPage = (data) => service.createPage({ status: 'published', ...data });
    const createCard = (data) => service.createCard({ status: 'published', ...data });

    const home = createPage({
      parent_id: null,
      title: '如意人生',
      slug: '',
      template_type: 'home',
      title_image: '/assets/images/home/main-title.png',
      background_image: 'home',
      sort_order: 0,
    });

    const hui = createPage({
      parent_id: home.id,
      title: '政策咨询与设施查询',
      slug: 'hui',
      template_type: 'card-list',
      decorative_character: '惠',
      title_image: '/assets/images/titles/hui-consulting.png',
      background_image: 'hui',
      sort_order: 0,
    });
    const yi = createPage({
      parent_id: home.id,
      title: '全周期健康管理',
      slug: 'yi',
      template_type: 'card-list',
      decorative_character: '医',
      title_image: '/assets/images/titles/yi-health-management.png',
      background_image: 'yi',
      sort_order: 1,
    });
    const yang = createPage({
      parent_id: home.id,
      title: '全场景居住支持',
      slug: 'yang',
      template_type: 'card-list',
      decorative_character: '养',
      title_image: '/assets/images/titles/yang-living-support.png',
      background_image: 'yang',
      sort_order: 2,
    });
    const le = createPage({
      parent_id: home.id,
      title: '精神文化和社会价值',
      slug: 'le',
      template_type: 'card-list',
      decorative_character: '乐',
      title_image: '/assets/images/titles/le-cultural-value.png',
      background_image: 'le',
      sort_order: 3,
    });
    const chuan = createPage({
      parent_id: home.id,
      title: '财富传承与慈善捐赠',
      slug: 'chuan',
      template_type: 'card-list',
      decorative_character: '传',
      title_image: '/assets/images/titles/chuan-legacy-giving.png',
      background_image: 'chuan',
      sort_order: 4,
    });

    const ministry = createPage({
      parent_id: hui.id,
      title: '人力资源和社会保障部',
      slug: 'human-resources',
      template_type: 'card-list',
      decorative_character: '惠',
      title_image: '/assets/images/titles/generated-human-resources.png',
      background_image: 'hui',
      content: '<p>养老与社会保障政策服务入口。</p>',
    });
    const nationalPolicies = createPage({
      parent_id: ministry.id,
      title: '国家养老政策',
      slug: 'national-policies',
      template_type: 'link-list',
      decorative_character: '惠',
      title_image: '/assets/images/titles/hui-national-policy.png',
      background_image: 'hui',
    });
    const retirementClass = createPage({
      parent_id: hui.id,
      title: '养老课堂',
      slug: 'retirement-class',
      template_type: 'card-list',
      decorative_character: '惠',
      title_image: '/assets/images/titles/hui-retirement-classroom.png',
      background_image: 'hui',
    });
    const pensionLesson = createPage({
      parent_id: retirementClass.id,
      title: '一图了解个人养老金',
      slug: 'personal-pension-guide',
      template_type: 'content',
      decorative_character: '惠',
      title_image: '/assets/images/titles/generated-personal-pension-guide.png',
      background_image: 'hui',
      content: '<p>个人养老金政策与规划示例内容，正式内容可在管理后台替换。</p>',
    });

    const healthPartners = [
      ['国控云南', 'sinopharm-yunnan'],
      ['美年大健康', 'health-100'],
      ['云南健之佳健康体检中心有限公司', 'jianzhijia'],
    ].map(([title, slug], index) => createPage({
      parent_id: yi.id,
      title,
      slug,
      template_type: 'content',
      decorative_character: '医',
      title_image: `/assets/images/titles/generated-${slug}.png`,
      background_image: 'yi',
      content: `<p>${title}健康服务介绍，正式资料可在管理后台更新。</p>`,
      sort_order: index,
    }));

    const livingPartners = [
      ['昆明朗和银滇养老服务有限公司', 'langhe-yindian'],
      ['北京长护养老服务有限公司', 'changhu'],
      ['云南圣爱康养服务有限公司', 'shengai-care'],
    ].map(([title, slug], index) => createPage({
      parent_id: yang.id,
      title,
      slug,
      template_type: 'content',
      decorative_character: '养',
      title_image: `/assets/images/titles/generated-${slug}.png`,
      background_image: 'yang',
      content: `<p>${title}居住与康养服务介绍，正式资料可在管理后台更新。</p>`,
      sort_order: index,
    }));

    const culturePartners = [
      ['云南新东方文旅集团有限公司', 'new-oriental-tourism'],
      ['云南新华文旅集团有限公司', 'xinhua-tourism'],
      ['云南圣爱健康管理有限公司', 'shengai-health'],
    ].map(([title, slug], index) => createPage({
      parent_id: le.id,
      title,
      slug,
      template_type: 'content',
      decorative_character: '乐',
      title_image: `/assets/images/titles/generated-${slug}.png`,
      background_image: 'le',
      content: `<p>${title}服务介绍，正式资料可在管理后台更新。</p>`,
      sort_order: index,
    }));

    const legacyPartners = [
      ['云南省昆明市明信公证处', 'mingxin-notary'],
      ['云南省昆明市五华公证处', 'wuhua-notary'],
      ['云南君晟律师事务所', 'junsheng-law'],
      ['中国人民保险', 'picc'],
    ].map(([title, slug], index) => createPage({
      parent_id: chuan.id,
      title,
      slug,
      template_type: 'content',
      decorative_character: '传',
      title_image: `/assets/images/titles/generated-${slug}.png`,
      background_image: 'chuan',
      content: `<p>${title}财富传承服务介绍，正式资料可在管理后台更新。</p>`,
      sort_order: index,
    }));
    const ruyiProducts = createPage({
      parent_id: chuan.id,
      title: '如意人生理财产品',
      slug: 'ruyi-life-products',
      template_type: 'card-list',
      decorative_character: '传',
      title_image: '/assets/images/titles/chuan-finance-products.png',
      background_image: 'chuan',
      sort_order: 4,
    });

    createCard({ page_id: hui.id, title: '中华人民共和国人力资源和社会保障部', image_path: '/assets/images/cards/hui-01-ministry.png', image_alt: '中华人民共和国人力资源和社会保障部', target_page_id: ministry.id });
    createCard({ page_id: hui.id, title: '“如意人生”全面金融解决方案', image_path: '/assets/images/cards/hui-02-finance-solution.png', image_alt: '如意人生全面金融解决方案', target_page_id: ruyiProducts.id });
    createCard({ page_id: hui.id, title: '“如意人生”养老计划', image_path: '/assets/images/cards/hui-03-retirement-plan.png', image_alt: '如意人生养老计划', target_page_id: retirementClass.id });
    createCard({ page_id: hui.id, title: '政策查询及养老课堂', image_path: '/assets/images/cards/hui-04-policy-classroom.png', image_alt: '政策查询及养老课堂', target_page_id: retirementClass.id });
    createCard({ page_id: ministry.id, title: '国家养老政策', image_path: '/assets/images/cards/hui-ministry-banner.png', image_alt: '人力资源和社会保障部', target_page_id: nationalPolicies.id });
    Array.from({ length: 6 }, (_, index) => index + 1).forEach((number) => createCard({
      page_id: retirementClass.id,
      title: number === 1 ? '一图了解个人养老金' : `养老课堂示例 ${number}`,
      image_path: `/assets/images/classroom/classroom-0${number}.png`,
      image_alt: '个人养老金知识课堂海报',
      target_page_id: pensionLesson.id,
    }));

    healthPartners.forEach((page, index) => createCard({ page_id: yi.id, title: page.title, image_path: `/assets/images/cards/yi-0${index + 1}-${['sinopharm', 'health-100', 'jianzhijia'][index]}.png`, image_alt: page.title, target_page_id: page.id }));
    livingPartners.forEach((page, index) => createCard({ page_id: yang.id, title: page.title, image_path: `/assets/images/cards/yang-0${index + 1}-${['langhe', 'changhu', 'shengai'][index]}.png`, image_alt: page.title, target_page_id: page.id }));
    culturePartners.forEach((page, index) => createCard({ page_id: le.id, title: page.title, image_path: `/assets/images/cards/le-0${index + 1}-${['xdf', 'xinhua', 'shengai'][index]}.png`, image_alt: page.title, target_page_id: page.id }));
    legacyPartners.forEach((page, index) => createCard({ page_id: chuan.id, title: page.title, image_path: `/assets/images/cards/chuan-0${index + 1}-${['mingxin', 'wuhua', 'law-firm', 'picc'][index]}.png`, image_alt: page.title, target_page_id: page.id }));
    createCard({ page_id: chuan.id, title: '如意人生理财产品', image_path: '/assets/images/cards/chuan-05-finance-products.png', image_alt: '如意人生理财产品', target_page_id: ruyiProducts.id });

    [
      ['中共中央办公厅 国务院办公厅关于加快建立长期护理保险制度的意见', 'https://www.gov.cn/zhengce/'],
      ['人力资源社会保障部 财政部关于进一步做好企业年金工作的意见', 'https://www.mohrss.gov.cn/xxgk2020/'],
      ['国务院办公厅关于发展银发经济增进老年人福祉的意见', 'https://www.gov.cn/zhengce/content/'],
      ['国家养老服务政策查询入口', 'https://www.gov.cn/fuwu/'],
    ].forEach(([title, externalUrl]) => createCard({
      page_id: nationalPolicies.id,
      item_type: 'text_link',
      title,
      external_url: externalUrl,
    }));

    [
      ['工银理财·如意人生稳健系列', 'https://www.icbc.com.cn/'],
      ['工银理财·如意人生固收增强系列', 'https://www.icbc.com.cn/'],
      ['工银理财·如意人生养老规划系列', 'https://www.icbc.com.cn/'],
    ].forEach(([title, externalUrl], index) => createCard({
      page_id: ruyiProducts.id,
      title,
      image_path: `/assets/images/products/finance-0${index + 1}.png`,
      image_alt: title,
      external_url: externalUrl,
    }));

    return {
      seeded: true,
      pageCount: service.countPages(),
      cardCount: service.countCards(),
      homePageId: home.id,
      homeUrl: home.url,
      fourthLevelExampleUrl: nationalPolicies.url,
    };
  });
  return seed();
}

module.exports = {
  ContentService,
  createContentService,
  getContentService: createContentService,
  parseExtraConfig,
  seedExampleData,
};
