'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

const { createTestRuntime, readManifest } = require('./helpers/runtime');

async function listRelativeFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      result.push(
        ...(await listRelativeFiles(path.join(directory, entry.name), relative)),
      );
    } else {
      result.push(relative);
    }
  }
  return result;
}

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const requestHandle = http.get({
      host: '127.0.0.1',
      port,
      path: requestPath,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    requestHandle.on('error', reject);
  });
}

test('public static hosting cannot expose config, templates, database, or source CSS', async (t) => {
  const runtime = await createTestRuntime(t, { realGenerator: true });
  const privatePaths = [
    '/config/private.json',
    '/config/private.example.json',
    '/views/home.ejs',
    '/data/site.db',
    '/server/database.js',
    '/assets/css/site.css.ejs',
  ];

  for (const publicPath of privatePaths) {
    const response = await request(runtime.app).get(publicPath);
    assert.equal(response.status, 404, `${publicPath} must not be public`);
    assert.doesNotMatch(response.text, /must-never-be-public/);
    assert.doesNotMatch(response.text, /CREATE TABLE IF NOT EXISTS/);
  }

  const generatedFiles = await listRelativeFiles(runtime.generatedDir);
  assert.equal(generatedFiles.some((name) => name.endsWith('.ejs')), false);
  assert.equal(generatedFiles.some((name) => name.endsWith('.db')), false);
  assert.equal(generatedFiles.some((name) => name.includes('private.json')), false);

  const manifest = await readManifest(runtime);
  const cssHash = manifest['/assets/css/site.css'];
  const compiledCss = await request(runtime.app).get(
    `/assets/css/site.css?v=${cssHash}`,
  );
  assert.equal(compiledCss.status, 200);
  assert.equal(
    compiledCss.headers['cache-control'],
    'public, max-age=31536000, immutable',
  );
  assert.match(compiledCss.text, /background-image: var\(--middle-texture\)/);

  const home = await request(runtime.app).get('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers['cache-control'], 'no-cache');

  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  for (const unsafePath of [
    '/assets/../index.html?v=deadbeef',
    '/uploads/../index.html?v=deadbeef',
    '/_assets/%2e%2e/index.html?v=deadbeef',
  ]) {
    const traversal = await rawRequest(port, unsafePath);
    assert.equal(traversal.status, 404, unsafePath);
    assert.equal(traversal.headers['cache-control'], 'no-cache');
    assert.notEqual(
      traversal.headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
  }

  const missingVersionedAsset = await request(runtime.app).get(
    '/uploads/not-published.png?v=deadbeef',
  );
  assert.equal(missingVersionedAsset.status, 404);
  assert.equal(missingVersionedAsset.headers['cache-control'], 'no-cache');
});
