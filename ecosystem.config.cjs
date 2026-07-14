const path = require('node:path');

// 部署时将 APP_ROOT 设置为项目的绝对路径，或直接替换下面的示例路径。
const appRoot = process.env.APP_ROOT || '/www/wwwroot/www.all2key.cn/aging-finance';

module.exports = {
  apps: [
    {
      name: 'aging-finance',
      script: 'server/index.js',
      cwd: appRoot,
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 15000,
      time: true,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3100',
        PUBLIC_BASE_PATH: '/af',
        COOKIE_SECURE: 'true',
      },
      error_file: path.join(appRoot, 'logs', 'pm2-error.log'),
      out_file: path.join(appRoot, 'logs', 'pm2-out.log'),
      merge_logs: true,
    },
  ],
};
