# TASK_STATE.md

## Current goal

Keep the security/reliability repair green and finish the product decisions that require deployed credentials or browser-specific release work.

## Completed implementation targets

### A. Add reusable context files
Add these files so Codex and Claude do not have to rediscover the repo every session:

- `AGENTS.md`
- `REPO_MAP.md`
- `PIPELINES.md`
- `TASK_STATE.md`
- `DECISIONS.md`

### B. Canonical shared preferences module
Implemented:
- `lensmu/extension/shared/preferences.js`

Reason:
The website already imports `../../extension/shared/preferences.js` from:
- `lensmu/website/lib/preferences-schema.ts`
- `lensmu/website/lib/preferences-store.ts`

That path should become real and authoritative.

### C. Normalize extension storage
Reads, writes, and change listeners use the `vt_settings` object. Provider secrets are local-only and are removed from all content-script messages.

### D. Audit repair
The deterministic audit findings are fixed: bounded image/MangaOCR requests, serialized Tesseract, reversible page styles, safe logging, robust text chunking, opt-in public fallback, request timeouts, transactional activation, CI, and stale setup targets.

### E. Review pass 2026-09-01
Second full read of the tree with every suite run first. Fixed a blocker that
made `npm test` exit 1 and broke all translation (duplicate
`translateWithMyMemory` declaration in `translate/libre-translate.js`), plus
three more defects: a MangaOCR bbox the backend rejects by construction,
dropped MutationObserver src-change invalidations, and `_polygon_to_bbox`
truncating instead of containing. Swept duplicated helpers into
`extension/shared/text.js`, removed ~15 dead symbols, two dead website files
and 66 lines of dead popup CSS. See `AUDIT.md` for the full table, including
what was deliberately left open.

## Success criteria

1. Keep extension tests/build, website lint/typecheck/build, and backend tests green in CI.
2. Configure Auth0 audience/scopes before enabling preference sync.
3. Add a Firefox-specific manifest and real-browser coverage before restoring Firefox claims.
4. Run real PaddleOCR/MangaOCR and provider smoke tests with local credentials.
