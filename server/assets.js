'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  createPublicUrl,
  normalizePublicBasePath,
  stripPublicBasePath,
} = require('./public-url');

const HASH_LENGTH = 10;
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/giu;

class AssetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
    Object.assign(this, details);
  }
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function splitUrlReference(value) {
  const input = String(value);
  const hashIndex = input.indexOf('#');
  const fragment = hashIndex >= 0 ? input.slice(hashIndex) : '';
  const withoutFragment = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const queryIndex = withoutFragment.indexOf('?');
  return {
    pathname:
      queryIndex >= 0
        ? withoutFragment.slice(0, queryIndex)
        : withoutFragment,
    query:
      queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : '',
    fragment,
  };
}

function decodePathname(pathname) {
  return pathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new AssetError(
          'ASSET_URL_INVALID',
          `Asset URL contains invalid percent encoding: ${pathname}`,
          { assetPath: pathname },
        );
      }
    })
    .join('/');
}

function normalizeAssetKey(value) {
  const { pathname } = splitUrlReference(value);
  if (!pathname) {
    throw new AssetError('ASSET_URL_INVALID', 'Asset path cannot be empty');
  }

  let decoded = decodePathname(pathname.replace(/\\/gu, '/'));
  if (!decoded.startsWith('/')) {
    decoded = `/${decoded}`;
  }

  if (decoded.split('/').includes('..')) {
    throw new AssetError(
      'ASSET_PATH_TRAVERSAL',
      `Unsafe asset path: ${value}`,
      { assetPath: value },
    );
  }

  const normalized = path.posix.normalize(decoded);
  if (
    normalized === '/..' ||
    normalized.startsWith('/../') ||
    normalized.includes('\u0000')
  ) {
    throw new AssetError(
      'ASSET_PATH_TRAVERSAL',
      `Unsafe asset path: ${value}`,
      { assetPath: value },
    );
  }
  return normalized;
}

function encodePublicPath(value) {
  return normalizeAssetKey(value)
    .split('/')
    .map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment)))
    .join('/');
}

function isExternalReference(value) {
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized.startsWith('//') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('http:') ||
    normalized.startsWith('https:') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('#')
  );
}

function hashBuffer(buffer, length = HASH_LENGTH) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, length);
}

async function hashFile(filePath, length = HASH_LENGTH) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex').slice(0, length);
}

function sortManifest(manifest) {
  return Object.fromEntries(
    Object.entries(manifest).sort(([left], [right]) =>
      left.localeCompare(right, 'en'),
    ),
  );
}

function createAssetHelper(manifest, options = {}) {
  const strict = options.strict !== false;
  const versionKey = options.versionKey || 'v';
  const publicUrl = options.publicUrl || createPublicUrl(options.publicBasePath || '');

  return function asset(reference) {
    if (reference === null || reference === undefined || reference === '') {
      return '';
    }

    const input = String(reference).trim();
    if (!input || isExternalReference(input)) {
      return publicUrl(input);
    }

    const parts = splitUrlReference(input);
    const key = normalizeAssetKey(parts.pathname);
    const hash = manifest[key];
    if (!hash) {
      if (strict) {
        throw new AssetError(
          'ASSET_NOT_FOUND',
          `Asset is not present in the publication manifest: ${key}`,
          { assetPath: key },
        );
      }
      return input;
    }

    const parameters = new URLSearchParams(parts.query);
    parameters.set(versionKey, hash);
    const query = parameters.toString();
    return publicUrl(`${encodePublicPath(key)}${query ? `?${query}` : ''}${parts.fragment}`);
  };
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots)) {
    throw new TypeError('Asset roots must be an array');
  }

  return roots.map((root, index) => {
    const directoryInput = root.directory || root.dir;
    if (!directoryInput) {
      throw new AssetError(
        'ASSET_DIRECTORY_REQUIRED',
        `Asset root ${index} has no source directory`,
      );
    }
    const directory = path.resolve(directoryInput);
    const prefixInput = root.urlPrefix || root.prefix;
    if (!prefixInput) {
      throw new AssetError(
        'ASSET_PREFIX_REQUIRED',
        `Asset root ${index} has no URL prefix`,
      );
    }
    const urlPrefix = normalizeAssetKey(prefixInput).replace(/\/$/u, '');
    if (urlPrefix === '/') {
      throw new AssetError(
        'ASSET_PREFIX_INVALID',
        'Asset roots cannot publish directly at /',
      );
    }
    return { directory, urlPrefix };
  });
}

