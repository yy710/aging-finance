const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { HASH_LENGTH, hashBuffer } = require('./assets');
const {
  createUpload,
  replaceStoredImage,
  replaceStoredMobilePageImage,
  storeNewImage,
  storeNewMobilePageImage,
} = require('./media');
const { createPublicUrl, splitReference } = require('./public-url');
const { sanitizeContent } = require('./sanitize');

const LIBRARY_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function collectImageFiles(directory, urlPrefix, relativeDirectory = '') {
  const currentDirectory = path.join(directory, relativeDirectory);
  if (!fs.existsSync(currentDirectory)) return [];

  const images = [];
  for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      images.push(...collectImageFiles(directory, urlPrefix, relativePath));
      continue;
    }
    if (!entry.isFile() || !LIBRARY_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    images.push({
      relative_path: `${urlPrefix}/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`,
      original_name: entry.name,
      replaceable: false,
      content_hash: hashBuffer(fs.readFileSync(path.join(currentDirectory, entry.name))),
    });
  }
  return images;
}

function versionedPublicUrl(publicUrl, reference, contentHash) {
  const version = String(contentHash || '').trim().slice(0, HASH_LENGTH);
  if (!/^[a-f0-9]{8,12}$/iu.test(version)) return publicUrl(reference);
  const { pathname, query, fragment } = splitReference(reference);
  const parameters = new URLSearchParams(query.replace(/^\?/u, ''));
  parameters.set('v', version);
  return publicUrl(`${pathname}?${parameters}${fragment}`);
}

function createVersionedFileUrl(config, publicUrl) {
  const roots = [
    ['/assets/', path.resolve(config.assetsDir)],
    ['/uploads/', path.resolve(config.uploadsDir)],
  ];
  const cache = new Map();

  return function versionedFileUrl(reference, knownHash = '') {
    if (!reference) return '';
    if (knownHash) return versionedPublicUrl(publicUrl, reference, knownHash);

    const { pathname } = splitReference(reference);
    const root = roots.find(([prefix]) => pathname.startsWith(prefix));
    if (!root) return publicUrl(reference);
    const [prefix, directory] = root;
    let segments;
    try {
      segments = pathname.slice(prefix.length).split('/').map(decodeURIComponent);
    } catch {
      return publicUrl(reference);
    }
    if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      return publicUrl(reference);
    }

    const filePath = path.resolve(directory, ...segments);
    if (!filePath.startsWith(`${directory}${path.sep}`)) return publicUrl(reference);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return publicUrl(reference);
      const cached = cache.get(filePath);
      const contentHash = cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
        ? cached.contentHash
        : hashBuffer(fs.readFileSync(filePath));
      cache.set(filePath, { contentHash, mtimeMs: stat.mtimeMs, size: stat.size });
      return versionedPublicUrl(publicUrl, reference, contentHash);
    } catch {
      return publicUrl(reference);
    }
  };
}

