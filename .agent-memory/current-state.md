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
- Classroom compaction, deterministic page-tree return navigation, and the safe-area-aware fixed return overlay were committed as `2dd9049`.
- Verification for `2dd9049`: `npm test` passed 17/17 and `/af` generation produced 24 pages with 83 hashed assets. Browser QA covered 430×932 and 1280×800 classroom typography, tertiary page → classroom → “惠” → home navigation, approximately 9.6px mobile and 16px desktop upper-edge positioning, zero coordinate drift after 356px/400px scrolling, correct hit testing, and clean console/image/overlay state.
- Secrets: none recorded. Gitee credentials and local admin credentials must remain outside the repository.

## 2026-07-30 homepage welcome modal

- Source agent: Codex.
- Status: implemented and verified; included in the homepage welcome-modal delivery.
- The home page now automatically displays `public-assets/images/home/welcome-modal.png`. The whole image is a dismiss control. A 2026-07-30 follow-up slows the entrance to 1200ms and makes the image grow from 35% through a 108% overshoot before settling at full size; the exit lasts 380ms. Reduced-motion users get an effectively immediate transition.
- Reference fidelity at a 378×834 viewport: the settled modal measured 347.8×280.8px at top 310px and left 15.1px, matching `resources/首页弹窗设计图.png`.
- Browser QA verified automatic display, scroll locking while open, click-to-close after the exit animation, restored scrolling afterward, desktop fit at 1280×800, loaded imagery, meaningful DOM content, and no console warnings or errors.
- Follow-up animation QA measured the image at about 55.7% scale during the early pop phase, then confirmed the original 347.8×280.8px mobile and 662×534.5px desktop settled sizes, successful click dismissal, and clean console output.
- The repository root `resources/` directory is intentionally ignored; supplied design references stay local and are not included in commits or remote pushes.
- Verification baseline: `git diff --check`, `node --check public-assets/js/site.js`, and `npm test` passed (17/17). `PUBLIC_BASE_PATH=/af npm run generate` produced 24 pages and 84 hashed assets.
- Secrets: none recorded.
