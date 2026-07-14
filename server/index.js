const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { ContentService } = require('./content-service');
const { openDatabase } = require('./database');
const { createGenerator } = require('./generator');

function createRuntime(overrides = {}) {
  const config = overrides.config || loadConfig(overrides.configOverrides);
  const db = overrides.db || openDatabase(config.dbPath);
  const service = overrides.service || new ContentService(db);
  const generate = overrides.generate || createGenerator({
    projectRoot: config.rootDir,
    viewsDir: config.viewsDir,
    outputDir: config.generatedDir,
    assetsDir: config.assetsDir,
    uploadsDir: config.uploadsDir,
    database: db,
  });
  const { app, auth } = createApp({
    config,
    service,
    generate,
    authOptions: overrides.authOptions,
  });
  return { app, auth, config, db, service, generate };
}

async function main() {
  const runtime = createRuntime();
  const { app, config, db, generate, service } = runtime;
  if (service.countPages() > 0 && !fs.existsSync(path.join(config.generatedDir, 'index.html'))) {
    await generate();
  }

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(config.port, config.host, () => resolve(instance));
    instance.once('error', reject);
  });
  console.log(`养老金融网站已启动：http://${config.host}:${config.port}`);
  console.log(`管理后台：http://${config.host}:${config.port}/admin/`);

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在安全关闭服务。`);
    const forceTimer = setTimeout(() => process.exit(1), 10_000);
    forceTimer.unref();
    server.close(() => {
      try { if (db.open) db.close(); } catch {}
      clearTimeout(forceTimer);
      process.exit(0);
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return runtime;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`服务启动失败：${error.message}`);
    if (process.env.NODE_ENV !== 'production' && error.stack) console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = { createRuntime, main };
