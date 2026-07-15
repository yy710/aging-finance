# Bugs and Fixes

## Mobile classroom cards collapsed to one column

- Symptom: the retirement classroom card list became a single narrow column on mobile.
- Fix: preserve a two-column grid at the mobile breakpoint.
- Verified commit: `c2084ad`.

## Single-image mobile pages inherited normal page chrome

- Requirement: a managed page must display exactly one uploaded image with no other public decoration.
- Fix: added the `image-only` template, database migration, template-aware admin fields, and Sharp processing to PNG at maximum 720px width.
- Verification: migration, upload, rendering, and publication tests pass.
- Verified commit: `96d17fd`.

## Entry destination editor exposed two competing controls

- Symptom: internal-page and external-URL fields were always visible, and the internal page list was unnecessarily long.
- Fix: unified the choice under “设置点击链接”, conditionally show/require the external URL field, and default-filter to the current page's direct children with an all-pages toggle.
- Compatibility: an existing target outside the filter is appended while editing so it cannot be cleared accidentally.
- Verification: full test suite 16/16 plus browser interaction and clean console.
- Verified commit: `9d08bb7`.

## Local `/af/admin/` direct-port QA returns 404

- Cause: production Nginx strips `/af` before proxying; Express internally registers `/admin/` and `/api/`.
- Correct local QA: start without `PUBLIC_BASE_PATH` and open `http://127.0.0.1:3100/admin/`, or test the full `/af` URL through the configured reverse proxy.
- This is deployment topology, not an application route regression.

Provenance: source_agent=Codex; updated=2026-07-15.
