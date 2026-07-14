'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

const { createTestRuntime, exists, login } = require('./helpers/runtime');

function pagePayload(overrides = {}) {
  return {
    parent_id: overrides.parent_id,
    title: overrides.title || '测试页面',
    slug: overrides.slug || 'test-page',
    template_type: overrides.template_type || 'content',
    decorative_character: overrides.decorative_character || '惠',
    title_image: '/assets/images/titles/hui-consulting.png',
    background_image: 'hui',
    content: overrides.content || '<p>测试内容</p>',
    status: overrides.status || 'published',
  };
}

test('page CRUD enforces tree constraints and full publication removes stale paths', async (t) => {
  const runtime = await createTestRuntime(t, { realGenerator: true });
  const agent = request.agent(runtime.app);
  assert.equal((await login(agent)).status, 200);

  const createSection = await agent.post('/api/pages').send(
    pagePayload({
      parent_id: runtime.rootPage.id,
      title: '栏目 Alpha',
      slug: 'alpha',
      template_type: 'card-list',
    }),
  );
  assert.equal(createSection.status, 201, createSection.text);
  const section = createSection.body.page;
  assert.equal(section.url, '/alpha/');
  assert.equal(
    await exists(path.join(runtime.generatedDir, 'alpha', 'index.html')),
    true,
  );

  const readSection = await agent.get(`/api/pages/${section.id}`);
  assert.equal(readSection.status, 200);
  assert.equal(readSection.body.page.title, '栏目 Alpha');

  const updateSection = await agent
    .put(`/api/pages/${section.id}`)
    .send({ title: '栏目 Alpha 已更新' });
  assert.equal(updateSection.status, 200, updateSection.text);
  assert.equal(updateSection.body.page.title, '栏目 Alpha 已更新');

  const generationBeforeDuplicate = runtime.generationCount;
  const duplicate = await agent.post('/api/pages').send(
    pagePayload({
      parent_id: runtime.rootPage.id,
      title: '重复栏目',
      slug: 'alpha',
    }),
  );
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'DUPLICATE_SIBLING_SLUG');
  assert.equal(runtime.generationCount, generationBeforeDuplicate);

  const createChild = await agent.post('/api/pages').send(
    pagePayload({
      parent_id: section.id,
      title: '子页面',
      slug: 'child',
    }),
  );
  assert.equal(createChild.status, 201, createChild.text);
  const child = createChild.body.page;
  const oldChildOutput = path.join(
    runtime.generatedDir,
    'alpha',
    'child',
    'index.html',
  );
  assert.equal(await exists(oldChildOutput), true);

  const cycle = await agent
    .put(`/api/pages/${section.id}`)
    .send({ parent_id: child.id });
  assert.equal(cycle.status, 409);
  assert.equal(cycle.body.code, 'PAGE_PARENT_CYCLE');

  const childDeleteRefusal = await agent.delete(`/api/pages/${section.id}`);
  assert.equal(childDeleteRefusal.status, 409);
  assert.equal(childDeleteRefusal.body.code, 'PAGE_HAS_CHILDREN');

  const rename = await agent
    .put(`/api/pages/${child.id}`)
    .send({ slug: 'renamed-child', title: '重命名后的子页面' });
  assert.equal(rename.status, 200, rename.text);
  assert.equal(rename.body.page.previous_url, '/alpha/child/');
  assert.equal(rename.body.page.url, '/alpha/renamed-child/');
  assert.equal(await exists(oldChildOutput), false);

  const renamedOutput = path.join(
    runtime.generatedDir,
    'alpha',
    'renamed-child',
    'index.html',
  );
  assert.equal(await exists(renamedOutput), true);
  const renamedHtml = await fs.readFile(renamedOutput, 'utf8');
  assert.match(
    renamedHtml,
    /class="back-button" href="\/alpha\/"/,
    'generated child page must have an explicit database parent href',
  );

  const deleteChild = await agent.delete(`/api/pages/${child.id}`);
  assert.equal(deleteChild.status, 200, deleteChild.text);
  assert.equal(deleteChild.body.page.deleted, true);
  assert.equal(await exists(renamedOutput), false);

  const deleteSection = await agent.delete(`/api/pages/${section.id}`);
  assert.equal(deleteSection.status, 200, deleteSection.text);
  assert.equal(deleteSection.body.page.deleted, true);
  assert.equal(
    await exists(path.join(runtime.generatedDir, 'alpha', 'index.html')),
    false,
  );

  const missing = await agent.get(`/api/pages/${section.id}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'PAGE_NOT_FOUND');
});
