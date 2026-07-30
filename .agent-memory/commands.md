# Commands

## Setup and local run

```bash
npm ci
npm run init-db
npm run generate:root
npm start
```

Local admin: `http://127.0.0.1:3100/admin/`; health: `http://127.0.0.1:3100/health`.

## Verification

```bash
git diff --check
node --check admin/app.js
npm test
npm run generate
```

Current verified test baseline on 2026-07-30: 18 tests, 18 passing, serial execution; production generation produced 24 example pages and 83 hashed assets.

## Production run

```bash
npm ci --omit=dev
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log(db.prepare('select 1 AS ok').get()); db.close();"
npm run generate
APP_ROOT=/www/wwwroot/aging-finance pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
curl http://127.0.0.1:3100/health
```

`package.json` pins install-script approval to `better-sqlite3@12.11.1`; do not approve all dependency scripts. After installation, verify the native binding with `node -e "new (require('better-sqlite3'))(':memory:').close()"`.

For PM2 502, `/af` path, native binding, or immutable cache diagnosis, follow `docs/home-v2-production-repair-2026-07-30.md`. A momentary PM2 `online` state is insufficient; confirm a stable PID, non-increasing restart count, and HTTP 200 from `/health`.

## Git mirror

```bash
git push origin develop
git push gitee develop
```

Keep `origin/develop` as the upstream. Authenticate interactively or with a credential helper; never place credentials in the remote URL, documentation, or command history.

Provenance: source_agent=Codex; updated=2026-07-30.
