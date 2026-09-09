# TASK_STATE.md

## Current work

The approved overhaul has been implemented on `thermo`. The existing default branch is `main`; no `master` branch exists. Preserve the original thermo history and branch names. [PR #2](https://github.com/bornayo7/Manga-Translate/pull/2) records the current integration and exact checks.

## Verified implementation — 2026-09-09

- All 27 findings from the 150-file review have implemented repairs and regression evidence. [Acceptance report](docs/ACCEPTANCE.md) distinguishes fixed behavior from unverified external routes.
- Pushed milestones: `13cf85d` storage/provider contracts, `b281a90` OCR runtime/profiles, `9a67d3e` region truth, `6a87bfd` image/MV3 ownership, `e1c0af2` UI sessions/design, `f499312` browser/pixel admission, `b4a6f05` provider migration/CI configuration, `165a19b` lifecycle timing and expanded browser coverage, `64a3d3b` verified installation instructions.
- Local checks: 229 extension tests/build; 16 website tests/lint/typecheck/build; fresh backend 76 tests with 8 opt-in skips. Each OCR profile passes 8 real-model cases. Chromium extension 9 groups; website 23 groups; real bundled Tesseract lifecycle and one live MyMemory export verified.
- CI has four jobs, including installed-extension browser acceptance. Node 20 timing assumptions discovered remotely were reproduced using delayed real WebCrypto and repaired in the public test harness. [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md) and the PR retain the evidence.
- Original main `bbe553c` and thermo source `172c2d2` are preserved in history. Integration requires clean exact status/diff, remote ancestry and passing candidate CI, with a normal fast-forward/push and verification of the resulting remote main.

## Remaining qualification

Authenticated OpenAI/Claude/Gemini/custom/Google Vision/ElevenLabs and Auth0 flows; Docker execution; Linux/macOS native OCR/GPU; additional language/host-layout/assistive-technology fixtures. Official docs support the offered model catalog; that does not prove live account access. Extension preference sync, Firefox and wrapper-free rendering are deliberately deferred. No source-edit or routine verified checkpoint confirmation remains outstanding.

## Historical implementation checkpoints

The sections below describe earlier passes. Their completion claims are historical and do not close the newly reproduced findings in `CODEBASE_REVIEW.md`.

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

### F. Review pass 2026-09-06
Third full read, suites green on entry. 29 one-finding commits on
`review/2026-09-06-bug-sweep`: the backend froze every request (including
`/health`) for the whole first PaddleOCR model load; the default LLM model
and most of the Claude/Gemini picker were shut down or retired upstream
(now `shared/llm-models.js`, checked against the providers' model pages);
backend error text never reached the user; MangaOCR requests failed whole
on one bad box; a trailing slash in the backend URL 404ed everything; a
cleared number field flooded pages with translate icons; the LLM response
parser shifted translations onto the wrong bubbles; Gemini refusals and
MyMemory quota exhaustion were reported as "no translated text"; plus a
dozen smaller fixes and a documentation sweep. Backend tests 29 → 45,
extension tests 16 → 48. Full table in `AUDIT.md`.

### G. Branch integration verification 2026-09-06
The review branch includes both the previous `main` (`b550dbc`) and
`audit/deep-repair` (`6a11600`), so all branch work can be consolidated by
fast-forward without conflict resolution or dropping commits.

The pre-merge GitHub CI run `34017765526` exposed a website lockfile issue
that the earlier local builds missed: npm 10.8.2 rejected `npm ci` because
the optional `@emnapi/core` and `@emnapi/runtime` peer entries were missing.
Regenerated the lockfile with that npm version; existing package versions
are unchanged. Verified a Linux-targeted clean-install dry run, an actual
clean install, website lint/typecheck/build, extension 48/48 tests and build,
and backend 45 tests locally. Live OCR/provider checks remain outstanding.

### H. Review of the review pass 2026-09-07
The merged 29-commit diff was reviewed from ten angles with every candidate
verified against the code, then swept for gaps: 22 candidates, 20 confirmed,
2 refuted. Eleven follow-up commits on `main` (table in the 2026-09-07
subsection of `AUDIT.md`): a 2xx with malformed JSON no longer reads as an
empty page; an empty LLM reply now throws for every provider so the opt-in
fallback engages; the response parser no longer mistakes list items or
decimals for markers; the website demo shares the extension's MyMemory
handling, box filter and error formatting; pydantic prefixes are stripped
from notices; numeric settings are range-clamped and base URLs normalised on
merge; plus test-suite speedups and de-duplication. Extension tests 48 → 56,
backend 45 → 46. All suites green.

## Success criteria

1. Keep extension tests/build, website lint/typecheck/tests/build, backend tests and installed-extension browser acceptance green in CI.
2. Configure Auth0 audience/scopes before enabling preference sync.
3. Add a Firefox-specific manifest and real-browser coverage before restoring Firefox claims.
4. Extend the qualified real OCR matrices to more platforms and languages; qualify authenticated providers using explicitly configured local credentials.