async function walkFiles(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new AssetError(
        'ASSET_SYMLINK_REJECTED',
        `Symlinks are not allowed in published asset roots: ${absolutePath}`,
        { filePath: absolutePath },
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
    } else if (entry.isFile() && entry.name !== '.DS_Store') {
      files.push(absolutePath);
    }
  }
  return files;
}

async function discoverAssets(roots) {
  const normalizedRoots = normalizeRoots(roots);
  const assets = [];
  const outputUrls = new Map();

  for (const root of normalizedRoots) {
    const files = await walkFiles(root.directory);
    for (const sourcePath of files) {
      const relativePath = toPosix(path.relative(root.directory, sourcePath));
      if (
        relativePath.startsWith('../') ||
        path.isAbsolute(relativePath) ||
        relativePath.includes('\u0000')
      ) {
        throw new AssetError(
          'ASSET_PATH_TRAVERSAL',
          `Asset escaped its configured root: ${sourcePath}`,
          { filePath: sourcePath },
        );
      }

      const isCssTemplate = relativePath.toLowerCase().endsWith('.css.ejs');
      const isCss = isCssTemplate || relativePath.toLowerCase().endsWith('.css');
      const isPrivateTemplate =
        !isCssTemplate && relativePath.toLowerCase().endsWith('.ejs');
      if (isPrivateTemplate) {
        continue;
      }

      const publishedRelativePath = isCssTemplate
        ? relativePath.slice(0, -'.ejs'.length)
        : relativePath;
      const publicPath = normalizeAssetKey(
        `${root.urlPrefix}/${publishedRelativePath}`,
      );
      const existing = outputUrls.get(publicPath.toLocaleLowerCase());
      if (existing) {
        throw new AssetError(
          'DUPLICATE_ASSET_PATH',
          `Assets ${existing.sourcePath} and ${sourcePath} both publish to ${publicPath}`,
          { publicPath, sourcePaths: [existing.sourcePath, sourcePath] },
        );
      }

      const asset = {
        sourcePath,
        publicPath,
        relativePath: publishedRelativePath,
        isCss,
        isCssTemplate,
      };
      outputUrls.set(publicPath.toLocaleLowerCase(), asset);
      assets.push(asset);
    }
  }

  return assets.sort((left, right) =>
    left.publicPath.localeCompare(right.publicPath, 'en'),
  );
}

function destinationForPublicPath(stageDirectory, publicPath) {
  const relativePath = normalizeAssetKey(publicPath).replace(/^\/+/, '');
  const destination = path.resolve(stageDirectory, relativePath);
  const stagePrefix = `${path.resolve(stageDirectory)}${path.sep}`;
  if (destination !== path.resolve(stageDirectory) && !destination.startsWith(stagePrefix)) {
    throw new AssetError(
      'ASSET_PATH_TRAVERSAL',
      `Asset output escaped the staging directory: ${publicPath}`,
      { publicPath },
    );
  }
  return destination;
}

