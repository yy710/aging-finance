'use strict';

const path = require('node:path');

const PUBLIC_STATUSES = new Set([
  '1',
  'active',
  'enabled',
  'online',
  'publish',
  'published',
  'true',
]);

const DEFAULT_TEMPLATE_TYPES = new Set([
  'home',
  'card-list',
  'content',
  'link-list',
  'image-only',
]);

const DEFAULT_CARD_TYPES = new Set(['image_card', 'text_link']);
const RESERVED_ROOT_SLUGS = new Set(['_assets', 'admin', 'api', 'assets', 'health', 'uploads']);

class SiteTreeError extends Error {
  constructor(issues) {
    const normalizedIssues = Array.isArray(issues) ? issues : [];
    const detail = normalizedIssues
      .map((item) => `${item.code}: ${item.message}`)
      .join('\n');
    super(`Static site data is invalid${detail ? `:\n${detail}` : ''}`);
    this.name = 'SiteTreeError';
    this.code = 'SITE_TREE_INVALID';
    this.issues = normalizedIssues;
  }
}

function makeIssue(code, message, details = {}) {
  return { code, message, ...details };
}

function normalizeId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function isPublished(record) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, 'status')) {
    return true;
  }

  const { status } = record;
  if (typeof status === 'boolean') {
    return status;
  }
  if (typeof status === 'number') {
    return status === 1;
  }
  return PUBLIC_STATUSES.has(String(status).trim().toLowerCase());
}

function compareRecords(left, right) {
  const leftOrder = Number.isFinite(Number(left.sort_order))
    ? Number(left.sort_order)
    : 0;
  const rightOrder = Number.isFinite(Number(right.sort_order))
    ? Number(right.sort_order)
    : 0;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left.id).localeCompare(String(right.id), 'en', {
    numeric: true,
  });
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/%2F/gi, '/');
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    return 'slug is required';
  }
  if (slug !== slug.trim()) {
    return 'slug cannot have leading or trailing whitespace';
  }
  if (/\s/u.test(slug)) {
    return 'slug cannot contain whitespace';
  }
  if (slug === '.' || slug === '..') {
    return 'slug cannot be a dot path segment';
  }
  if (/[\\/?#%\u0000-\u001f\u007f]/u.test(slug)) {
    return 'slug contains an unsafe URL or filesystem character';
  }
  return null;
}

function validateExternalUrl(value, allowedProtocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return allowedProtocols.has(parsed.protocol.toLowerCase());
}

function detectParentCycles(pagesById, issues) {
  const state = new Map();
  const stack = [];

  function visit(page) {
    const pageState = state.get(page._id) || 0;
    if (pageState === 2) {
      return;
    }
    if (pageState === 1) {
      const start = stack.findIndex((item) => item._id === page._id);
      const cycle = [...stack.slice(start), page].map((item) => item.id);
      issues.push(
        makeIssue(
          'PAGE_PARENT_CYCLE',
          `Page parent cycle detected: ${cycle.join(' -> ')}`,
          { pageIds: cycle },
        ),
      );
      return;
    }

    state.set(page._id, 1);
    stack.push(page);
    if (page._parentId !== null) {
      const parent = pagesById.get(page._parentId);
      if (parent) {
        visit(parent);
      }
    }
    stack.pop();
    state.set(page._id, 2);
  }

  for (const page of pagesById.values()) {
    visit(page);
  }
}

