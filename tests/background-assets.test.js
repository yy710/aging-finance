'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

const backgrounds = {
  home: '首页背景.png',
  hui: '二级页面_惠字背景.png',
  yi: '二级页面_医字背景.png',
  yang: '二级页面_养字背景.png',
  le: '二级页面_ 乐字背景.png',
  chuan: '二级页面_传字背景.png',
};

function readPngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function dimensions(relativePath) {
  return readPngDimensions(await fs.readFile(path.join(projectRoot, relativePath)));
}

test('theme background slices cover every row of each original background', async () => {
  for (const [theme, sourceName] of Object.entries(backgrounds)) {
    const source = await dimensions(path.join('resources', sourceName));
    const top = await dimensions(path.join('public-assets', 'images', 'decor', `${theme}-top.png`));
    const middle = await dimensions(path.join('public-assets', 'images', 'decor', `${theme}-middle.png`));
    const bottom = await dimensions(path.join('public-assets', 'images', 'decor', `${theme}-bottom.png`));

    assert.deepEqual(source, { width: 720, height: 1560 }, `${theme} source dimensions`);
    assert.deepEqual(top, { width: 720, height: 480 }, `${theme} top dimensions`);
    assert.deepEqual(middle, { width: 720, height: 576 }, `${theme} middle dimensions`);
    assert.deepEqual(bottom, { width: 720, height: 504 }, `${theme} bottom dimensions`);
    assert.equal(top.height + middle.height + bottom.height, source.height, `${theme} row coverage`);
  }
});

test('shared return icon preserves the legacy display dimensions', async () => {
  assert.deepEqual(
    await dimensions(path.join('public-assets', 'images', 'global', 'back.png')),
    { width: 92, height: 93 },
  );
});
