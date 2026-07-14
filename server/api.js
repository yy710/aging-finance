const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { createUpload, replaceStoredImage, storeNewImage } = require('./media');
const { sanitizeContent } = require('./sanitize');

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

  router.use(express.json({ limit: '1mb' }));

  async function mutateAndPublish(res, operation, { status = 200, key } = {}) {
    const value = operation();
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
    res.json({ settings: service.getSiteSettings() });
  });

  router.put('/settings', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.updateSiteSettings(req.body), { key: 'settings' });
  }));

  router.get('/pages', (_req, res) => {
    res.json({ pages: service.listPages() });
  });

  router.get('/pages/tree', (_req, res) => {
    res.json({ tree: service.getPageTree() });
  });

  router.get('/pages/:id', (req, res) => {
    res.json({ page: service.getPage(req.params.id) });
  });

  router.post('/pages', asyncRoute(async (req, res) => {
    const payload = {
      ...req.body,
      content: sanitizeContent(req.body?.content),
    };
    return mutateAndPublish(res, () => service.createPage(payload), { status: 201, key: 'page' });
  }));

  router.put('/pages/:id', asyncRoute(async (req, res) => {
    const payload = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
      payload.content = sanitizeContent(payload.content);
    }
    return mutateAndPublish(res, () => service.updatePage(req.params.id, payload), { key: 'page' });
  }));

  router.delete('/pages/:id', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.deletePage(req.params.id), { key: 'page' });
  }));

  router.get('/pages/:id/cards', (req, res) => {
    res.json({ cards: service.listCards(req.params.id) });
  });

  router.get('/cards/:id', (req, res) => {
    res.json({ card: service.getCard(req.params.id) });
  });

  router.post('/cards', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.createCard(req.body), { status: 201, key: 'card' });
  }));

  router.put('/cards/:id', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.updateCard(req.params.id, req.body), { key: 'card' });
  }));

  router.delete('/cards/:id', asyncRoute(async (req, res) => {
    return mutateAndPublish(res, () => service.deleteCard(req.params.id), { key: 'card' });
  }));

  router.post('/cards/:id/move', asyncRoute(async (req, res) => {
    return mutateAndPublish(
      res,
      () => service.moveCard(req.params.id, req.body?.direction),
      { key: 'card' },
    );
  }));

  router.get('/media', (_req, res) => {
    res.json({ media: service.listMedia() });
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
      return res.status(201).json({ media, publication: publicationDetails(publication) });
    } catch (error) {
      throw markPublicationFailure(error, {
        key: 'media',
        value: media,
        message: '图片已安全保存，但静态网站生成失败；当前已发布版本未受影响。',
      });
    }
  }));

  router.post('/media/:id/replace', upload.single('image'), asyncRoute(async (req, res) => {
    const current = service.getMedia(req.params.id);
    const absolutePath = path.join(config.uploadsDir, path.basename(current.stored_name));
    const previousBuffer = fs.readFileSync(absolutePath);
    const replaced = replaceStoredImage(req.file, config.uploadsDir, current);
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
      return res.json({ media, publication: publicationDetails(publication) });
    } catch (error) {
      throw markPublicationFailure(error, {
        key: 'media',
        value: media,
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
  createApiRouter,
  markPublicationFailure,
  publicationDetails,
};
