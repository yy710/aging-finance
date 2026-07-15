# Decisions

## Stable decisions

- Public traffic is static-first: SQLite and EJS are publish-time dependencies, not visitor request-time dependencies.
- `public-generated/` is replaced only after a complete successful build; failures preserve the previous published site.
- Page hierarchy is data-driven and unlimited in depth; no template may assume exactly three levels.
- Public base paths are centralized through `publicUrl()`/`pageUrl()` and `PUBLIC_BASE_PATH`; production is `/af`.
- Asset cache busting uses content hashes, not manually edited version numbers.
- Mobile classroom cards remain two columns; the mobile breakpoint must not collapse them to one column.
- `image-only` pages render one processed image plus the standard parent-page return icon; they still omit visible title, decoration, body, cards, and footer.
- Mobile-page uploads are normalized server-side to PNG with maximum width 720px and are never enlarged.
- Every non-home public template must expose an explicit parent URL through the shared return-button partial; the home page is the only page without a parent.
- The shared return icon is `public-assets/images/global/back.png`, normalized from the supplied gold source to the legacy 92×93 pixel dimensions while preserving transparency.
- Classroom image cards show the stored entry title below each image while preserving the two-column layout.
- The standard footer copyright is“中国工商银行云南省分行 · 养老金融与资产托管部”; database version 3 migrates blank and legacy default values without overwriting unrelated custom text.
- Entry link selection is one UI choice: internal page, external link, or unset. External URL input is visible and required only for the external choice.
- The entry target selector defaults to direct children of the current page; users may disable the filter to see all pages. Existing targets outside the filter must remain selectable while editing.
- `develop` remains tracked against GitHub `origin/develop`; Gitee is a mirror remote, not the default upstream.
- Credentials are never embedded in remote URLs or shared memory.

Provenance: source_agent=Codex; updated=2026-07-15; commits=c2084ad,96d17fd,9d08bb7; pending=current public-page fixes.