async function renderFileWithEngine(engine, filename, data) {
  if (!engine) {
    throw new AssetError(
      'EJS_ENGINE_REQUIRED',
      'An EJS-compatible engine is required to render CSS',
    );
  }

  if (typeof engine.render === 'function') {
    const source = await fsp.readFile(filename, 'utf8');
    return engine.render(source, data, { filename });
  }

  if (typeof engine.renderFile === 'function') {
    return new Promise((resolve, reject) => {
      engine.renderFile(filename, data, { filename }, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  }

  throw new AssetError(
    'EJS_ENGINE_INVALID',
    'The supplied EJS engine has neither render nor renderFile',
  );
}

function resolveCssReference(cssPublicPath, reference) {
  const parts = splitUrlReference(reference);
  const resolvedPath = parts.pathname.startsWith('/')
    ? normalizeAssetKey(parts.pathname)
    : normalizeAssetKey(
        path.posix.join(path.posix.dirname(cssPublicPath), parts.pathname),
      );
  return `${resolvedPath}${parts.query ? `?${parts.query}` : ''}${parts.fragment}`;
}

function rewriteCssAssetUrls(css, cssPublicPath, manifest, assetHelper) {
  return String(css).replace(
    CSS_URL_PATTERN,
    (whole, quote, rawReference) => {
      const reference = rawReference.trim();
      const lower = reference.toLowerCase();
      if (
        !reference ||
        isExternalReference(reference) ||
        lower.startsWith('var(') ||
        lower.startsWith('env(')
      ) {
        return whole;
      }

      const resolved = resolveCssReference(cssPublicPath, reference);
      const key = normalizeAssetKey(resolved);
      const isManagedPath =
        key === '/assets' ||
        key.startsWith('/assets/') ||
        key === '/uploads' ||
        key.startsWith('/uploads/');
      if (!Object.prototype.hasOwnProperty.call(manifest, key) && !isManagedPath) {
        return whole;
      }

      const versioned = assetHelper(resolved);
      const effectiveQuote = quote || '"';
      return `url(${effectiveQuote}${versioned}${effectiveQuote})`;
    },
  );
}

async function prepareAssets(options) {
  const {
    roots,
    stageDirectory,
    ejs,
    templateData = {},
    hashLength = HASH_LENGTH,
  } = options;
  const publicBasePath = normalizePublicBasePath(options.publicBasePath || '');

  if (!stageDirectory) {
    throw new TypeError('prepareAssets stageDirectory is required');
  }

  const discovered = await discoverAssets(roots || []);
  const manifest = {};
  const cssAssets = [];
  await fsp.mkdir(stageDirectory, { recursive: true });

  for (const item of discovered) {
    if (item.isCss) {
      cssAssets.push(item);
      continue;
    }

    const destination = destinationForPublicPath(
      stageDirectory,
      item.publicPath,
    );
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(item.sourcePath, destination);
    manifest[item.publicPath] = await hashFile(destination, hashLength);
  }

  // CSS is deliberately rendered only after images/fonts/scripts are hashed.
  // This lets both EJS asset() calls and ordinary url(...) references receive
  // the real dependency hash before the resulting CSS file itself is hashed.
  for (const item of cssAssets) {
    const dependencyAsset = createAssetHelper(manifest, {
      strict: true,
      publicBasePath,
    });
    const rendered = await renderFileWithEngine(ejs, item.sourcePath, {
      ...templateData,
      asset: dependencyAsset,
      publicUrl: dependencyAsset,
    });
    const rewritten = rewriteCssAssetUrls(
      rendered,
      item.publicPath,
      manifest,
      dependencyAsset,
    );
    assertCssPublicBasePath(rewritten, publicBasePath, item.publicPath);
    const destination = destinationForPublicPath(
      stageDirectory,
      item.publicPath,
    );
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, rewritten, 'utf8');
    manifest[item.publicPath] = await hashFile(destination, hashLength);
  }

  const sortedManifest = sortManifest(manifest);
  return {
    manifest: sortedManifest,
    asset: createAssetHelper(sortedManifest, { strict: true, publicBasePath }),
    files: discovered,
  };
}

async function writeAssetManifest(stageDirectory, manifest) {
  const destination = path.join(stageDirectory, 'asset-manifest.json');
  await fsp.writeFile(
    destination,
    `${JSON.stringify(sortManifest(manifest), null, 2)}\n`,
    'utf8',
  );
  return destination;
}

function assertPublicBasePathReference(reference, publicBasePath, context) {
  const basePath = normalizePublicBasePath(publicBasePath || '');
  if (!basePath || !reference || isExternalReference(reference)) return;
  const { pathname } = splitUrlReference(String(reference).replace(/&amp;/gu, '&'));
  if (!pathname.startsWith('/')) return;
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    throw new AssetError(
      'PUBLIC_BASE_PATH_MISSING',
      `Rendered output ${context} contains a root-relative URL without ${basePath}: ${pathname}`,
      { context, publicBasePath: basePath, reference: pathname },
    );
  }
}

function assertCssPublicBasePath(css, publicBasePath, context = 'stylesheet') {
  for (const match of String(css).matchAll(CSS_URL_PATTERN)) {
    assertPublicBasePathReference(match[2].trim(), publicBasePath, context);
  }
}

function assertVersionedReference(reference, manifest, context, options = {}) {
  if (!reference || isExternalReference(reference)) {
    return;
  }
  const publicBasePath = normalizePublicBasePath(options.publicBasePath || '');
  assertPublicBasePathReference(reference, publicBasePath, context);
  const internalReference = stripPublicBasePath(
    reference.replace(/&amp;/gu, '&'),
    publicBasePath,
  );
  const parts = splitUrlReference(internalReference);
  let key;
  try {
    key = normalizeAssetKey(parts.pathname);
  } catch {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(manifest, key)) {
    const isManagedPath = key === '/assets'
      || key.startsWith('/assets/')
      || key === '/uploads'
      || key.startsWith('/uploads/')
      || key === '/_assets'
      || key.startsWith('/_assets/');
    if (isManagedPath) {
      throw new AssetError(
        'ASSET_NOT_FOUND',
        `Rendered HTML ${context} references a missing managed asset: ${key}`,
        { assetPath: key, context },
      );
    }
    return;
  }
  const parameters = new URLSearchParams(parts.query);
  if (parameters.get('v') !== manifest[key]) {
    throw new AssetError(
      'UNVERSIONED_ASSET_REFERENCE',
      `Rendered HTML ${context} references ${key} without its current content hash`,
      { assetPath: key, context },
    );
  }
}

function rewriteHtmlAssetUrls(html, manifest, assetHelper, options = {}) {
  const publicBasePath = normalizePublicBasePath(options.publicBasePath || '');
  const publicUrl = options.publicUrl || createPublicUrl(publicBasePath);
  const helper = assetHelper || createAssetHelper(manifest, { strict: true, publicBasePath });
  const rewriteReference = (rawReference) => {
    const reference = String(rawReference || '').replace(/&amp;/giu, '&');
    if (!reference || isExternalReference(reference)) {
      return rawReference;
    }

    const internalReference = stripPublicBasePath(reference, publicBasePath);

    let key;
    try {
      key = normalizeAssetKey(splitUrlReference(internalReference).pathname);
    } catch {
      return rawReference;
    }
    const isManagedPath = key === '/assets'
      || key.startsWith('/assets/')
      || key === '/uploads'
      || key.startsWith('/uploads/')
      || key === '/_assets'
      || key.startsWith('/_assets/');
    if (Object.prototype.hasOwnProperty.call(manifest, key) || isManagedPath) {
      return helper(internalReference);
    }
    return splitUrlReference(internalReference).pathname.startsWith('/')
      ? publicUrl(internalReference)
      : rawReference;
  };
  const escapeAttribute = (value) => String(value)
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;');

  let rewritten = String(html).replace(
    /(\b(?:href|poster|src)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu,
    (whole, prefix, doubleQuoted, singleQuoted, bare) => {
      const original = doubleQuoted ?? singleQuoted ?? bare ?? '';
      const versioned = rewriteReference(original);
      if (versioned === original) {
        return whole;
      }
      return `${prefix}"${escapeAttribute(versioned)}"`;
    },
  );

  rewritten = rewritten.replace(
    /(\bsrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/giu,
    (whole, prefix, doubleQuoted, singleQuoted) => {
      const original = doubleQuoted ?? singleQuoted ?? '';
      const candidates = original.split(',').map((candidate) => {
        const trimmed = candidate.trim();
        const separator = trimmed.search(/\s/u);
        const reference = separator < 0 ? trimmed : trimmed.slice(0, separator);
        const descriptor = separator < 0 ? '' : trimmed.slice(separator);
        return `${rewriteReference(reference)}${descriptor}`;
      });
      const versioned = candidates.join(', ');
      if (versioned === original) {
        return whole;
      }
      return `${prefix}"${escapeAttribute(versioned)}"`;
    },
  );

  return rewritten;
}

function assertVersionedHtmlAssets(html, manifest, context = 'page', options = {}) {
  const source = String(html);
  const attributePattern = /\b(?:href|poster|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
  for (const match of source.matchAll(attributePattern)) {
    assertVersionedReference(match[1] || match[2] || match[3], manifest, context, options);
  }

  const srcsetPattern = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;
  for (const match of source.matchAll(srcsetPattern)) {
    const candidates = (match[1] || match[2] || '').split(',');
    for (const candidate of candidates) {
      const reference = candidate.trim().split(/\s+/u)[0];
      assertVersionedReference(reference, manifest, context, options);
    }
  }

  for (const match of source.matchAll(CSS_URL_PATTERN)) {
    assertVersionedReference(match[2].trim(), manifest, context, options);
  }
}

module.exports = {
  AssetError,
  HASH_LENGTH,
  assertCssPublicBasePath,
  assertPublicBasePathReference,
  assertVersionedHtmlAssets,
  createAssetHelper,
  discoverAssets,
  encodePublicPath,
  hashBuffer,
  hashFile,
  isExternalReference,
  normalizeAssetKey,
  normalizeRoots,
  prepareAssets,
  rewriteHtmlAssetUrls,
  rewriteCssAssetUrls,
  sortManifest,
  splitUrlReference,
  writeAssetManifest,
};
