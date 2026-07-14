#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { generateSite } = require('../server/generator');

const CONTENT_MODULE_CANDIDATES = [
  'server/content-service.js',
  'server/services/content-service.js',
  'server/site-content.js',
  'server/repositories/content-repository.js',
  'server/database.js',
  'server/db.js',
  'server/db/index.js',
  'data/database.js',
];

function usage() {
  return [
    'Usage: node scripts/generate.js [options]',
    '',
    'Options:',
    '  --content-module <path>  Content service/database module',
    '  --snapshot <path>        JSON publication snapshot (pages/cards/settings)',
    '  --project-root <path>    Project root (default: current directory)',
    '  --views-dir <path>       EJS views directory (default: views)',
    '  --output-dir <path>      Generated site directory (default: public-generated)',
    '  --assets-dir <path>      Public asset source (default: public-assets or assets)',
    '  --uploads-dir <path>     Uploaded media source (default: uploads)',
    '  --json                   Print only the JSON result',
    '  --help                   Show this help',
    '',
    'SITE_CONTENT_MODULE or CONTENT_MODULE can replace --content-module.',
  ].join('\n');
}

function parseArguments(argv) {
  const result = { json: false, help: false };
  const valueOptions = new Map([
    ['--content-module', 'contentModule'],
    ['--snapshot', 'snapshot'],
    ['--project-root', 'projectRoot'],
    ['--views-dir', 'viewsDir'],
    ['--output-dir', 'outputDir'],
    ['--assets-dir', 'assetsDir'],
    ['--uploads-dir', 'uploadsDir'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      result.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      result.help = true;
      continue;
    }
    const optionName = valueOptions.get(argument);
    if (!optionName) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    result[optionName] = value;
    index += 1;
  }
  return result;
}

async function exists(filePath) {
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

async function resolveContentModule(projectRoot, requestedModule) {
  const environmentModule =
    process.env.SITE_CONTENT_MODULE || process.env.CONTENT_MODULE;
  const configured = requestedModule || environmentModule;
  if (configured) {
    const modulePath = path.isAbsolute(configured)
      ? configured
      : path.resolve(projectRoot, configured);
    if (!(await exists(modulePath))) {
      throw new Error(`Content module does not exist: ${modulePath}`);
    }
    return modulePath;
  }

  for (const candidate of CONTENT_MODULE_CANDIDATES) {
    const modulePath = path.resolve(projectRoot, candidate);
    if (await exists(modulePath)) {
      return modulePath;
    }
  }

  throw new Error(
    [
      'No content service or database module was found.',
      'Pass --content-module <path> or set SITE_CONTENT_MODULE.',
      `Checked: ${CONTENT_MODULE_CANDIDATES.join(', ')}`,
    ].join(' '),
  );
}

async function loadJsonSnapshot(projectRoot, snapshotPath) {
  const absolutePath = path.isAbsolute(snapshotPath)
    ? snapshotPath
    : path.resolve(projectRoot, snapshotPath);
  const source = await fsp.readFile(absolutePath, 'utf8');
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Snapshot is not valid JSON (${absolutePath}): ${error.message}`);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const projectRoot = path.resolve(args.projectRoot || process.cwd());
  let snapshot;
  let contentSource;
  if (args.snapshot) {
    snapshot = await loadJsonSnapshot(projectRoot, args.snapshot);
  } else {
    const modulePath = await resolveContentModule(
      projectRoot,
      args.contentModule,
    );
    // The generator accepts a snapshot loader, a content service, a raw
    // better-sqlite3 handle, or a module exposing a factory for one of those.
    contentSource = require(modulePath);
  }

  const result = await generateSite({
    projectRoot,
    snapshot,
    contentSource,
    viewsDir: args.viewsDir,
    outputDir: args.outputDir,
    assetsDir: args.assetsDir,
    uploadsDir: args.uploadsDir,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `Generated ${result.pageCount} pages and ${result.assetCount} hashed assets.`,
      `Output: ${result.outputDir}`,
      result.cleanupWarning || '',
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

main().catch((error) => {
  const issues = Array.isArray(error.issues)
    ? `\n${error.issues
        .map((issue) => `- ${issue.code}: ${issue.message}`)
        .join('\n')}`
    : '';
  process.stderr.write(`Static generation failed: ${error.message}${issues}\n`);
  process.exitCode = 1;
});

module.exports = {
  CONTENT_MODULE_CANDIDATES,
  loadJsonSnapshot,
  parseArguments,
  resolveContentModule,
};
