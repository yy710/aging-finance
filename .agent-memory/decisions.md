# Decisions

## Stable decisions

- Public traffic is static-first: SQLite and EJS are publish-time dependencies, not visitor request-time dependencies.
- `public-generated/` is replaced only after a complete successful build; failures preserve the previous published site.
- Page hierarchy is data-driven and unlimited in depth; no template may assume exactly three levels.
- Public base paths are centralized through `publicUrl()`/`pageUrl()` and `PUBLIC_BASE_PATH`; production is `/af`.
- Asset cache busting uses content hashes, not manually edited version numbers.
- Mobile classroom cards remain two columns at 72.2222% canvas width; the mobile breakpoint must not collapse them to one column, and entry titles use compact Heiti typography.
- `image-only` pages render one processed image plus the standard parent-page return icon; they still omit visible title, decoration, body, cards, and footer.
- Mobile-page uploads are normalized server-side to PNG with maximum width 720px and are never enlarged.
- Every non-home public template must navigate through the explicit parent URL exposed by the shared return-button partial; browser-history interception is forbidden because it can diverge from the page tree. The home page is the only page without a parent.
- The shared return control is a fixed viewport overlay at the safe upper-right edge with a responsive inset capped at 16px; scrolling must not change its viewport coordinates, and desktop positioning remains aligned to the centered 720px canvas.
- The shared return icon is `public-assets/images/global/back.png`, normalized from the supplied gold source to the legacy 92×93 pixel dimensions while preserving transparency.
- Classroom image cards show the stored entry title below each image while preserving the two-column layout.
- The standard footer copyright is“中国工商银行云南省分行 · 养老金融与资产托管部”; database version 3 migrates blank and legacy default values without overwriting unrelated custom text.
- Entry link selection is one UI choice: internal page, external link, or unset. External URL input is visible and required only for the external choice.
- The entry target selector defaults to direct children of the current page; users may disable the filter to see all pages. Existing targets outside the filter must remain selectable while editing.
- `develop` remains tracked against GitHub `origin/develop`; Gitee is a mirror remote, not the default upstream.
- Credentials are never embedded in remote URLs or shared memory.
- Production static generation is explicit and safe by default: `npm run generate` publishes `/af` URLs; root-prefix generation requires the deliberately named `npm run generate:root`.
- Dependency install scripts are deny-by-default under current npm behavior; only the reviewed, pinned `better-sqlite3@12.11.1` native install script is approved in `package.json`. Blanket approvals are forbidden.
- A native dependency installation is not accepted based on npm's summary alone; a real `better-sqlite3` in-memory query must pass before PM2 is restarted.
- Immutable asset URLs are content contracts. If an HTTP cache serves bytes that do not match the version hash, publish a new content hash rather than reusing or overwriting the poisoned URL.

Provenance: source_agent=Codex; updated=2026-07-30; commits=c2084ad,96d17fd,9d08bb7,1566659,3679a65,07947c7,c41867b.
