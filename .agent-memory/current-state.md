# Current State

- Date: 2026-07-15
- Source agent: Codex
- Branch: `develop`, upstream `origin/develop`
- HEAD before documentation update: `9d08bb7477680049e6bf86d1a8329c86cbd2dc62`
- Remote state at that commit: GitHub `origin/develop` and Gitee `gitee/develop` matched local HEAD.
- Latest delivered features:
  - retirement classroom mobile card grid remains two columns (`c2084ad`);
  - `image-only` mobile page template and server-side PNG normalization (`96d17fd`);
  - unified entry link selector, conditional external URL field, and default direct-child filter (`9d08bb7`).
- Verification baseline: `git diff --check`, `node --check admin/app.js`, and `npm test` passed; 16/16 tests. Browser QA covered default child filtering, all-page toggle, external URL visibility/required state, internal target restoration, page identity, and console health.
- Documentation and shared-memory synchronization is complete and verified; use `git log -1` for the commit containing this state snapshot.
- Secrets: none recorded. Gitee credentials and local admin credentials must remain outside the repository.
