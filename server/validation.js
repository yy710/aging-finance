'use strict';

const path = require('node:path');

const TEMPLATE_TYPES = Object.freeze(['home', 'card-list', 'content', 'link-list']);
const PAGE_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const CARD_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const CARD_ITEM_TYPES = Object.freeze(['image_card', 'text_link']);
const ALLOWED_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

class ContentError extends Error {
  constructor(message, { code = 'CONTENT_ERROR', statusCode = 500, details } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

class ValidationError extends ContentError {
  constructor(message, code = 'VALIDATION_ERROR', details) {
    super(message, { code, statusCode: 400, details });
  }
}

class NotFoundError extends ContentError {
  constructor(message, code = 'NOT_FOUND', details) {
    super(message, { code, statusCode: 404, details });
  }
}

class ConflictError extends ContentError {
  constructor(message, code = 'CONFLICT', details) {
    super(message, { code, statusCode: 409, details });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, field, { maxLength = 255, trim = true } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} 必须是字符串`, 'INVALID_STRING', { field });
  }

  const normalized = trim ? value.trim() : value;
  if (!normalized) {
    throw new ValidationError(`${field} 不能为空`, 'REQUIRED_FIELD', { field });
  }
  if (normalized.length > maxLength) {
    throw new ValidationError(`${field} 不能超过 ${maxLength} 个字符`, 'STRING_TOO_LONG', {
      field,
      maxLength,
    });
  }
  if (normalized.includes('\0')) {
    throw new ValidationError(`${field} 包含非法字符`, 'INVALID_STRING', { field });
  }
  return normalized;
}

function optionalString(value, field, { maxLength = 4096, trim = true } = {}) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} 必须是字符串`, 'INVALID_STRING', { field });
  }

  const normalized = trim ? value.trim() : value;
  if (normalized.length > maxLength) {
    throw new ValidationError(`${field} 不能超过 ${maxLength} 个字符`, 'STRING_TOO_LONG', {
      field,
      maxLength,
    });
  }
  if (normalized.includes('\0')) {
    throw new ValidationError(`${field} 包含非法字符`, 'INVALID_STRING', { field });
  }
  return normalized;
}

function positiveId(value, field = 'id') {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new ValidationError(`${field} 必须是正整数`, 'INVALID_ID', { field });
  }
  return normalized;
}

function nullableId(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return positiveId(value, field);
}

function integer(value, field, { min = -2_147_483_648, max = 2_147_483_647 } = {}) {
  const normalized = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < min || normalized > max) {
    throw new ValidationError(`${field} 必须是 ${min} 到 ${max} 之间的整数`, 'INVALID_INTEGER', {
      field,
      min,
      max,
    });
  }
  return normalized;
}

function enumValue(value, field, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError(`${field} 必须是以下值之一：${allowed.join(', ')}`, 'INVALID_ENUM', {
      field,
      allowed,
    });
  }
  return value;
}

function validateTemplateType(value) {
  return enumValue(value, 'template_type', TEMPLATE_TYPES);
}

function validatePageStatus(value) {
  return enumValue(value, 'status', PAGE_STATUSES);
}

function validateCardStatus(value) {
  return enumValue(value, 'status', CARD_STATUSES);
}

function validateCardItemType(value) {
  return enumValue(value, 'item_type', CARD_ITEM_TYPES);
}

function validateSlug(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError('slug 必须是字符串', 'INVALID_SLUG');
  }

  const slug = value.trim().toLowerCase();
  if (!slug && allowEmpty) {
    return '';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ValidationError(
      'slug 只能包含小写英文字母、数字和单个连字符，且不能以连字符开头或结尾',
      'INVALID_SLUG',
    );
  }
  return slug;
}

