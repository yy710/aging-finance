#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_DATABASE_PATH,
  closeDatabase,
  openDatabase,
} = require('../server/database');
const { ContentService, seedExampleData } = require('../server/content-service');

function usage() {
  return [
    '用法: node scripts/init-db.js [选项]',
    '',
    '选项:',
    '  --db <path>       指定 SQLite 文件（默认 data/site.db）',
    '  --reset           删除现有数据库、WAL 和 SHM 后重新初始化',
    '  --no-seed         只创建表，不写入示例数据',
    '  --replace-seed    清空页面和 Card 后重新写入示例数据',
    '  --help            显示帮助',
  ].join('\n');
}

function parseArguments(argv) {
  const options = {
    databasePath: process.env.DB_PATH || DEFAULT_DATABASE_PATH,
    reset: false,
    seed: true,
    replaceSeed: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--db 需要一个文件路径');
      }
      options.databasePath = value;
      index += 1;
    } else if (argument.startsWith('--db=')) {
      options.databasePath = argument.slice('--db='.length);
    } else if (argument === '--reset') {
      options.reset = true;
    } else if (argument === '--no-seed') {
      options.seed = false;
    } else if (argument === '--replace-seed') {
      options.replaceSeed = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知选项：${argument}`);
    }
  }

  if (options.databasePath !== ':memory:') {
    options.databasePath = path.resolve(options.databasePath);
  }
  return options;
}

function removeDatabaseFiles(databasePath) {
  if (databasePath === ':memory:') return;
  for (const filename of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      fs.unlinkSync(filename);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function initializeDatabase(options) {
  if (options.reset) {
    removeDatabaseFiles(options.databasePath);
  }

  const db = openDatabase(options.databasePath);
  try {
    const service = new ContentService(db);
    const result = options.seed
      ? seedExampleData(db, { replace: options.replaceSeed })
      : {
          seeded: false,
          reason: 'seed-disabled',
          pageCount: service.countPages(),
          cardCount: service.countCards(),
        };

    const journalMode = db.pragma('journal_mode', { simple: true });
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    return {
      databasePath: options.databasePath,
      journalMode,
      foreignKeys: foreignKeys === 1,
      ...result,
    };
  } finally {
    closeDatabase(db);
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 1;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  try {
    const result = initializeDatabase(options);
    console.log(`数据库：${result.databasePath}`);
    console.log(`foreign_keys：${result.foreignKeys ? 'ON' : 'OFF'}`);
    console.log(`journal_mode：${result.journalMode}`);
    if (result.seeded) {
      console.log(`示例数据已写入：${result.pageCount} 个页面，${result.cardCount} 个 Card`);
      console.log(`四级示例：${result.fourthLevelExampleUrl}`);
    } else if (result.reason === 'database-not-empty') {
      console.log(`数据库已有数据，跳过种子：${result.pageCount} 个页面，${result.cardCount} 个 Card`);
    } else {
      console.log('已完成数据库结构初始化，未写入示例数据。');
    }
    return 0;
  } catch (error) {
    console.error(`数据库初始化失败：${error.message}`);
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      console.error(error.stack);
    }
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  initializeDatabase,
  main,
  parseArguments,
  removeDatabaseFiles,
  usage,
};