function buildSiteTree(rawPages, rawCards = [], options = {}) {
  if (!Array.isArray(rawPages)) {
    throw new TypeError('buildSiteTree pages must be an array');
  }
  if (!Array.isArray(rawCards)) {
    throw new TypeError('buildSiteTree cards must be an array');
  }

  const issues = [];
  const templateTypes = new Set(
    options.templateTypes || DEFAULT_TEMPLATE_TYPES,
  );
  const cardTypes = new Set(options.cardTypes || DEFAULT_CARD_TYPES);
  const allowedProtocols = new Set(
    (options.allowedExternalProtocols || ['http:', 'https:']).map((item) =>
      String(item).toLowerCase(),
    ),
  );
  const requireCardTargets = options.requireCardTargets !== false;

  const pages = rawPages.filter(isPublished).map((page) => ({
    ...page,
    _id: normalizeId(page.id),
    _parentId: normalizeId(page.parent_id),
  }));
  const pagesById = new Map();

  for (const page of pages) {
    if (page._id === null) {
      issues.push(
        makeIssue('PAGE_ID_REQUIRED', 'A published page has no id', {
          page,
        }),
      );
      continue;
    }
    if (pagesById.has(page._id)) {
      issues.push(
        makeIssue(
          'DUPLICATE_PAGE_ID',
          `Published page id ${page.id} appears more than once`,
          { pageId: page.id },
        ),
      );
      continue;
    }
    pagesById.set(page._id, page);
  }

  const roots = pages.filter((page) => page._parentId === null);
  if (roots.length !== 1) {
    issues.push(
      makeIssue(
        'ROOT_PAGE_COUNT',
        `Exactly one published root page is required; found ${roots.length}`,
        { rootPageIds: roots.map((page) => page.id) },
      ),
    );
  }
  const rootPage = roots[0] || null;

  if (rootPage && rootPage.template_type !== 'home') {
    issues.push(
      makeIssue(
        'ROOT_TEMPLATE_INVALID',
        `Root page ${rootPage.id} must use the home template`,
        { pageId: rootPage.id, templateType: rootPage.template_type },
      ),
    );
  }

  const siblingSlugs = new Map();
  for (const page of pages) {
    if (!templateTypes.has(page.template_type)) {
      issues.push(
        makeIssue(
          'PAGE_TEMPLATE_INVALID',
          `Page ${page.id} has unsupported template_type ${String(page.template_type)}`,
          { pageId: page.id, templateType: page.template_type },
        ),
      );
    }

    if (typeof page.title_image !== 'string' || !page.title_image.trim()) {
      issues.push(
        makeIssue(
          'PAGE_TITLE_IMAGE_REQUIRED',
          `Published page ${page.id} must use a pre-rendered title image`,
          { pageId: page.id },
        ),
      );
    }

    if (page._parentId !== null && !pagesById.has(page._parentId)) {
      issues.push(
        makeIssue(
          'ORPHAN_PAGE',
          `Page ${page.id} references missing or unpublished parent ${page.parent_id}`,
          { pageId: page.id, parentId: page.parent_id },
        ),
      );
    }

    if (page._parentId !== null) {
      const slugProblem = validateSlug(page.slug);
      if (slugProblem) {
        issues.push(
          makeIssue(
            'PAGE_SLUG_INVALID',
            `Page ${page.id} ${slugProblem}`,
            { pageId: page.id, slug: page.slug },
          ),
        );
      } else {
        if (
          rootPage
          && page._parentId === rootPage._id
          && RESERVED_ROOT_SLUGS.has(page.slug.toLocaleLowerCase())
        ) {
          issues.push(
            makeIssue(
              'RESERVED_ROOT_SLUG',
              `Top-level page ${page.id} uses server-reserved slug ${page.slug}`,
              { pageId: page.id, slug: page.slug },
            ),
          );
        }
        const slugKey = `${page._parentId}\u0000${page.slug.toLocaleLowerCase()}`;
        const existing = siblingSlugs.get(slugKey);
        if (existing) {
          issues.push(
            makeIssue(
              'DUPLICATE_SIBLING_SLUG',
              `Pages ${existing.id} and ${page.id} have the same slug under one parent`,
              {
                pageIds: [existing.id, page.id],
                parentId: page.parent_id,
                slug: page.slug,
              },
            ),
          );
        } else {
          siblingSlugs.set(slugKey, page);
        }
      }
    }
  }

  detectParentCycles(pagesById, issues);

  if (issues.length > 0) {
    throw new SiteTreeError(issues);
  }

  const nodesById = new Map();
  for (const page of pages) {
    nodesById.set(page._id, {
      ...page,
      parent: null,
      children: [],
      cards: [],
      depth: 0,
      segments: [],
      url: null,
      outputPath: null,
    });
  }

  for (const node of nodesById.values()) {
    if (node._parentId !== null) {
      node.parent = nodesById.get(node._parentId);
      node.parent.children.push(node);
    }
  }
  for (const node of nodesById.values()) {
    node.children.sort(compareRecords);
  }

  const root = nodesById.get(rootPage._id);
  const pageList = [];
  const paths = new Map();

  function assignPaths(node, parentSegments = []) {
    node.segments = node.parent
      ? [...parentSegments, node.slug]
      : [];
    node.depth = node.segments.length;
    node.url = node.segments.length
      ? `/${node.segments.map(encodePathSegment).join('/')}/`
      : '/';
    node.outputPath = node.segments.length
      ? path.posix.join(...node.segments, 'index.html')
      : 'index.html';

    const pathKey = node.url.toLocaleLowerCase();
    const existing = paths.get(pathKey);
    if (existing) {
      issues.push(
        makeIssue(
          'DUPLICATE_PAGE_PATH',
          `Pages ${existing.id} and ${node.id} resolve to ${node.url}`,
          { pageIds: [existing.id, node.id], url: node.url },
        ),
      );
    } else {
      paths.set(pathKey, node);
    }
    pageList.push(node);

    for (const child of node.children) {
      assignPaths(child, node.segments);
    }
  }

  assignPaths(root);
  if (pageList.length !== nodesById.size) {
    const visited = new Set(pageList.map((page) => page._id));
    const disconnected = [...nodesById.values()]
      .filter((page) => !visited.has(page._id))
      .map((page) => page.id);
    issues.push(
      makeIssue(
        'DISCONNECTED_PAGE',
        `Published pages are not connected to the home page: ${disconnected.join(', ')}`,
        { pageIds: disconnected },
      ),
    );
  }

  const cards = rawCards.filter(isPublished).map((card) => ({
    ...card,
    _id: normalizeId(card.id),
    _pageId: normalizeId(card.page_id),
    _targetPageId: normalizeId(card.target_page_id),
    href: null,
    isExternal: false,
    targetPage: null,
  }));
  const cardIds = new Map();

  for (const card of cards) {
    if (card._id === null) {
      issues.push(
        makeIssue('CARD_ID_REQUIRED', 'A published card has no id', { card }),
      );
    } else if (cardIds.has(card._id)) {
      issues.push(
        makeIssue(
          'DUPLICATE_CARD_ID',
          `Published card id ${card.id} appears more than once`,
          { cardId: card.id },
        ),
      );
    } else {
      cardIds.set(card._id, card);
    }

    if (!cardTypes.has(card.item_type)) {
      issues.push(
        makeIssue(
          'CARD_TYPE_INVALID',
          `Card ${card.id} has unsupported item_type ${String(card.item_type)}`,
          { cardId: card.id, itemType: card.item_type },
        ),
      );
    }

    if (
      card.item_type === 'image_card'
      && (typeof card.image_path !== 'string' || !card.image_path.trim())
    ) {
      issues.push(
        makeIssue(
          'CARD_IMAGE_REQUIRED',
          `Published image Card ${card.id} must use an image containing its visible text`,
          { cardId: card.id },
        ),
      );
    }

    const owner = card._pageId === null ? null : nodesById.get(card._pageId);
    if (!owner) {
      issues.push(
        makeIssue(
          'ORPHAN_CARD',
          `Card ${card.id} references missing or unpublished page ${card.page_id}`,
          { cardId: card.id, pageId: card.page_id },
        ),
      );
      continue;
    }

    if (card._targetPageId !== null) {
      const targetPage = nodesById.get(card._targetPageId);
      if (!targetPage) {
        issues.push(
          makeIssue(
            'INVALID_CARD_TARGET',
            `Card ${card.id} references missing or unpublished target page ${card.target_page_id}`,
            { cardId: card.id, targetPageId: card.target_page_id },
          ),
        );
      } else {
        card.targetPage = targetPage;
        card.href = targetPage.url;
      }
    } else if (typeof card.external_url === 'string' && card.external_url.trim()) {
      const externalUrl = card.external_url.trim();
      if (!validateExternalUrl(externalUrl, allowedProtocols)) {
        issues.push(
          makeIssue(
            'UNSAFE_EXTERNAL_URL',
            `Card ${card.id} has an invalid or unsafe external URL`,
            { cardId: card.id, externalUrl },
          ),
        );
      } else {
        card.href = externalUrl;
        card.isExternal = true;
      }
    } else if (requireCardTargets) {
      issues.push(
        makeIssue(
          'CARD_TARGET_REQUIRED',
          `Card ${card.id} has neither a target page nor an external URL`,
          { cardId: card.id },
        ),
      );
    }

    owner.cards.push(card);
  }

  for (const node of nodesById.values()) {
    node.cards.sort(compareRecords);
  }

  if (issues.length > 0) {
    throw new SiteTreeError(issues);
  }

  return {
    root,
    pages: pageList,
    pagesById: nodesById,
    cards: cards.sort(compareRecords),
    cardsByPageId: new Map(
      [...nodesById.values()].map((page) => [page._id, page.cards]),
    ),
  };
}

function getPageById(tree, id) {
  if (!tree || !(tree.pagesById instanceof Map)) {
    return null;
  }
  return tree.pagesById.get(normalizeId(id)) || null;
}

module.exports = {
  DEFAULT_CARD_TYPES,
  DEFAULT_TEMPLATE_TYPES,
  SiteTreeError,
  buildSiteTree,
  getPageById,
  isPublished,
  normalizeId,
  validateExternalUrl,
  validateSlug,
};
