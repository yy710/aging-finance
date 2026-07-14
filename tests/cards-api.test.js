'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createTestRuntime, login } = require('./helpers/runtime');

function cardPayload(pageId, title, overrides = {}) {
  return {
    page_id: pageId,
    item_type: overrides.item_type || 'image_card',
    title,
    description: overrides.description || '',
    image_path: overrides.image_path || '/assets/images/cards/le-01-xdf.png',
    image_alt: overrides.image_alt || title,
    target_page_id: overrides.target_page_id ?? null,
    external_url: overrides.external_url || `https://example.com/${title.toLowerCase()}`,
    status: overrides.status || 'published',
  };
}

test('Card CRUD preserves deterministic up/down ordering and rejects unsafe links', async (t) => {
  const runtime = await createTestRuntime(t);
  const cardPage = runtime.service.createPage({
    parent_id: runtime.rootPage.id,
    title: 'Card 测试页',
    slug: 'cards',
    template_type: 'card-list',
    decorative_character: '乐',
    title_image: '/assets/images/titles/le-cultural-value.png',
    background_image: 'le',
    content: '',
    status: 'published',
  });
  const agent = request.agent(runtime.app);
  assert.equal((await login(agent)).status, 200);

  const created = [];
  for (const title of ['A', 'B', 'C']) {
    const response = await agent
      .post('/api/cards')
      .send(cardPayload(cardPage.id, title));
    assert.equal(response.status, 201, response.text);
    created.push(response.body.card);
  }
  assert.deepEqual(
    created.map((card) => card.sort_order),
    [0, 1, 2],
  );

  const getCard = await agent.get(`/api/cards/${created[0].id}`);
  assert.equal(getCard.status, 200);
  assert.equal(getCard.body.card.title, 'A');

  const listInitial = await agent.get(`/api/pages/${cardPage.id}/cards`);
  assert.equal(listInitial.status, 200);
  assert.deepEqual(listInitial.body.cards.map((card) => card.title), ['A', 'B', 'C']);

  const moveUp = await agent
    .post(`/api/cards/${created[2].id}/move`)
    .send({ direction: 'up' });
  assert.equal(moveUp.status, 200, moveUp.text);
  assert.equal(moveUp.body.card.moved, true);
  const afterUp = await agent.get(`/api/pages/${cardPage.id}/cards`);
  assert.deepEqual(afterUp.body.cards.map((card) => card.title), ['A', 'C', 'B']);
  assert.deepEqual(afterUp.body.cards.map((card) => card.sort_order), [0, 1, 2]);

  const moveDown = await agent
    .post(`/api/cards/${created[2].id}/move`)
    .send({ direction: 'down' });
  assert.equal(moveDown.status, 200, moveDown.text);
  assert.equal(moveDown.body.card.moved, true);
  const afterDown = await agent.get(`/api/pages/${cardPage.id}/cards`);
  assert.deepEqual(afterDown.body.cards.map((card) => card.title), ['A', 'B', 'C']);

  const topBoundary = await agent
    .post(`/api/cards/${created[0].id}/move`)
    .send({ direction: 'up' });
  assert.equal(topBoundary.status, 200);
  assert.equal(topBoundary.body.card.moved, false);

  const update = await agent
    .put(`/api/cards/${created[0].id}`)
    .send({
      title: 'A 已更新',
      item_type: 'text_link',
      external_url: 'https://example.com/updated',
    });
  assert.equal(update.status, 200, update.text);
  assert.equal(update.body.card.title, 'A 已更新');
  assert.equal(update.body.card.item_type, 'text_link');
  assert.equal(update.body.card.external_url, 'https://example.com/updated');

  const generationBeforeUnsafeUrl = runtime.generationCount;
  const unsafeUrl = await agent.post('/api/cards').send(
    cardPayload(cardPage.id, 'Unsafe', {
      external_url: 'javascript:alert(document.domain)',
    }),
  );
  assert.equal(unsafeUrl.status, 400);
  assert.equal(unsafeUrl.body.code, 'UNSAFE_EXTERNAL_URL');
  assert.equal(runtime.generationCount, generationBeforeUnsafeUrl);

  const deletion = await agent.delete(`/api/cards/${created[1].id}`);
  assert.equal(deletion.status, 200, deletion.text);
  assert.equal(deletion.body.card.deleted, true);
  const afterDelete = await agent.get(`/api/pages/${cardPage.id}/cards`);
  assert.deepEqual(
    afterDelete.body.cards.map((card) => card.title),
    ['A 已更新', 'C'],
  );
  assert.deepEqual(afterDelete.body.cards.map((card) => card.sort_order), [0, 1]);

  const missing = await agent.get(`/api/cards/${created[1].id}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'CARD_NOT_FOUND');
});
