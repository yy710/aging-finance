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

## Classroom titles, image-only return navigation, and legacy footer text

- Symptoms:养老课堂 image cards did not render `card.title`; `image-only` omitted the shared return control; existing SQLite settings retained the old department name.
- Fix: render `visual-card__title` for the classroom layout, include the shared return-button partial in `image-only`, and migrate the legacy/blank copyright value at database version 3.
- Asset fix: `public-assets/images/global/back.jpg` is actually a 1216×1241 RGBA PNG despite its extension. It is normalized into the source-controlled `public-assets/images/global/back.png` at the legacy 92×93 dimensions, so clean generation can version and publish the gold return icon without relying on an old generated snapshot.
- Verification: 16/16 tests, `/af` generation of 24 pages and 82 hashed assets, desktop and 430×932 browser checks, explicit text-page return navigation, and clean console.

## Top-level “惠” page could not reliably return to home

- Symptom: the shared return button used `history.back()` for same-origin visits, so browser history could send the “惠” page back to a child, preview, or unrelated page instead of its database parent.
- Fix: remove browser-history interception and always follow the pre-rendered parent-page `href`; top-level sections now deterministically return to `/af/`.
- Regression coverage: generated client JavaScript must not call `history.back()`/`history.go()`, top-level section HTML must link to `/`, and browser QA must exercise a child → “惠” → home chain.
- Verification: 17/17 tests, `/af` generation of 24 pages and 83 hashed assets, and 430×932 browser navigation through tertiary page → classroom → “惠” → home with no broken images, overlays, warnings, or errors.

## Fixed return overlay was covered by scrolling content

- Symptom during QA: `position: fixed` preserved the button coordinates, but the button could render below classroom cards because `page-header` created a lower stacking context.
- Fix: keep the button at z-index 30 and remove the header's independent stacking context with `z-index: auto`; wide-screen right positioning remains aligned to the centered 720px canvas.
- Verification: mobile scroll from 0 to 356px and desktop scroll from 0 to 400px produced zero top/right coordinate drift, hit testing selected the return link, parent navigation worked, and console/image/overlay checks were clean.

## Production regeneration removed the `/af` resource prefix

- Symptom: after running plain `npm run generate` on the production server, generated HTML referenced `/assets/...` instead of `/af/assets/...`; CSS and every image then failed behind the `/af` Nginx subpath.
- Cause: the command-line generator defaulted to the root deployment while the PM2-managed admin publisher used `PUBLIC_BASE_PATH=/af`.
- Fix: make `npm run generate` explicitly pass `--public-base-path /af`, retain `npm run generate:root` for direct local Express use, and default production runtime configuration to `/af` unless an explicit override is supplied.
- Admin visibility: publication responses and the success message now report the public path used for the snapshot.
- Verification: 18/18 tests, both root and `/af` command paths, 24 pages and 83 assets, production-style browser rendering at 1280×800 and 378×834, zero failed images or console warnings/errors, and `/af/` → `/af/hui/` navigation.

Provenance: source_agent=Codex; updated=2026-07-30.
