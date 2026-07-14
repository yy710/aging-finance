'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  assertVersionedHtmlAssets,
  createAssetHelper,
  normalizeAssetKey,
  prepareAssets,
  rewriteHtmlAssetUrls,
  splitUrlReference,
  writeAssetManifest,
} = require('./assets');
const {
  createPageUrl,
  createPublicUrl,
  normalizePublicBasePath,
  stripPublicBasePath,
} = require('./public-url');
const { buildSiteTree, getPageById } = require('./site-tree');
const { sanitizeContent } = require('./sanitize');

const TEMPLATE_TYPES = ['home', 'card-list', 'content', 'link-list'];
const OUTPUT_MARKER_FILENAME = '.aging-finance-generated';
const publicationQueues = new Map();

class GeneratorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GeneratorError';
    this.code = code;
    Object.assign(this, details);
  }
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function unwrapData(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.data &&
    typeof value.data === 'object' &&
    !Object.prototype.hasOwnProperty.call(value, 'pages') &&
    !Object.prototype.hasOwnProperty.call(value, 'publishedPages')
  ) {
    return value.data;
  }
  return value;
}

function unwrapCollection(value) {
  const unwrapped = unwrapData(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }
  if (unwrapped && typeof unwrapped === 'object') {
    for (const key of ['rows', 'items', 'records', 'results']) {
      if (Array.isArray(unwrapped[key])) {
        return unwrapped[key];
      }
    }
  }
  return unwrapped;
}

