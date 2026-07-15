# Current State

- Date: 2026-07-15
- Source agent: Codex
- Branch: `develop`, upstream `origin/develop`
- HEAD before current public-page fixes: `d021a5181ad0ed0ab950662e70b607930a318c47`
- Remote state at that commit: GitHub `origin/develop` and Gitee `gitee/develop` matched local HEAD.
- Latest delivered features:
  - retirement classroom mobile card grid remains two columns (`c2084ad`);
  - `image-only` mobile page template and server-side PNG normalization (`96d17fd`);
  - unified entry link selector, conditional external URL field, and default direct-child filter (`9d08bb7`).
  - classroom entry titles, return icons on every non-home template, and the new footer department name (`1566659`).
  - supplied gold return artwork normalized into a source-controlled 92×93 transparent PNG and used by every shared return button (`1566659`).
- Verification baseline: `git diff --check` and `npm test` passed; 17/17 tests. `PUBLIC_BASE_PATH=/af npm run generate` produced 24 pages and 83 hashed assets. Browser QA covered desktop and 430×932 classroom layouts, six visible entry titles, text-page return navigation, image-only return placement, footer text, the new 92×93 gold return asset, preserved two-column layout, and console health.
- Current public-page fixes, tests, documentation, and memory updates were committed as `1566659`.
- Secrets: none recorded. Gitee credentials and local admin credentials must remain outside the repository.