function safeExternalUrl(value, { allowEmpty = true } = {}) {
  const raw = optionalString(value, 'external_url', { maxLength: 2048 });
  if (!raw && allowEmpty) {
    return '';
  }
  if (!raw) {
    throw new ValidationError('external_url 不能为空', 'INVALID_EXTERNAL_URL');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError('external_url 必须是完整的 http 或 https 地址', 'INVALID_EXTERNAL_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new ValidationError('external_url 只允许 http 或 https 协议', 'UNSAFE_EXTERNAL_URL');
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError('external_url 不允许包含用户名或密码', 'UNSAFE_EXTERNAL_URL');
  }
  return parsed.toString();
}

function normalizeExtraConfig(value) {
  if (value === undefined || value === null || value === '') {
    return '{}';
  }

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ValidationError('extra_config 必须是有效的 JSON 对象', 'INVALID_JSON', {
        field: 'extra_config',
      });
    }
  }

  if (!isPlainObject(parsed)) {
    throw new ValidationError('extra_config 必须是 JSON 对象', 'INVALID_JSON', {
      field: 'extra_config',
    });
  }

  const serialized = JSON.stringify(parsed);
  if (serialized.length > 100_000) {
    throw new ValidationError('extra_config 不能超过 100KB', 'JSON_TOO_LARGE', {
      field: 'extra_config',
    });
  }
  return serialized;
}

function validatePageRecord(input) {
  if (!isPlainObject(input)) {
    throw new ValidationError('页面数据必须是对象', 'INVALID_PAGE');
  }

  const templateType = validateTemplateType(input.template_type);
  const parentId = nullableId(input.parent_id, 'parent_id');
  const slug = validateSlug(input.slug, { allowEmpty: templateType === 'home' });

  if (templateType === 'home' && (parentId !== null || slug !== '')) {
    throw new ValidationError('home 模板页面必须是根页面且 slug 为空', 'INVALID_HOME_PAGE');
  }
  if (templateType !== 'home' && parentId === null) {
    throw new ValidationError('非首页页面必须设置父页面', 'PAGE_PARENT_REQUIRED', {
      field: 'parent_id',
    });
  }
  if (templateType !== 'home' && !slug) {
    throw new ValidationError('非首页页面必须设置 slug', 'INVALID_SLUG');
  }

  const titleImage = optionalString(input.title_image, 'title_image', { maxLength: 2048 });
  const status = validatePageStatus(input.status);
  if (templateType === 'home' && status !== 'published') {
    throw new ValidationError('网站首页必须保持发布状态', 'HOME_MUST_BE_PUBLISHED', {
      field: 'status',
    });
  }
  if (status === 'published' && !titleImage) {
    throw new ValidationError('发布页面必须设置预渲染标题图片', 'PAGE_TITLE_IMAGE_REQUIRED', {
      field: 'title_image',
    });
  }

  return {
    parent_id: parentId,
    title: requiredString(input.title, 'title', { maxLength: 200 }),
    slug,
    template_type: templateType,
    decorative_character: optionalString(input.decorative_character, 'decorative_character', {
      maxLength: 16,
    }),
    title_image: titleImage,
    background_image: optionalString(input.background_image, 'background_image', {
      maxLength: 2048,
    }),
    content: optionalString(input.content, 'content', { maxLength: 1_000_000, trim: false }),
    sort_order: integer(input.sort_order, 'sort_order'),
    status,
  };
}

function validateCardRecord(input) {
  if (!isPlainObject(input)) {
    throw new ValidationError('Card 数据必须是对象', 'INVALID_CARD');
  }

  const itemType = validateCardItemType(input.item_type);
  const imagePath = optionalString(input.image_path, 'image_path', { maxLength: 2048 });
  const targetPageId = nullableId(input.target_page_id, 'target_page_id');
  const externalUrl = safeExternalUrl(input.external_url);
  const status = validateCardStatus(input.status);
  if (status === 'published' && itemType === 'image_card' && !imagePath) {
    throw new ValidationError('发布的图文 Card 必须设置包含文字的图片', 'CARD_IMAGE_REQUIRED', {
      field: 'image_path',
    });
  }
  if (status === 'published' && targetPageId === null && !externalUrl) {
    throw new ValidationError('发布的 Card 必须设置内部目标页面或安全外链', 'CARD_TARGET_REQUIRED', {
      field: 'target_page_id',
    });
  }

  return {
    page_id: positiveId(input.page_id, 'page_id'),
    item_type: itemType,
    title: requiredString(input.title, 'title', { maxLength: 300 }),
    description: optionalString(input.description, 'description', { maxLength: 4000 }),
    image_path: imagePath,
    image_alt: optionalString(input.image_alt, 'image_alt', { maxLength: 500 }),
    target_page_id: targetPageId,
    external_url: externalUrl,
    sort_order: integer(input.sort_order, 'sort_order'),
    status,
  };
}

