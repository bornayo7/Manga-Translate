# Codebase review — 2026-09-09

**Verdict: request changes before merging `thermo`.** The current checks pass, but deterministic probes reproduce lost settings, incorrect image ownership, stale overlays, and false success. These require behavioral repairs before the larger structural and visual overhaul.

Reviewed source: `thermo` at `172c2d2c9fd297304956bb634bab1877a377db47`. Comparison: `main` at `bbe553c32ef9ecd46f089a62f53a0b3eb3b75460`. All source references below refer to that reviewed snapshot, before implementation. The review itself changes documentation only.

## Scope and evidence

The review covered all 150 tracked first-party text files, 27,811 lines, across extension, backend, website, tests, configuration and project documentation. Work was divided into independent extension-core, website/popup, backend/tooling and remaining extension/shared audits. Every assigned text file was read completely. The coverage manifest records paths, hashes, reader groups and exclusions. Dependency lockfiles, generated declarations, vendored libraries and binary assets were excluded from full source review. Existing installed dependencies were used for validation; this was not a fresh-install or dependency-security audit.

Detailed findings and reproduction outputs:

- [Extension core](docs/reviews/2026-09-09/extension-core.md)
- [Website and popup](docs/reviews/2026-09-09/website-popup.md)
- [Backend and setup](docs/reviews/2026-09-09/backend.md)
- [File coverage](docs/reviews/2026-09-09/coverage.json)
- [Implementation and integration plan](OVERHAUL_PLAN.md)

### Checks actually completed

| Area | Result | What it establishes |
| --- | --- | --- |
| Extension | 173/173 tests; production build passed | Current automated contracts and bundling |
| Website | 5/5 tests; lint, typecheck and production build passed | Build/static checks; tests cover auth-error mapping |
| Backend | 53 passed, 1 skipped | Mocked engine/API behavior; real Paddle smoke skipped |
| Browser | Local production website inspected at desktop, 390px and 820px | Navigation defects reproduced; initial demo UI inspected |
| Git | Clean source tree; `git diff --check` passed | No incidental source changes from checks |

The environment used Node 24.11.1/npm 11.6.2 and Python 3.12.10. CI targets Node 20.19/Python 3.12, so clean CI remains a separate gate. Real PaddleOCR/PaddlePaddle/MangaOCR packages were not installed. No OCR models were downloaded and no live translation, Auth0 login, installed-extension session, or Docker run was performed. No claim of end-to-end release readiness follows from these passing suites.

### Requested skills

Ran all three requested `npx skills use` commands for `mattpocock/skills` (`grill-with-docs`, `teach`) and `anthropics/skills` (`frontend-design`). Each exited successfully; complete redirected output and referenced supporting formats were read using the returned supporting directory. The downloaded skills already existed under the local Codex skills directory, and their SKILL.md contents matched after line-ending normalization. No missing named skill remained to install. Also read and applied the named thermo review, codebase-design and merge-conflict skills, and the grilling/domain-modeling dependencies. No merge was in progress. The plan records the pending interview/teaching choices instead of inventing answers or learning progress.

## Findings requiring repair

P1 means common user intent or displayed results can be lost or misrepresented; P2 means a narrower correctness, lifecycle, operability or accessibility defect. These priorities do not imply an internet-facing security emergency. Core findings distinguish new `thermo` regressions from inherited behavior; other findings describe current source unless explicitly attributed.

### Settings and provider requests

| ID | Priority | Evidence and effect | Repair |
| --- | --- | --- | --- |
| W-01 | P1 | `src/popup/settings-persistence.js:59–73,98–101`: a rejected `{targetLanguage:'fr'}` patch is forgotten; subsequent `saveNow()` sends `{}` and resolves, allowing translation using unsaved settings. | Retain unacknowledged intent and make completion refer to the requested revision. |
| W-02 | P1 | Same module `:49–51`: a second edit is not dispatched while the first response is pending, despite `hasPending` becoming false. Popup closure can lose it. | Transfer edits promptly to background-owned persistence; track acknowledgments separately. |
| S-01 | P1 | `utils/storage.js:76–78,94–96`: `getSettings()` catches a read failure and returns defaults; `saveSettings()` then merges a patch into those defaults and writes them. | Authoritative writes must fail if the prior snapshot could not be read. |
| W-07 | P2 | `src/popup/components/ApiKeyInput.jsx:30–43,69`: “Saved”/“Stored” is optimistic and precedes storage acknowledgment. | Bind status to acknowledged revisions. |
| W-08 | P2 | `src/popup/App.jsx:358–373`: health timeout is cleared at headers, before `response.json()`, so a stalled body can leave translation disabled. | Bound the whole response-body lifetime. |
| S-02 | P2 | `translate/llm-translate.js:182–241`: provider stop reason `length` is diagnostic only when numbered markers parse successfully; incomplete final text is accepted. | Treat provider truncation as an incomplete outcome even when every marker exists; bounded retry or explicit failure. |
| S-03 | P2 | `shared/fetch-with-timeout.js:122–125` cancels the body while `shared/response-limits.js` holds its reader; cancellation rejects and is swallowed. | Let the reader owner cancel/release on timeout or abort. |