function listImageLibrary(config, uploadedMedia, publicUrl = (value) => value) {
  const uploadedImages = uploadedMedia.map((media) => ({ ...media, replaceable: true }));
  const publicImages = collectImageFiles(config.assetsDir, '/assets');
  return [...uploadedImages, ...publicImages]
    .map((image) => ({
      ...image,
      public_url: versionedPublicUrl(publicUrl, image.relative_path, image.content_hash),
    }))
    .sort((a, b) => String(a.original_name).localeCompare(String(b.original_name), 'zh-CN'));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function publicationDetails(result) {
  return {
    ok: true,
    status: 'published',
    pageCount: result?.pageCount,
    cardCount: result?.cardCount,
    assetCount: result?.assetCount,
    publicBasePath: result?.publicBasePath || '',
    urls: result?.urls,
    cleanupWarning: result?.cleanupWarning || null,
  };
}

function markPublicationFailure(error, { key, value, message }) {
  const causeCode = error.code || 'INTERNAL_ERROR';
  error.statusCode = 500;
  error.publicMessage = message;
  error.saved = true;
  error.savedKey = key || 'result';
  error.savedValue = value;
  error.code = 'PUBLICATION_FAILED';
  error.publication = {
    ok: false,
    status: 'failed',
    causeCode,
  };
  return error;
}

function createApiRouter({ config, service, generate }) {
  if (!config || !service || typeof generate !== 'function') {
    throw new TypeError('createApiRouter requires config, service, and generate');
  }
  const router = express.Router();
  const upload = createUpload(config);
  const publicUrl = createPublicUrl(config.publicBasePath);
  const publicImageUrl = createVersionedFileUrl(config, publicUrl);
  const presentPage = (page) => page && ({
    ...page,
    url: publicUrl(page.url),
    previous_url: page.previous_url ? publicUrl(page.previous_url) : page.previous_url,
    title_image_url: page.title_image ? publicImageUrl(page.title_image) : '',
    background_image_url: String(page.background_image || '').startsWith('/')
      ? publicImageUrl(page.background_image)
      : '',
  });
  const presentPageTree = (node) => node && ({
    ...presentPage(node),
    children: Array.isArray(node.children) ? node.children.map(presentPageTree) : node.children,
  });
  const presentCard = (card) => card && ({
    ...card,
    image_url: card.image_path ? publicImageUrl(card.image_path) : '',
    resolved_url: card.resolved_url && !card.is_external
      ? publicUrl(card.resolved_url)
      : card.resolved_url,
  });
  const presentMedia = (media) => media && ({
    ...media,
    public_url: publicImageUrl(media.relative_path, media.content_hash),
  });
  const presentSettings = (settings) => settings && ({
    ...settings,
    logo_url: settings.logo_path ? publicImageUrl(settings.logo_path) : '',
    public_base_path: config.publicBasePath || '',
  });

  router.use(express.json({ limit: '1mb' }));

  async function mutateAndPublish(res, operation, { status = 200, key, present = (value) => value } = {}) {
    const value = present(operation());
    try {
      const publication = await generate();
      const body = key ? { [key]: value } : { result: value };
      return res.status(status).json({ ...body, publication: publicationDetails(publication) });
    } catch (error) {
      throw markPublicationFailure(error, {
        key,
        value,
        message: '内容已保存到数据库，但静态网站生成失败；当前已发布版本未受影响。',
      });
    }
  }

  router.get('/settings', (_req, res) => {
    res.json({ settings: presentSettings(service.getSiteSettings()) });
  });

  router.put('/settings', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.updateSiteSettings(req.body), {
      key: 'settings', present: presentSettings,
    });
  }));

  router.get('/pages', (_req, res) => {
    res.json({ pages: service.listPages().map(presentPage) });
  });

  router.get('/pages/tree', (_req, res) => {
    res.json({ tree: service.getPageTree().map(presentPageTree) });
  });

  router.get('/pages/:id', (req, res) => {
    res.json({ page: presentPage(service.getPage(req.params.id)) });
  });

  router.post('/pages', asyncRoute(async (req, res) => {
    const payload = {
      ...req.body,
      content: sanitizeContent(req.body?.content),
    };
    return mutateAndPublish(res, () => service.createPage(payload), {
      status: 201, key: 'page', present: presentPage,
    });
  }));

  router.put('/pages/:id', asyncRoute(async (req, res) => {
    const payload = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
      payload.content = sanitizeContent(payload.content);
    }
    return mutateAndPublish(res, () => service.updatePage(req.params.id, payload), {
      key: 'page', present: presentPage,
    });
  }));

  router.delete('/pages/:id', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.deletePage(req.params.id), {
      key: 'page', present: presentPage,
    });
  }));

  router.get('/pages/:id/cards', (req, res) => {
    res.json({ cards: service.listCards(req.params.id).map(presentCard) });
  });

  router.get('/cards/:id', (req, res) => {
    res.json({ card: presentCard(service.getCard(req.params.id)) });
  });

  router.post('/cards', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.createCard(req.body), {
      status: 201, key: 'card', present: presentCard,
    });
  }));

  router.put('/cards/:id', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.updateCard(req.params.id, req.body), {
      key: 'card', present: presentCard,
    });
  }));

  router.delete('/cards/:id', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.deleteCard(req.params.id), {
      key: 'card', present: presentCard,
    });
  }));

  router.post('/cards/:id/move', asyncRoute(async (req, res) => {
    return mutateAndPublish(
      res,
      () => service.moveCard(req.params.id, req.body?.direction),
      { key: 'card', present: presentCard },
    );
  }));

  router.get('/media', (_req, res) => {
    const media = service.listMedia();
    res.json({
      media: media.map(presentMedia),
      images: listImageLibrary(config, media, publicUrl),
    });
  });

  router.post('/media', upload.single('image'), asyncRoute(async (req, res) => {
    const stored = storeNewImage(req.file, config.uploadsDir);
    let media;
    try {
      media = service.createMedia({
        original_name: stored.original_name,
        stored_name: stored.stored_name,
        relative_path: stored.relative_path,
        mime_type: stored.mime_type,
        file_size: stored.file_size,
        content_hash: stored.content_hash,
      });
    } catch (error) {
      try { fs.unlinkSync(stored.absolutePath); } catch {}
      throw error;
    }
    try {
      const publication = await generate();
      return res.status(201).json({
        media: presentMedia(media),
        publication: publicationDetails(publication),
      });
    } catch (error) {
      throw markPublicationFailure(error, {
        key: 'media',
        value: presentMedia(media),
        message: '图片已安全保存，但静态网站生成失败；当前已发布版本未受影响。',
      });
    }
  }));

  router.post('/media/mobile-page', upload.single('image'), asyncRoute(async (req, res) => {
    const stored = await storeNewMobilePageImage(req.file, config.uploadsDir);
    let media;
    try {
      media = service.createMedia({
        original_name: stored.original_name,
        stored_name: stored.stored_name,
        relative_path: stored.relative_path,
        mime_type: stored.mime_type,
        file_size: stored.file_size,
        content_hash: stored.content_hash,
      });
    } catch (error) {
      try { fs.unlinkSync(stored.absolutePath); } catch {}
      throw error;
    }
    try {
      const publication = await generate();
      return res.status(201).json({
        media: presentMedia(media),
        publication: publicationDetails(publication),
      });
    } catch (error) {
      throw markPublicationFailure(error, {
        key: 'media',
        value: presentMedia(media),
        message: '手机页面图片已转换为 PNG 并安全保存，但静态网站生成失败；当前已发布版本未受影响。',
      });
    }
  }));

  router.post('/media/:id/replace', upload.single('image'), asyncRoute(async (req, res) => {
    const current = service.getMedia(req.params.id);
    const absolutePath = path.join(config.uploadsDir, path.basename(current.stored_name));
    const previousBuffer = fs.readFileSync(absolutePath);
    const usedByMobilePage = service.listPages().some(
      (page) => page.template_type === 'image-only' && page.title_image === current.relative_path,
    );
    const replaced = usedByMobilePage
      ? await replaceStoredMobilePageImage(req.file, config.uploadsDir, current)
      : replaceStoredImage(req.file, config.uploadsDir, current);
    let media;
    try {
      media = service.updateMedia(current.id, {
        original_name: replaced.original_name,
        mime_type: replaced.mime_type,
        file_size: replaced.file_size,
        content_hash: replaced.content_hash,
      });
    } catch (error) {
      fs.writeFileSync(absolutePath, previousBuffer, { mode: 0o640 });
      throw error;
    }
    try {
      const publication = await generate();
      return res.json({ media: presentMedia(media), publication: publicationDetails(publication) });
    } catch (error) {
      throw markPublicationFailure(error, {
        key: 'media',
        value: presentMedia(media),
        message: '图片记录已更新，但静态网站生成失败；当前已发布版本仍在使用上一次资源快照。',
      });
    }
  }));

  router.post('/generate', asyncRoute(async (_req, res) => {
    const result = await generate();
    res.json({ ok: true, ...publicationDetails(result) });
  }));

  return router;
}

function apiErrorHandler(error, _req, res, _next) {
  let status = Number(error.statusCode || error.status || 500);
  let message = error.publicMessage || error.message || '服务器处理请求失败。';
  if (error instanceof multer.MulterError) {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = error.code === 'LIMIT_FILE_SIZE' ? '图片超过上传大小限制。' : `上传失败：${error.message}`;
  }
  if (status >= 500 && !error.publicMessage && process.env.NODE_ENV === 'production') {
    message = '服务器处理请求失败，请查看服务日志。';
  }
  const body = {
    error: message,
    code: error.code || 'INTERNAL_ERROR',
    details: error.details || error.issues,
    saved: error.saved === true,
  };
  if (error.saved === true) {
    body.publication = error.publication || { ok: false, status: 'failed' };
    if (error.savedKey && error.savedValue !== undefined) {
      body[error.savedKey] = error.savedValue;
    }
  }
  res.status(status).json(body);
}

module.exports = {
  apiErrorHandler,
  asyncRoute,
  collectImageFiles,
  createVersionedFileUrl,
  createApiRouter,
  listImageLibrary,
  markPublicationFailure,
  publicationDetails,
  versionedPublicUrl,
};
