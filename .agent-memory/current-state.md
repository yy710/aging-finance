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
- Current uncommitted UI adjustment compacts the classroom grid to 72.2222% width and changes entry titles to smaller Heiti typography. `npm test` passed 17/17 and `/af` generation produced 24 pages with 83 hashed assets. Browser QA passed at 430×932 (144px cards, 12px titles) and 1280×800 (250px cards, 20px titles), including entry navigation, image loading, overlay checks, and warning/error console checks.
- Current uncommitted navigation fix removes browser-history interception from public return buttons so every click follows the generated page-tree parent URL. `npm test` passed 17/17, `/af` generation produced 24 pages and 83 hashed assets, and 430×932 browser QA passed the full tertiary page → classroom → “惠” → home chain with clean console and asset loading.
- Current uncommitted UI adjustment fixes the shared return button to the viewport upper-right as a z-index 30 overlay while retaining centered-canvas alignment on wide screens. Final `npm test` passed 17/17; `/af` generation produced 24 pages and 83 hashed assets. Browser QA confirmed zero coordinate drift after 356px mobile and 400px desktop scrolling, correct hit-test visibility, parent navigation, and clean console/image/overlay state.
- Current uncommitted position refinement moves the fixed return control from the content area to a safe-area-aware inset capped at 16px, reducing content overlap while preserving canvas alignment. Browser QA measured approximately 9.6px visible top/right gaps at 430×600 and a 16px top inset at 1280×800; 356px/400px scrolling produced zero coordinate drift, hit testing and parent navigation passed, and console/image/overlay checks were clean.
- Secrets: none recorded. Gitee credentials and local admin credentials must remain outside the repository.
