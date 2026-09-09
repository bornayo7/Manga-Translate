# Overhaul implementation evidence

The user approved the complete plan on September 9, 2026: continue on `thermo`, keep the extension primary, and integrate into the existing default `main` after verification. Starting source: `172c2d2`; review checkpoint: `ff9f7ba`. [PR #2](https://github.com/bornayo7/Manga-Translate/pull/2) records the current integration and checks.

## Implemented milestones

| Checkpoint | Result |
|---|---|
| `13cf85d` | Durable serialized storage, opaque preparation revisions, strict shared contracts, reader cleanup and truncated-answer rejection; 67 focused tests. |
| `b281a90` | Bounded OCR runtime, decoder-before-model admission, aligned outcomes, fail-fast setup and pinned core/OCR2/OCR3 profiles. |
| `9a67d3e` | Explicit failed/skipped/echoed regions and malformed MyMemory payloads cannot become translated text. |
| `6a87bfd` | Per-image sessions, bounded preparation cache, public lifecycle tests, trusted preparation and MV3 request/page/offscreen ownership. |
| `e1c0af2` | Reading-focused popup/site, durable UI acknowledgment, cancellable demo, speech generations, install route, transcript and original comparison panel. |
| `f499312` | Real Chromium/Tesseract runners, image pixel admission and deterministic browser CI. |
| `b4a6f05` | Official provider catalog qualification, three retired Gemini preview migrations and corrected CI runner configuration. |
| `165a19b` | Lifecycle tests await observable milestones, including delayed native hashing; browser acceptance distinguishes failed paint from empty OCR. |
| `64a3d3b` | Installation guide selects the manifest directory; the production browser asserts the exact path at all four viewport widths. |

All 27 review findings have explicit dispositions in [ACCEPTANCE.md](ACCEPTANCE.md). The old audit ledgers remain historical snapshots; their earlier labels do not substitute for this evidence.

## Validation

- Extension: **229 tests** pass on Node 20.19 and Node 24; the production build passes. Delayed native hashing also passes all 19 lifecycle tests. Real Chromium has **9 scenario groups**, with fixtures for duplicate images, mutations/currentSrc/canvas changes, fit/resize, outcomes, cancellation, worker recreation and popup behavior.
- Website: **16 tests**, lint, TypeScript and production build pass. Its portable browser runner records **23 cases/groups**, including 20 public route/viewport combinations, truthful partial/error results and one live OCR3→MyMemory→PNG fixture.
- Backend: fresh Python 3.12 development install passes **76 tests**, with **8 explicit live-model skips**. Separate OCR2 and OCR3 environments each pass **8 real-image cases**; all three pass `pip check`.
- Bundled Tesseract: real English, Japanese and default combined language recognition, cancellation, queued reuse, production 60-second idle teardown and recreation pass. Japanese smoke recognition duplicated one glyph; it is not an exact-accuracy certification.
- Remote CI first exposed timing assumptions in two Node 20 lifecycle tests and a browser-job context error. The harness now waits for actual provider/decode milestones instead of event-loop spin counts. Four-job CI (backend, extension, website, installed browser) passed on `165a19b` ([run 34413372660](https://github.com/bornayo7/Manga-Translate/actions/runs/34413372660)); the final candidate is gated again before integration.
- The short ownership lesson has working interactive feedback and a verified 390px layout. No learning achievement is recorded without user evidence.

Detailed reports: [core](core-implementation.md), [backend](backend-implementation.md), [website/popup](website-popup-implementation.md), [provider qualification](provider-qualification.md). The reports include reproduction commands and representative checked-in screenshots.

## Evidence limits

Paid/custom provider and Auth0 account flows, Docker execution, other native OCR platforms/GPU, other Tesseract languages and arbitrary host layouts remain explicitly unverified. Extension Auth0 preference sync, Firefox and wrapper-free overlay changes are deliberately deferred. No unavailable credentials were inferred or read, and no deployment/store publication is claimed.

The final merge uses normal fast-forward history after clean status, exact-diff/ancestry and CI checks. It preserves previous commits and existing branch names. Remote integration evidence is recorded in the PR and project state, rather than treating passing local tests as proof of a completed push.
