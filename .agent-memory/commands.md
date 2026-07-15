# Commands

## Setup and local run

```bash
npm ci
npm run init-db
npm run generate
npm start
```

Local admin: `http://127.0.0.1:3100/admin/`; health: `http://127.0.0.1:3100/health`.

## Verification

```bash
git diff --check
node --check admin/app.js
npm test
PUBLIC_BASE_PATH=/af npm run generate
```

Current verified test baseline on 2026-07-15: 16 tests, 16 passing, serial execution.

## Production run

```bash
PUBLIC_BASE_PATH=/af npm run generate
pm2 start ecosystem.config.cjs
curl http://127.0.0.1:3100/health
```

## Git mirror

```bash
git push origin develop
git push gitee develop
```

Keep `origin/develop` as the upstream. Authenticate interactively or with a credential helper; never place credentials in the remote URL, documentation, or command history.

Provenance: source_agent=Codex; updated=2026-07-15.