function validateSiteSettingsRecord(input) {
  if (!isPlainObject(input)) {
    throw new ValidationError('网站设置必须是对象', 'INVALID_SITE_SETTINGS');
  }

  return {
    site_name: requiredString(input.site_name, 'site_name', { maxLength: 200 }),
    logo_path: optionalString(input.logo_path, 'logo_path', { maxLength: 2048 }),
    home_title: requiredString(input.home_title, 'home_title', { maxLength: 300 }),
    home_subtitle: optionalString(input.home_subtitle, 'home_subtitle', { maxLength: 500 }),
    copyright_text: optionalString(input.copyright_text, 'copyright_text', { maxLength: 1000 }),
    default_background: optionalString(input.default_background, 'default_background', {
      maxLength: 2048,
    }),
    extra_config: normalizeExtraConfig(input.extra_config),
  };
}

function validateMediaRecord(input) {
  if (!isPlainObject(input)) {
    throw new ValidationError('媒体数据必须是对象', 'INVALID_MEDIA');
  }

  const originalName = requiredString(input.original_name, 'original_name', { maxLength: 255 });
  const storedName = requiredString(input.stored_name, 'stored_name', { maxLength: 255 });
  const relativePath = requiredString(input.relative_path, 'relative_path', { maxLength: 2048 });
  const mimeType = enumValue(input.mime_type, 'mime_type', ALLOWED_MEDIA_TYPES);
  const contentHash = requiredString(input.content_hash, 'content_hash', { maxLength: 64 }).toLowerCase();

  if (path.basename(originalName) !== originalName || /[\\/]/.test(originalName)) {
    throw new ValidationError('original_name 不能包含路径', 'UNSAFE_FILENAME', {
      field: 'original_name',
    });
  }
  if (path.basename(storedName) !== storedName || !/^[a-zA-Z0-9._-]+$/.test(storedName)) {
    throw new ValidationError('stored_name 只能是安全的文件名', 'UNSAFE_FILENAME', {
      field: 'stored_name',
    });
  }
  if (
    !relativePath.startsWith('/uploads/') ||
    relativePath.startsWith('//') ||
    relativePath.split(/[\\/]+/).includes('..') ||
    relativePath.includes('\\')
  ) {
    throw new ValidationError('relative_path 必须是 /uploads/ 下的安全公开路径', 'UNSAFE_PATH', {
      field: 'relative_path',
    });
  }
  if (relativePath !== `/uploads/${storedName}`) {
    throw new ValidationError('relative_path 必须与 stored_name 指向同一个上传文件', 'UNSAFE_PATH', {
      field: 'relative_path',
    });
  }
  const extension = path.extname(storedName).toLowerCase();
  const validExtension =
    (mimeType === 'image/png' && extension === '.png') ||
    (mimeType === 'image/jpeg' && ['.jpg', '.jpeg'].includes(extension)) ||
    (mimeType === 'image/webp' && extension === '.webp');
  if (!validExtension) {
    throw new ValidationError('stored_name 扩展名与 mime_type 不一致', 'MEDIA_TYPE_MISMATCH');
  }
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new ValidationError('content_hash 必须是完整的 SHA-256 十六进制摘要', 'INVALID_HASH');
  }

  return {
    original_name: originalName,
    stored_name: storedName,
    relative_path: relativePath,
    mime_type: mimeType,
    file_size: integer(input.file_size, 'file_size', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    content_hash: contentHash,
  };
}

module.exports = {
  ALLOWED_MEDIA_TYPES,
  CARD_ITEM_TYPES,
  CARD_STATUSES,
  PAGE_STATUSES,
  TEMPLATE_TYPES,
  ConflictError,
  ContentError,
  NotFoundError,
  ValidationError,
  integer,
  isPlainObject,
  nullableId,
  normalizeExtraConfig,
  optionalString,
  positiveId,
  requiredString,
  safeExternalUrl,
  validateCardItemType,
  validateCardRecord,
  validateCardStatus,
  validateMediaRecord,
  validatePageRecord,
  validatePageStatus,
  validateSiteSettingsRecord,
  validateSlug,
  validateTemplateType,
};