function normalizeSettings(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      return normalizeSettings(JSON.parse(value));
    } catch {
      return { value };
    }
  }
  if (!Array.isArray(value)) {
    return { ...value };
  }
  if (value.length === 0) {
    return {};
  }

  const keyNames = ['key', 'name', 'setting_key'];
  const valueNames = ['value', 'setting_value'];
  const canConvertPairs = value.every((row) =>
    keyNames.some((key) => Object.prototype.hasOwnProperty.call(row, key)),
  );
  if (canConvertPairs) {
    const settings = {};
    for (const row of value) {
      const keyName = keyNames.find((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      );
      const valueName = valueNames.find((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      );
      settings[row[keyName]] = valueName ? row[valueName] : null;
    }
    return settings;
  }

  if (value.length === 1) {
    return { ...value[0] };
  }
  return Object.assign({}, ...value);
}

function normalizeSnapshot(value) {
  const snapshot = unwrapData(value) || {};
  const pagesValue =
    snapshot.pages ||
    snapshot.publishedPages ||
    snapshot.published_pages ||
    [];
  const cardsValue =
    snapshot.cards ||
    snapshot.publishedCards ||
    snapshot.published_cards ||
    [];
  const settingsValue =
    snapshot.settings ||
    snapshot.siteSettings ||
    snapshot.site_settings ||
    {};
  const pages = unwrapCollection(pagesValue);
  let cards = unwrapCollection(cardsValue);
  const settings = unwrapData(settingsValue);

  if (!Array.isArray(pages)) {
    throw new GeneratorError(
      'CONTENT_PAGES_INVALID',
      'The content provider did not return a pages array',
    );
  }
  if (!Array.isArray(cards)) {
    throw new GeneratorError(
      'CONTENT_CARDS_INVALID',
      'The content provider did not return a cards array',
    );
  }

  if (cards.length === 0) {
    cards = pages.flatMap((page) =>
      Array.isArray(page.cards)
        ? page.cards.map((card) => ({ page_id: page.id, ...card }))
        : [],
    );
  }

  return {
    pages,
    cards,
    settings: normalizeSettings(settings),
  };
}

async function invokeFirst(source, methodNames, ...args) {
  for (const methodName of methodNames) {
    if (typeof source[methodName] === 'function') {
      return {
        found: true,
        methodName,
        value: await source[methodName](...args),
      };
    }
  }
  return { found: false, methodName: null, value: undefined };
}

function isDatabaseHandle(value) {
  return value && typeof value.prepare === 'function';
}

function readDatabaseSnapshot(database) {
  try {
    const pages = database.prepare('SELECT * FROM pages').all();
    const cards = database.prepare('SELECT * FROM cards').all();
    const settings = database.prepare('SELECT * FROM site_settings').all();
    return normalizeSnapshot({ pages, cards, settings });
  } catch (error) {
    throw new GeneratorError(
      'DATABASE_SNAPSHOT_FAILED',
      `Could not read publication data from the database: ${error.message}`,
      { cause: error },
    );
  }
}

async function materializeContentSource(source, context, seen = new Set()) {
  let current = await source;
  if (!current) {
    throw new GeneratorError(
      'CONTENT_SOURCE_REQUIRED',
      'A content service, database handle, or publication snapshot is required',
    );
  }

  if ((typeof current === 'object' || typeof current === 'function') && seen.has(current)) {
    throw new GeneratorError(
      'CONTENT_SOURCE_RECURSIVE',
      'The content provider factory returned itself',
    );
  }
  if (typeof current === 'object' || typeof current === 'function') {
    seen.add(current);
  }

  if (
    typeof current === 'object' &&
    current.default &&
    current.default !== current
  ) {
    current = current.default;
  }

  if (typeof current === 'function') {
    const produced = await current(context);
    return materializeContentSource(produced, context, seen);
  }

  const directlyUsable =
    isDatabaseHandle(current) ||
    Array.isArray(current.pages) ||
    Array.isArray(current.publishedPages) ||
    [
      'getPublicationSnapshot',
      'getPublishedSiteData',
      'getSiteSnapshot',
      'loadPublishedSite',
      'listPublishedPages',
      'getPublishedPages',
      'listPages',
      'getPages',
    ].some((name) => typeof current[name] === 'function');

  if (!directlyUsable) {
    const factory = await invokeFirst(
      current,
      [
        'getContentService',
        'createContentService',
        'getDatabase',
        'getDb',
        'openDatabase',
        'createDatabase',
      ],
      context,
    );
    if (factory.found) {
      return materializeContentSource(factory.value, context, seen);
    }
  }

  if (current.db && isDatabaseHandle(current.db)) {
    return current.db;
  }
  if (current.database && isDatabaseHandle(current.database)) {
    return current.database;
  }
  return current;
}

async function loadContentSnapshot(contentSource, context = {}) {
  const source = await materializeContentSource(contentSource, context);

  if (isDatabaseHandle(source)) {
    return readDatabaseSnapshot(source);
  }

  const completeSnapshot = await invokeFirst(source, [
    'getPublicationSnapshot',
    'getPublishedSiteData',
    'getPublishedSite',
    'getSiteSnapshot',
    'getPublicationData',
    'loadPublishedSite',
    'loadSiteData',
  ]);
  if (completeSnapshot.found) {
    return normalizeSnapshot(completeSnapshot.value);
  }

  if (
    Array.isArray(source.pages) ||
    Array.isArray(source.publishedPages) ||
    Array.isArray(source.published_pages)
  ) {
    return normalizeSnapshot(source);
  }

  const pagesResult = await invokeFirst(source, [
    'listPublishedPages',
    'getPublishedPages',
    'listPages',
    'getPages',
  ]);
  if (!pagesResult.found || !Array.isArray(unwrapCollection(pagesResult.value))) {
    throw new GeneratorError(
      'CONTENT_PAGES_UNAVAILABLE',
      'The content provider exposes no supported published-pages method',
    );
  }
  const pages = unwrapCollection(pagesResult.value);

  const cardsResult = await invokeFirst(source, [
    'listPublishedCards',
    'getPublishedCards',
    'listCards',
    'getCards',
  ]);
  let cards = cardsResult.found ? unwrapCollection(cardsResult.value) : null;

  if (!cardsResult.found) {
    const perPageMethod = [
      'listPublishedCardsForPage',
      'getPublishedCardsForPage',
      'listCardsForPage',
      'getCardsForPage',
    ].find((name) => typeof source[name] === 'function');
    if (perPageMethod) {
      const groups = await Promise.all(
        pages.map(async (page) => {
          const value = unwrapCollection(await source[perPageMethod](page.id));
          if (!Array.isArray(value)) {
            throw new GeneratorError(
              'CONTENT_CARDS_INVALID',
              `${perPageMethod} did not return an array for page ${page.id}`,
            );
          }
          return value.map((card) => ({ page_id: page.id, ...card }));
        }),
      );
      cards = groups.flat();
    }
  }

  if (cards === null) {
    cards = pages.flatMap((page) =>
      Array.isArray(page.cards)
        ? page.cards.map((card) => ({ page_id: page.id, ...card }))
        : [],
    );
  }
  if (!Array.isArray(cards)) {
    throw new GeneratorError(
      'CONTENT_CARDS_INVALID',
      'The content provider did not return a cards array',
    );
  }

  const settingsResult = await invokeFirst(source, [
    'getSiteSettings',
    'getSettings',
    'loadSiteSettings',
    'loadSettings',
  ]);

  return normalizeSnapshot({
    pages,
    cards,
    settings: settingsResult.found ? unwrapData(settingsResult.value) : {},
  });
}

function loadEjsEngine(engine) {
  if (engine) {
    return engine;
  }
  try {
    // Kept lazy so the tree and hash helpers remain usable without EJS loaded.
    return require('ejs');
  } catch (error) {
    throw new GeneratorError(
      'EJS_NOT_INSTALLED',
      'EJS is required to generate the static site',
      { cause: error },
    );
  }
}

async function renderEjsFile(engine, filename, data) {
  if (!engine || typeof engine.renderFile !== 'function') {
    throw new GeneratorError(
      'EJS_ENGINE_INVALID',
      'The supplied EJS engine must expose renderFile()',
    );
  }
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

async function resolveTemplatePaths(viewsDirectory, configuredTemplates = {}) {
  const templates = {};
  for (const templateType of TEMPLATE_TYPES) {
    const configured = configuredTemplates[templateType];
    const candidates = configured
      ? [
          path.isAbsolute(configured)
            ? configured
            : path.resolve(viewsDirectory, configured),
        ]
      : [
          path.join(viewsDirectory, `${templateType}.ejs`),
          path.join(viewsDirectory, 'pages', `${templateType}.ejs`),
          path.join(viewsDirectory, 'public', `${templateType}.ejs`),
        ];

    let selected = null;
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      throw new GeneratorError(
        'PUBLIC_TEMPLATE_MISSING',
        `No EJS template was found for ${templateType}`,
        { templateType, candidates },
      );
    }
    templates[templateType] = selected;
  }
  return templates;
}

async function resolveDefaultAssetsDirectory(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'public-assets'),
    path.join(projectRoot, 'assets'),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

async function resolveAssetRoots(options, projectRoot) {
  if (Array.isArray(options.assetRoots)) {
    return options.assetRoots;
  }
  const assetsDirectory = options.assetsDir
    ? path.resolve(projectRoot, options.assetsDir)
    : await resolveDefaultAssetsDirectory(projectRoot);
  const uploadsDirectory = options.uploadsDir
    ? path.resolve(projectRoot, options.uploadsDir)
    : path.join(projectRoot, 'uploads');
  return [
    { directory: assetsDirectory, urlPrefix: '/assets' },
    { directory: uploadsDirectory, urlPrefix: '/uploads' },
  ];
}

function safeStageDestination(stageDirectory, relativeOutputPath) {
  const destination = path.resolve(stageDirectory, relativeOutputPath);
  const prefix = `${path.resolve(stageDirectory)}${path.sep}`;
  if (destination !== path.resolve(stageDirectory) && !destination.startsWith(prefix)) {
    throw new GeneratorError(
      'PAGE_OUTPUT_PATH_INVALID',
      `Page output escaped the staging directory: ${relativeOutputPath}`,
      { outputPath: relativeOutputPath },
    );
  }
  return destination;
}

const PROTECTED_OUTPUT_DIRECTORIES = [
  '.git',
  'admin',
  'config',
  'data',
  'deploy',
  'node_modules',
  'public-assets',
  'resources',
  'scripts',
  'server',
  'tests',
  'uploads',
  'views',
];

function isSameOrDescendant(candidate, ancestor) {
  const relative = path.relative(path.resolve(ancestor), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function assertSafeOutputDirectory(projectRoot, outputDirectory, protectedPaths = []) {
  const root = path.resolve(projectRoot);
  const output = path.resolve(outputDirectory);
  if (output === path.parse(output).root || !isSameOrDescendant(output, root) || output === root) {
    throw new GeneratorError(
      'OUTPUT_DIRECTORY_UNSAFE',
      'The generated-site directory must be a dedicated subdirectory inside the project root',
      { projectRoot: root, outputDirectory: output },
    );
  }

  const fixedProtectedPaths = PROTECTED_OUTPUT_DIRECTORIES.map((directory) => path.join(root, directory));
  for (const protectedPath of [...fixedProtectedPaths, ...protectedPaths]) {
    const resolvedProtectedPath = path.resolve(protectedPath);
    if (
      isSameOrDescendant(output, resolvedProtectedPath)
      || isSameOrDescendant(resolvedProtectedPath, output)
    ) {
      throw new GeneratorError(
        'OUTPUT_DIRECTORY_UNSAFE',
        `The generated-site directory overlaps protected project data: ${resolvedProtectedPath}`,
        { projectRoot: root, outputDirectory: output, protectedPath: resolvedProtectedPath },
      );
    }
  }

  const relativeParent = path.relative(root, path.dirname(output));
  let current = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new GeneratorError(
          'OUTPUT_DIRECTORY_UNSAFE',
          `The generated-site path crosses a symbolic link: ${current}`,
          { projectRoot: root, outputDirectory: output, symbolicLink: current },
        );
      }
      if (!stat.isDirectory()) {
        throw new GeneratorError(
          'OUTPUT_DIRECTORY_UNSAFE',
          `A generated-site parent is not a directory: ${current}`,
          { projectRoot: root, outputDirectory: output, invalidParent: current },
        );
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }

  try {
    const outputStat = await fsp.lstat(output);
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
      throw new GeneratorError(
        'OUTPUT_DIRECTORY_UNSAFE',
        'Refusing to replace an existing file or symbolic link as generated output',
        { projectRoot: root, outputDirectory: output },
      );
    }
    if (!(await pathExists(path.join(output, OUTPUT_MARKER_FILENAME)))) {
      throw new GeneratorError(
        'OUTPUT_DIRECTORY_UNSAFE',
        'Refusing to replace an existing directory not owned by this generator',
        { projectRoot: root, outputDirectory: output },
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return output;
}

async function publishAtomically(stageDirectory, outputDirectory) {
  const parent = path.dirname(outputDirectory);
  const backupDirectory = path.join(
    parent,
    `.${path.basename(outputDirectory)}.backup-${process.pid}-${crypto.randomUUID()}`,
  );
  let previousVersionMoved = false;

  try {
    await fsp.rename(outputDirectory, backupDirectory);
    previousVersionMoved = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    await fsp.rename(stageDirectory, outputDirectory);
  } catch (publishError) {
    if (previousVersionMoved) {
      try {
        await fsp.rename(backupDirectory, outputDirectory);
      } catch (rollbackError) {
        publishError.rollbackError = rollbackError;
        publishError.message = `${publishError.message}; rollback also failed: ${rollbackError.message}`;
      }
    }
    throw publishError;
  }

  let cleanupWarning = null;
  if (previousVersionMoved) {
    try {
      await fsp.rm(backupDirectory, { recursive: true, force: true });
    } catch (error) {
      cleanupWarning = `Published successfully but could not remove backup ${backupDirectory}: ${error.message}`;
    }
  }
  return { backupDirectory: previousVersionMoved ? backupDirectory : null, cleanupWarning };
}

async function removeStage(stageDirectory) {
  try {
    await fsp.rm(stageDirectory, { recursive: true, force: true });
  } catch {
    // Preserve the original generation error. A uniquely named stale stage can
    // be cleaned independently without risking the currently published site.
  }
}

async function generateSiteOnce(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const publicBasePath = normalizePublicBasePath(
    options.publicBasePath ?? process.env.PUBLIC_BASE_PATH ?? '',
  );
  const viewsDirectory = path.resolve(
    projectRoot,
    options.viewsDir || 'views',
  );
  const outputDirectory = path.resolve(
    projectRoot,
    options.outputDir || 'public-generated',
  );
  const databasePath = path.resolve(
    projectRoot,
    options.databasePath || path.join('data', 'site.db'),
  );
  const assetRoots = await resolveAssetRoots(options, projectRoot);
  await assertSafeOutputDirectory(projectRoot, outputDirectory, [
    viewsDirectory,
    path.dirname(databasePath),
    ...assetRoots.map((root) => root.directory || root.dir),
  ]);

  const contentSource =
    options.contentSource || options.contentService || options.database;
  const snapshot = options.snapshot
    ? normalizeSnapshot(options.snapshot)
    : await loadContentSnapshot(contentSource, {
        projectRoot,
        databasePath,
        filename: databasePath,
        fileMustExist: true,
        initialize: false,
        readonly: true,
      });
  const tree = buildSiteTree(snapshot.pages, snapshot.cards, {
    allowedExternalProtocols: options.allowedExternalProtocols,
    requireCardTargets: options.requireCardTargets,
  });
  const engine = loadEjsEngine(options.ejs);
  const templates = await resolveTemplatePaths(
    viewsDirectory,
    options.templates,
  );

  await fsp.mkdir(path.dirname(outputDirectory), { recursive: true });
  const stageDirectory = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.stage-${process.pid}-${crypto.randomUUID()}`,
  );
  await fsp.mkdir(stageDirectory, { recursive: false });

  try {
    await fsp.writeFile(
      path.join(stageDirectory, OUTPUT_MARKER_FILENAME),
      'Managed by the aging-finance static generator.\n',
      'utf8',
    );
    const preparedAssets = await prepareAssets({
      roots: assetRoots,
      stageDirectory,
      ejs: engine,
      publicBasePath,
      templateData: {
        publicBasePath,
        settings: snapshot.settings,
        site: snapshot.settings,
      },
    });
    const asset = createAssetHelper(preparedAssets.manifest, {
      publicBasePath,
      strict: options.strictAssets !== false,
    });
    const prefixPublicUrl = createPublicUrl(publicBasePath);
    const publicUrl = (reference) => {
      const internalReference = stripPublicBasePath(reference, publicBasePath);
      let key = '';
      try {
        key = normalizeAssetKey(splitUrlReference(internalReference).pathname);
      } catch {
        return prefixPublicUrl(reference);
      }
      const isManagedAsset = key === '/assets'
        || key.startsWith('/assets/')
        || key === '/uploads'
        || key.startsWith('/uploads/');
      return isManagedAsset ? asset(internalReference) : prefixPublicUrl(reference);
    };
    await writeAssetManifest(stageDirectory, preparedAssets.manifest);

    const pageUrl = createPageUrl(
      publicBasePath,
      (pageId) => getPageById(tree, pageId),
    );
    const urlForPage = pageUrl;

    for (const page of tree.pages) {
      const templatePath = templates[page.template_type];
      const helpers = {
        asset,
        pageUrl,
        publicUrl,
        resolveAsset: asset,
        urlForPage,
      };
      const safeContent = rewriteHtmlAssetUrls(
        sanitizeContent(page.content || ''),
        preparedAssets.manifest,
        asset,
        { publicBasePath, publicUrl },
      );
      const html = await renderEjsFile(engine, templatePath, {
        asset,
        cards: page.cards,
        children: page.children,
        helpers,
        page,
        pageUrl,
        pages: tree.pages,
        parent: page.parent,
        parentUrl: page.parent ? pageUrl(page.parent) : publicUrl('/'),
        publicBasePath,
        publicUrl,
        root: tree.root,
        settings: snapshot.settings,
        safeContent,
        site: snapshot.settings,
        tree,
        urlForPage,
      });
      assertVersionedHtmlAssets(
        html,
        preparedAssets.manifest,
        pageUrl(page),
        { publicBasePath },
      );

      const destination = safeStageDestination(
        stageDirectory,
        page.outputPath,
      );
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, html, 'utf8');
    }

    const publication = await publishAtomically(
      stageDirectory,
      outputDirectory,
    );
    return {
      outputDir: outputDirectory,
      pageCount: tree.pages.length,
      cardCount: tree.cards.length,
      assetCount: Object.keys(preparedAssets.manifest).length,
      manifest: preparedAssets.manifest,
      publicBasePath,
      urls: tree.pages.map((page) => pageUrl(page)),
      cleanupWarning: publication.cleanupWarning,
    };
  } catch (error) {
    await removeStage(stageDirectory);
    throw error;
  }
}

function generateSite(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const outputDirectory = path.resolve(
    projectRoot,
    options.outputDir || 'public-generated',
  );
  const previous = publicationQueues.get(outputDirectory) || Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(() => generateSiteOnce(options));
  publicationQueues.set(outputDirectory, queued);
  const clearQueue = () => {
    if (publicationQueues.get(outputDirectory) === queued) {
      publicationQueues.delete(outputDirectory);
    }
  };
  queued.then(clearQueue, clearQueue);
  return queued;
}

function createGenerator(defaultOptions = {}) {
  return function generatedWithDefaults(overrides = {}) {
    return generateSite({ ...defaultOptions, ...overrides });
  };
}

module.exports = {
  GeneratorError,
  OUTPUT_MARKER_FILENAME,
  TEMPLATE_TYPES,
  assertSafeOutputDirectory,
  createGenerator,
  generateSite,
  generateSiteOnce,
  loadContentSnapshot,
  normalizeSettings,
  normalizeSnapshot,
  publishAtomically,
  resolveAssetRoots,
  resolveTemplatePaths,
};
