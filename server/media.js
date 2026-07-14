const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const IMAGE_TYPES = {
  png: { mimeType: 'image/png', extensions: new Set(['.png']) },
  jpeg: { mimeType: 'image/jpeg', extensions: new Set(['.jpg', '.jpeg']) },
  webp: { mimeType: 'image/webp', extensions: new Set(['.webp']) },
};

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return null;
}

function validateImageFile(file) {
  if (!file?.buffer) throw Object.assign(new Error('请选择要上传的图片。'), { statusCode: 400 });
  const type = detectImageType(file.buffer);
  if (!type) throw Object.assign(new Error('文件内容不是受支持的 PNG、JPEG 或 WebP 图片。'), { statusCode: 415 });
  const definition = IMAGE_TYPES[type];
  const declaredMime = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const acceptedMime = type === 'jpeg'
    ? new Set(['image/jpeg', 'image/jpg'])
    : new Set([definition.mimeType]);
  if (!acceptedMime.has(declaredMime) || !definition.extensions.has(extension)) {
    throw Object.assign(new Error('文件扩展名、MIME 类型与实际图片内容不一致。'), { statusCode: 415 });
  }
  return {
    extension: type === 'jpeg' ? '.jpg' : `.${type}`,
    mimeType: definition.mimeType,
    contentHash: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
}

function createUpload(config) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: config.uploadMaxBytes },
    fileFilter(_req, file, callback) {
      const allowed = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
      if (!allowed.has(String(file.mimetype).toLowerCase())) {
        return callback(Object.assign(new Error('只允许上传 PNG、JPEG 或 WebP 图片。'), { statusCode: 415 }));
      }
      return callback(null, true);
    },
  });
}

function safeOriginalName(value) {
  return path.basename(String(value || 'image')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
}

function writeFileAtomically(targetPath, buffer) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, buffer, { flag: 'wx', mode: 0o640 });
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function storeNewImage(file, uploadsDir) {
  const metadata = validateImageFile(file);
  const storedName = `${crypto.randomUUID()}${metadata.extension}`;
  const targetPath = path.join(uploadsDir, storedName);
  writeFileAtomically(targetPath, file.buffer);
  return {
    original_name: safeOriginalName(file.originalname),
    stored_name: storedName,
    relative_path: `/uploads/${storedName}`,
    mime_type: metadata.mimeType,
    file_size: file.buffer.length,
    content_hash: metadata.contentHash,
    absolutePath: targetPath,
  };
}

function replaceStoredImage(file, uploadsDir, media) {
  const metadata = validateImageFile(file);
  const currentName = path.basename(String(media.stored_name || ''));
  if (!currentName || currentName !== media.stored_name) {
    throw Object.assign(new Error('媒体记录中的文件路径无效。'), { statusCode: 400 });
  }
  const currentExtension = path.extname(currentName).toLowerCase();
  if (currentExtension !== metadata.extension) {
    throw Object.assign(new Error('替换图片必须与原文件使用相同格式，以保持静态 URL 不变。'), { statusCode: 400 });
  }
  const targetPath = path.resolve(uploadsDir, currentName);
  const uploadsRoot = `${path.resolve(uploadsDir)}${path.sep}`;
  if (!targetPath.startsWith(uploadsRoot)) {
    throw Object.assign(new Error('媒体文件路径越界。'), { statusCode: 400 });
  }
  writeFileAtomically(targetPath, file.buffer);
  return {
    ...media,
    original_name: safeOriginalName(file.originalname),
    mime_type: metadata.mimeType,
    file_size: file.buffer.length,
    content_hash: metadata.contentHash,
    absolutePath: targetPath,
  };
}

module.exports = {
  createUpload,
  detectImageType,
  replaceStoredImage,
  storeNewImage,
  validateImageFile,
};