Paths in this table are relative to `lensmu/extension`. Root-owned probes used actual exported modules and controlled adapters:

- **S-01:** initial settings had a French target and a custom endpoint. A mocked `chrome.storage.local.get` threw while `set` succeeded. Saving only `darkMode:true` persisted `targetLanguage:'en'`, default provider and an empty custom endpoint. This read/merge behavior is also present on `main`.
- **S-02:** two input blocks received `[1] Hello.\n[2] We need to` with stop reason `length`. The real LLM pipeline accepted both translations, `retryCount:0`, one request. No live provider call was made. `main` also treated truncation as a warning; this is an incomplete prior repair.
- **S-03:** a mocked response with a never-ending `ReadableStream` caused the public request to reject with `TimeoutError`, while the underlying cancellation callback remained uncalled and `body.locked` remained true. Caller timeout works; stream cleanup fails in this adapter case. Native fetch abort can cancel its network stream independently, so this probe does not establish a universal native-fetch leak.

### Image lifecycle and rendering

| ID | Priority | Reproduced behavior | Attribution |
| --- | --- | --- | --- |
| EC-01 | P1 | Two distinct images with the same source/dimensions share one render job: both controls say rendered, only the first has an overlay. `content.js:252–260`; queue `:85–94`. | New queue regression |
| EC-02 | P1 | An ordinary image inside an extension wrapper changes `src`; observer ancestor filtering ignores the change and leaves its old overlay. `content.js:2977–2979`. | New observer regression |
| EC-03 | P1 | A queued lower-priority prefetch replaces an explicit click for the same target. `shared/image-work-queue.js:97–99`. | New queue regression |
| EC-04 | P1 | An in-flight visual-settings redraw resumes after deactivation and recreates an overlay. `content.js:2317–2349,3350–3364`. | Inherited, still present |
| EC-05 | P2 | Activation waits for imports, deactivation completes, then activation installs controls/observer while inactive. `content.js:3182–3204`. | New asynchronous boundary |
| EC-06 | P2 | A settings change cancels work, but an immediate click receives its old cancelled promise because the key has no settings revision. `content.js:252–254,3344–3347`. | New queue regression |
| EC-07 | P2 | Addition followed by removal in one observer delivery drops removal cleanup and retains a detached control. `content.js:3051`. | Inherited early exit; incomplete new cleanup |
| EC-08 | P2 | A valid 5×5 region yields `{rendered:0,skipped:1,unfit:0}`, yet content shows successful rendering. `overlay.js:1322–1325`; `content.js:2388–2393`. | Incomplete success-reporting repair |
| EC-09 | P2 | Vertical paint splits an emoji into two surrogate halves after the layout module fitted whole graphemes. `overlay.js:1430–1435`. | Inherited paint defect |

The extension core probes use the production queue/content harness and real renderer where relevant. Their strongest evidence is ownership, ordering and draw-call behavior; they do not substitute for real Chrome DOM/layout acceptance.

### Backend, website and setup

