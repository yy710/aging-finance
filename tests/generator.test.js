'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { generateSite } = require('../server/generator');
const { REPOSITORY_ROOT } = require('./helpers/runtime');

function shortHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 10);
}

test('generator versions HTML/CSS assets stably, updates replacements, and rolls back failures', async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'aging-finance-generator-'),
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await Promise.all([
    fs.cp(
      path.join(REPOSITORY_ROOT, 'views'),
      path.join(projectRoot, 'views'),
      { recursive: true },
    ),
    fs.cp(
      path.join(REPOSITORY_ROOT, 'public-assets'),
      path.join(projectRoot, 'public-assets'),
      { recursive: true },
    ),
    fs.mkdir(path.join(projectRoot, 'uploads'), { recursive: true }),
  ]);

  const snapshot = {
    settings: {
      site_name: '测试养老金融',
      home_title: '如意人生',
      home_subtitle: '一点接入 养老无忧',
      copyright_text: '测试版权',
    },
    pages: [
      {
        id: 1,
        parent_id: null,
        title: '测试首页',
        slug: '',
        template_type: 'home',
        title_image: '/assets/images/home/main-title.png',
        background_image: 'home',
        status: 'published',
      },
      {
        id: 2,
        parent_id: 1,
        title: '政策咨询与设施查询',
        slug: 'section',
        template_type: 'card-list',
        decorative_character: '惠',
        title_image: '/assets/images/titles/hui-consulting.png',
        background_image: 'hui',
        status: 'published',
      },
      {
        id: 3,
        parent_id: 2,
        title: '详情页面',
        slug: 'detail',
        template_type: 'content',
        decorative_character: '惠',
        title_image: '/assets/images/titles/hui-consulting.png',
        background_image: 'hui',
        content: [
          '<p>静态详情</p>',
          '<script>window.__unsafe = true</script>',
          '<img class="content-image" src="/assets/images/home/logo.png" alt="本地资源">',
          '<a href="/section/">站内页面链接</a>',
          '<img src="https://example.com/external.png" alt="外部资源">',
        ].join(''),
        status: 'published',
      },
      {
        id: 4,
        parent_id: 2,
        title: '养老课堂',
        slug: 'retirement-class',
        template_type: 'card-list',
        decorative_character: '惠',
        title_image: '/assets/images/titles/hui-retirement-classroom.png',
        background_image: 'hui',
        status: 'published',
      },
      {
        id: 5,
        parent_id: 2,
        title: '文字入口页面',
        slug: 'text-links',
        template_type: 'link-list',
        decorative_character: '惠',
        title_image: '/assets/images/titles/hui-national-policy.png',
        background_image: 'hui',
        status: 'published',
      },
    ],
    cards: [
      {
        id: 1,
        page_id: 4,
        item_type: 'image_card',
        title: '养老课堂入口标题',
        image_path: '/assets/images/classroom/classroom-01.png',
        image_alt: '养老课堂海报',
        external_url: 'https://example.com/classroom',
        sort_order: 0,
        status: 'published',
      },
    ],
  };

  const first = await generateSite({ projectRoot, snapshot });
  assert.equal(first.pageCount, 5);
  assert.deepEqual(first.urls, [
    '/',
    '/section/',
    '/section/detail/',
    '/section/retirement-class/',
    '/section/text-links/',
  ]);
  for (const hash of Object.values(first.manifest)) {
    assert.match(hash, /^[a-f0-9]{10}$/);
  }

  const outputDir = path.join(projectRoot, 'public-generated');
  const manifestOnDisk = JSON.parse(
    await fs.readFile(path.join(outputDir, 'asset-manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifestOnDisk, first.manifest);

  const logoKey = '/assets/images/home/logo.png';
  const cssKey = '/assets/css/site.css';
  const middleKey = '/assets/images/decor/hui-middle.png';
  const homeBottomKey = '/assets/images/decor/home-bottom.png';
  const backKey = '/assets/images/global/back.png';
  const scriptKey = '/assets/js/site.js';
  const firstHome = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.match(
    firstHome,
    new RegExp(`/assets/css/site\\.css\\?v=${first.manifest[cssKey]}`),
  );
  assert.match(
    firstHome,
    new RegExp(`/assets/images/home/logo\\.png\\?v=${first.manifest[logoKey]}`),
  );
  assert.match(
    firstHome,
    new RegExp(`/assets/images/decor/home-bottom\\.png\\?v=${first.manifest[homeBottomKey]}`),
  );
  assert.match(firstHome, /class="page-background__bottom"[^>]+width="720" height="504"/u);
  assert.doesNotMatch(firstHome, /site-footer__scene/u);

  const compiledCssPath = path.join(outputDir, 'assets', 'css', 'site.css');
  const compiledCss = await fs.readFile(compiledCssPath);
  const compiledCssText = compiledCss.toString('utf8');
  assert.equal(first.manifest[cssKey], shortHash(compiledCss));
  assert.match(
    compiledCssText,
    new RegExp(
      `/assets/images/decor/hui-middle\\.png\\?v=${first.manifest[middleKey]}`,
    ),
  );
  assert.match(
    compiledCssText,
    /\.card-list--classroom\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/su,
    'the classroom card grid must use two columns',
  );
  assert.doesNotMatch(
    compiledCssText,
    /\.card-list--classroom\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su,
    'mobile styles must not collapse the classroom card grid to one column',
  );

  const detailHtml = await fs.readFile(
    path.join(outputDir, 'section', 'detail', 'index.html'),
    'utf8',
  );
  assert.match(
    detailHtml,
    /class="back-button" href="\/section\/"/,
    'a deep link must always include its explicit parent URL',
  );
  assert.match(
    detailHtml,
    new RegExp(`/assets/images/global/back\\.png\\?v=${first.manifest[backKey]}`),
    'the return button must use the versioned shared icon',
  );
  assert.doesNotMatch(detailHtml, /window\.__unsafe|<script>\s*window/iu);
  assert.match(
    detailHtml,
    new RegExp(`/assets/images/home/logo\\.png\\?v=${first.manifest[logoKey]}`),
  );
  assert.match(detailHtml, /href="\/section\/"/u);
  assert.match(detailHtml, /src="https:\/\/example\.com\/external\.png"/u);

  const classroomHtml = await fs.readFile(
    path.join(outputDir, 'section', 'retirement-class', 'index.html'),
    'utf8',
  );
  assert.match(classroomHtml, /class="visual-card__title">养老课堂入口标题<\/span>/u);
  assert.match(classroomHtml, /class="back-button" href="\/section\/"/u);
  const textLinksHtml = await fs.readFile(
    path.join(outputDir, 'section', 'text-links', 'index.html'),
    'utf8',
  );
  assert.match(textLinksHtml, /class="back-button" href="\/section\/"/u);

  const second = await generateSite({ projectRoot, snapshot });
  assert.deepEqual(second.manifest, first.manifest);
  assert.equal(
    await fs.readFile(path.join(outputDir, 'index.html'), 'utf8'),
    firstHome,
  );

  const sourceLogo = path.join(
    projectRoot,
    'public-assets',
    'images',
    'home',
    'logo.png',
  );
  const originalLogo = await fs.readFile(sourceLogo);
  await fs.writeFile(
    sourceLogo,
    Buffer.concat([originalLogo, Buffer.from('replacement-version')]),
  );
  const third = await generateSite({ projectRoot, snapshot });
  assert.notEqual(third.manifest[logoKey], first.manifest[logoKey]);
  assert.equal(third.manifest[scriptKey], first.manifest[scriptKey]);
  assert.equal(third.manifest[middleKey], first.manifest[middleKey]);
  assert.equal(third.manifest[cssKey], first.manifest[cssKey]);
  const replacedHome = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.match(
    replacedHome,
    new RegExp(`/assets/images/home/logo\\.png\\?v=${third.manifest[logoKey]}`),
  );
  assert.doesNotMatch(
    replacedHome,
    new RegExp(`/assets/images/home/logo\\.png\\?v=${first.manifest[logoKey]}`),
  );

  const publishedBeforeFailure = await fs.readFile(
    path.join(outputDir, 'index.html'),
    'utf8',
  );
  const manifestBeforeFailure = await fs.readFile(
    path.join(outputDir, 'asset-manifest.json'),
    'utf8',
  );
  const missingAssetSnapshot = structuredClone(snapshot);
  missingAssetSnapshot.pages[2].content = '<img src="/uploads/missing.png" alt="缺失资源">';
  await assert.rejects(
    generateSite({ projectRoot, snapshot: missingAssetSnapshot }),
    (error) => error.code === 'ASSET_NOT_FOUND',
  );
  assert.equal(
    await fs.readFile(path.join(outputDir, 'index.html'), 'utf8'),
    publishedBeforeFailure,
  );
  await fs.writeFile(
    path.join(projectRoot, 'views', 'home.ejs'),
    '<% throw new Error("intentional generation failure") %>',
    'utf8',
  );
  await assert.rejects(
    generateSite({ projectRoot, snapshot }),
    /intentional generation failure/,
  );
  assert.equal(
    await fs.readFile(path.join(outputDir, 'index.html'), 'utf8'),
    publishedBeforeFailure,
  );
  assert.equal(
    await fs.readFile(path.join(outputDir, 'asset-manifest.json'), 'utf8'),
    manifestBeforeFailure,
  );
  const leftovers = (await fs.readdir(projectRoot)).filter((name) =>
    /\.stage-|\.backup-/u.test(name),
  );
  assert.deepEqual(leftovers, []);
});
