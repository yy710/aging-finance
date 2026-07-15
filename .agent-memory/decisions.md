# Decisions

## Stable decisions

- Public traffic is static-first: SQLite and EJS are publish-time dependencies, not visitor request-time dependencies.
- `public-generated/` is replaced only after a complete successful build; failures preserve the previous published site.
- Page hierarchy is data-driven and unlimited in depth; no template may assume exactly three levels.
- Public base paths are centralized through `publicUrl()`/`pageUrl()` and `PUBLIC_BASE_PATH`; production is `/af`.
- Asset cache busting uses content hashes, not manually edited version numbers.
- Mobile classroom cards remain two columns; the mobile breakpoint must not collapse them to one column.
- `image-only` pages render only one processed image and no visible title, navigation, decoration, body, cards, or footer.
- Mobile-page uploads are normalized server-side to PNG with maximum width 720px and are never enlarged.
- Entry link selection is one UI choice: internal page, external link, or unset. External URL input is visible and required only for the external choice.
- The entry target selector defaults to direct children of the current page; users may disable the filter to see all pages. Existing targets outside the filter must remain selectable while editing.
- `develop` remains tracked against GitHub `origin/develop`; Gitee is a mirror remote, not the default upstream.
- Credentials are never embedded in remote URLs or shared memory.

Provenance: source_agent=Codex; updated=2026-07-15; commits=c2084ad,96d17fd,9d08bb7.