| ID | Priority | Current defect | Evidence boundary |
| --- | --- | --- | --- |
| B-01 | P2 | Windows setup ignores native pip/npm failure exits and can print completion. `setup.ps1:83–96,123–136`. | Safe native-exit probe plus full script read |
| B-02 | P2 | Paddle 3 defaults can rotate/unwarp input while this adapter returns coordinates for an overlay on the original image. `ocr_engines/paddle_ocr.py:73–77,340–345,413–449`. | Constructor probe plus official implementation; no live transformed-page run |
| B-03 | P2 | RGB pixels are passed unchanged to the Paddle BGR ndarray interface. `ocr_engines/paddle_ocr.py:239–248`. | Recorded red-pixel adapter input; accuracy impact unmeasured |
| B-04 | P2 | All Manga model exceptions become empty-text HTTP 200 regions; malformed Paddle results can become no detections. `ocr_engines/manga_ocr.py:241–243`; `server.py:378–384`. | Actual wrapper with fake crashing model |
| B-05 | P2 | Compressed byte limits admit very large decoded images and validation happens after engine initialization. `security.py:18–29`; `server.py:320–326,359–368`. | 23,087-byte 8000×8000 PNG accepted; no large RGB allocation/inference |
| B-06 | P2 | Cancelling the route coroutine releases capacity while its inference thread still runs, allowing overlapping model calls. `server.py:324–326,363–368`. | Direct coroutine-cancellation probe; ordinary browser disconnect not tested |
| B-07 | P2 | Documented Docker mapping publishes the unauthenticated OCR service on all host interfaces. Root/backend README. | Command semantics verified against Docker docs; no live launch |
| W-03 | P2 | Demo returns an unchanged image as successful translation when all regions are too small. `lib/translator.ts:451–456,520`. | Real module/canvas adapter; zero paint calls |
| W-04 | P2 | Malformed OCR HTTP 200 JSON is cast to a type and reported as no text. `lib/translator.ts:198,208,269–302`. | Malformed-success response probe |
| W-05 | P2 | Hidden mobile links remain keyboard targets; expanded menu clips install button; 820px header overflows. `components/layout/Navbar.tsx:55,68,112–118`. | Actual production browser inspection |
| W-06 | P2 | “Get Extension” links only to the generic Chrome store. `components/sections/Hero.tsx:37`; `components/layout/Navbar.tsx:83,164`. | Source and browser link targets |

Backend paths refer to `lensmu/backend`; website paths to `lensmu/website`. The detailed reports preserve official sources, reproduction stimuli and limitations. Additional UI findings there cover contradictory MangaOCR language selection, missing error-color tokens, inaccessible popup controls, console-only failures, demo cancellation, and missing transcript access.

## Structural diagnosis

The most important seam is the lifetime of one image target. Today that lifetime is distributed across parallel maps/sets, a global queue, promise closures, DOM wrappers and optional cancellation checks. Shared image content and distinct DOM targets are conflated. One target owner with an explicit revision should decide whether a result may be displayed; reusable preparation should have a separate bounded cache.

Settings have a similar split: the popup owns pending intent, the background serializes writes, and storage sometimes substitutes defaults for failed reads. Consolidating responsibility around durable revisions removes both lost edits and misleading acknowledgment. Defaults already live in `shared/preferences.js`; the overhaul should extend that canonical contract to validation/migration, not create a competing module.

Display success is inconsistent across the preparation pipeline, layout algorithm, extension renderer and website canvas. A fitted glyph/region plan with explicit outcomes should be consumed by both renderers. It should be impossible to obtain “rendered” from an empty paint result or to reinterpret Unicode differently during painting.

The backend needs one execution owner for admission, model cache/loading, worker completion and outcome validation. Its existing size does not justify a many-layer framework. The website demo needs one cancellable request interface; React should present that request's actual state.

| File | `main` lines | Reviewed `thermo` lines |
| --- | ---: | ---: |
| `content.js` | 2,938 | 3,417 |
| `background.js` | 1,441 | 1,666 |
| `overlay.js` | 1,693 | 1,548 |
| Popup `App.jsx` | 1,140 | 1,196 |

These files were already over 1,000 lines. Three grew despite earlier simplification work. Size is a warning; the acceptance criterion is fewer responsibilities, fewer independently mutable states and useful public test seams. Moving helper functions or JSX without moving responsibility would leave the defects intact.

## Preserve and verify

Keep the existing canonical preference defaults, local-only credentials, explicit fallback policy, response byte limits, Manga batch/region limits, layout source-pixel preservation, health loading state and useful provider adapters. Extend them where the findings show gaps. Historical claims in `AUDIT.md`, `REMEDIATION_LEDGER.md` and older state notes describe previous passes; they do not close this review's findings.

Release work still needs real Chrome MV3 reload/suspension/teardown checks, actual OCR fixtures, provider response smoke tests, clean CI installs and representative rendered-image inspection. Source-language inference needs a real corpus before any weight tuning. Auth0 sync and Firefox support remain separately scoped product decisions. The website should state its local-demo limits accurately until broader capabilities are implemented and exercised.
