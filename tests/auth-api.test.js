'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { COOKIE_NAME, verifyToken } = require('../server/auth');
const {
  TEST_COOKIE_SECRET,
  TEST_PASSWORD,
  createTestRuntime,
} = require('./helpers/runtime');

test('admin API requires a valid signed login cookie and logout clears it', async (t) => {
  const runtime = await createTestRuntime(t);

  const anonymous = await request(runtime.app).get('/api/pages');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers['cache-control'], 'no-store');

  const wrongPassword = await request(runtime.app)
    .post('/api/auth/login')
    .send({ password: 'definitely-wrong' });
  assert.equal(wrongPassword.status, 401);

  const agent = request.agent(runtime.app);
  const loginResponse = await agent
    .post('/api/auth/login')
    .send({ password: TEST_PASSWORD });
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(loginResponse.body, { ok: true });

  const setCookies = loginResponse.headers['set-cookie'];
  assert.ok(Array.isArray(setCookies) && setCookies.length > 0);
  const adminCookie = setCookies.find((value) =>
    value.startsWith(`${COOKIE_NAME}=`),
  );
  assert.ok(adminCookie, 'login must set the named admin cookie');
  assert.match(adminCookie, /; HttpOnly(?:;|$)/i);
  assert.match(adminCookie, /; SameSite=Strict(?:;|$)/i);
  assert.match(adminCookie, /; Path=\/(?:;|$)/i);

  const token = decodeURIComponent(
    adminCookie.slice(`${COOKIE_NAME}=`.length).split(';')[0],
  );
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(verifyToken(token, TEST_COOKIE_SECRET), true);

  const authenticatedStatus = await agent.get('/api/auth/status');
  assert.equal(authenticatedStatus.status, 200);
  assert.equal(authenticatedStatus.body.authenticated, true);

  const authorized = await agent.get('/api/pages');
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.pages.length, 1);

  const replacement = token.endsWith('a') ? 'b' : 'a';
  const tampered = `${token.slice(0, -1)}${replacement}`;
  const tamperedResponse = await request(runtime.app)
    .get('/api/pages')
    .set('Cookie', `${COOKIE_NAME}=${tampered}`);
  assert.equal(tamperedResponse.status, 401);

  const logoutResponse = await agent.post('/api/auth/logout');
  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(logoutResponse.body, { ok: true });
  assert.ok(
    logoutResponse.headers['set-cookie'].some((value) =>
      value.startsWith(`${COOKIE_NAME}=`) && /Expires=Thu, 01 Jan 1970/i.test(value),
    ),
  );

  const afterLogout = await agent.get('/api/pages');
  assert.equal(afterLogout.status, 401);
});
