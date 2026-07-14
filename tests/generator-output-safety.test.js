'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { generateSite, OUTPUT_MARKER_FILENAME } = require('../server/generator');
const { REPOSITORY_ROOT } = require('./helpers/runtime');

function homeSnapshot() {
  return {
    settings: { site_name: '输出安全测试' },
    pages: [{
      id: 1,
      parent_id: null,
      title: '首页',
      slug: '',
      template_type: 'home',
      title_image: '/assets/images/home/main-title.png',
      background_image: 'home',
      status: 'published',
    }],
    cards: [],
  };
}

test('generator refuses destructive output targets and marks owned custom outputs', async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aging-finance-output-safe-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aging-finance-output-outside-'));
  t.after(async () => {
    await Promise.all([
      fs.rm(projectRoot, { recursive: true, force: true }),
      fs.rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });
  await Promise.all([
    fs.cp(path.join(REPOSITORY_ROOT, 'views'), path.join(projectRoot, 'views'), { recursive: true }),
    fs.cp(path.join(REPOSITORY_ROOT, 'public-assets'), path.join(projectRoot, 'public-assets'), { recursive: true }),
    fs.mkdir(path.join(projectRoot, 'uploads'), { recursive: true }),
  ]);

  const sentinel = path.join(projectRoot, 'sentinel-source.txt');
  const readme = path.join(projectRoot, 'README.md');
  await fs.writeFile(sentinel, 'source must survive', 'utf8');
  await fs.writeFile(readme, 'documentation must survive', 'utf8');

  for (const outputDir of ['.', 'views', 'README.md']) {
    await assert.rejects(
      generateSite({ projectRoot, snapshot: homeSnapshot(), outputDir }),
      (error) => error.code === 'OUTPUT_DIRECTORY_UNSAFE',
    );
  }
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'source must survive');
  assert.equal(await fs.readFile(readme, 'utf8'), 'documentation must survive');

  const outsideVictim = path.join(outsideRoot, 'victim');
  await fs.mkdir(outsideVictim);
  await fs.writeFile(path.join(outsideVictim, 'outside-sentinel.txt'), 'outside must survive', 'utf8');
  await fs.symlink(outsideRoot, path.join(projectRoot, 'escape'), 'dir');
  await assert.rejects(
    generateSite({ projectRoot, snapshot: homeSnapshot(), outputDir: 'escape/victim' }),
    (error) => error.code === 'OUTPUT_DIRECTORY_UNSAFE',
  );
  assert.equal(
    await fs.readFile(path.join(outsideVictim, 'outside-sentinel.txt'), 'utf8'),
    'outside must survive',
  );

  const result = await generateSite({
    projectRoot,
    snapshot: homeSnapshot(),
    outputDir: 'dist/site',
  });
  assert.equal(result.pageCount, 1);
  assert.equal(
    await fs.readFile(path.join(projectRoot, 'dist', 'site', OUTPUT_MARKER_FILENAME), 'utf8'),
    'Managed by the aging-finance static generator.\n',
  );

  await fs.rm(path.join(projectRoot, 'dist', 'site', OUTPUT_MARKER_FILENAME));
  await assert.rejects(
    generateSite({ projectRoot, snapshot: homeSnapshot(), outputDir: 'dist/site' }),
    (error) => error.code === 'OUTPUT_DIRECTORY_UNSAFE',
  );
});
