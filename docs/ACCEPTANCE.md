# Overhaul acceptance — September 9, 2026

This report closes the 27 findings in the historical [full codebase review](../CODEBASE_REVIEW.md) against the implemented behavior and records the limits of that evidence. The user approved the complete plan, including work on `thermo` and integration into the existing default `main`. No `master` branch exists and no branch rename/deletion is part of this work.

## Verified behavior

The extension now separates each image occurrence's display lifetime from reusable preparation. The background owns durable settings and one trusted OCR/translation snapshot; the page owns live activation state. Browser work, offscreen OCR and speech each have explicit cancellation/resource owners. The backend owns bounded admission and actual model completion. The popup and website consume these interfaces and expose failed, partial and unsaved states.

The interface uses the approved paper/ink/blue palette, responsive controls, native select semantics, original authored comparison panels, a real installation guide and accessible transcripts. It remains a local extension product with a clearly limited website demo.

## Finding dispositions

“Fixed” means the reproduced defect has a corresponding implemented behavior and regression evidence. It does not mean every external provider, image or browser version is qualified.

| Finding | Disposition and evidence |
|---|---|
| S-01 | **Fixed.** Serialized storage rejects failed authoritative reads before writing; migration/domain mutations share the owner. `test/storage.test.js`. |
| S-02 | **Fixed.** Truncation invalidates even a complete set of markers; one whole retry then explicit failure. `test/llm-translate.test.js`. |
| S-03 | **Fixed.** The body reader owns abort, cancellation and lock release through the deadline. `test/fetch-with-timeout.test.js`. |
| W-01 | **Fixed.** Failed field revisions remain unsaved and are retried with their actual values. `test/settings-persistence.test.js`. |
| W-02 | **Fixed.** Later edits dispatch while older acknowledgments are outstanding. Persistence regressions verify dispatch timing; the browser harness separately verifies that popup closure preserves page work. |
| W-03 | **Fixed.** Zero-painted demo output rejects; partial output preserves original pixels and carries counts/transcript. `lib/demo-pipeline.test.mjs` and browser all-unfit fixture. |
| W-04 | **Fixed.** Shared runtime OCR decoding rejects malformed HTTP 200 payloads/counts/geometry and preserves explicit region statuses. Shared OCR tests and actual demo module/browser fixtures. |
| W-05 | **Fixed.** Closed mobile menu is unmounted, Escape restores focus; five routes at 320/390/820/1280px have no page overflow. Website browser harness. |
| W-06 | **Fixed.** Install links point to a working unpacked-extension guide; the exact manifest directory is asserted at four viewport widths. |
| W-07 | **Fixed.** Key fields no longer announce optimistic saves; the footer reflects durable acknowledgment. Persistence regressions and popup browser inspection. |
| W-08 | **Fixed.** Popup health reads use the bounded request helper with a 3-second/64 KB limit. Shared timeout tests and inspected consumer. |
| EC-01 | **Fixed.** Equal contents share preparation while separate targets paint independently. Public lifecycle/cache tests and four-target Chromium fixture. |
| EC-02 | **Fixed.** Wrapped source/currentSrc changes retire the previous display. Public lifecycle and Chromium source/srcset fixtures. |
| EC-03 | **Fixed.** Click intent promotes prefetch and cannot be demoted by later prefetch. Queue/lifecycle regressions. |
| EC-04 | **Fixed.** Retired sessions cannot commit a late redraw. Lifecycle deactivation race and real cancellation/host-restoration checks. |
| EC-05 | **Fixed.** Lazy activation is generation-checked after imports. Public entry/deactivation regression. |
| EC-06 | **Fixed.** A settings/source revision creates a fresh request identity; retries do not reuse the old cancelled promise. Lifecycle tests and browser settings invalidation. |
| EC-07 | **Fixed.** Discovery reconciles complete mutation deliveries and detached/reparented targets. Public lifecycle and real mixed-mutation fixtures. |
| EC-08 | **Fixed.** Zero painted regions cannot attach a successful overlay; partial paint is counted. Actual renderer tests and browser outcomes. |
| EC-09 | **Fixed.** Paint consumes the fitted grapheme/coordinate display plan directly. Emoji/combining/vertical renderer tests. |
| B-01 | **Fixed.** Setup propagates native failure and restores the directory; no success after failed pip/npm. Real child exit and controlled setup regression. |
| B-02 | **Fixed.** Paddle3 document transforms disabled, boxes remain in submitted-image coordinates. Adapter tests plus both real OCR profile matrices. |
| B-03 | **Fixed.** Paddle receives contiguous BGR pixels; transparency composites on white. Exact red-pixel test and real colored-text cases. |
| B-04 | **Fixed.** Invalid Paddle responses fail; Manga empty/partial/fatal outcomes differ, with all attempted crop failures returning 500. Adapter/API/decoder tests. |
| B-05 | **Fixed.** Header/pixel/full-decode validation precedes model creation; 10 MiB / 16 million pixels / 16,384-pixel side bounds. Factory-never-called rejection tests. |
| B-06 | **Fixed.** Capacity belongs to actual concurrent futures, including cancelled waiters. Runtime loading/inference/queued-cancellation concurrency tests. |
| B-07 | **Fixed documentation/configuration.** All Docker examples publish the host port to loopback, and the image runs without root. Docker execution remains unverified. |

Paths in the table are relative to the relevant application. Detailed evidence: [core](core-implementation.md), [backend](backend-implementation.md), [website/popup](website-popup-implementation.md).

## Bugs caught while validating the overhaul

Independent review and real browser acceptance also repaired:

- A failed region carrying nonempty source text, or a mixed source echo, being treated as translated.
- MyMemory JSON objects/numbers becoming the visible string `[object Object]` or another invented translation.
- Explicit Manga outside-image outcomes incorrectly invalidating an otherwise aligned response.
- An extension-origin settings page in a tab being mistaken for an untrusted host page.
- An unbound native browser timer failing during actual content-script initialization.
- A circular wait between offscreen idle notification and a newly accepted recognition. The combined two-module race now completes.
- A late voice-list response overwriting a newer manual choice, and outdated speech settings retaining playback authority.
- Website decoded-image limits drifting from the backend and a completed transcript being relabeled with subsequently edited language controls.

These changes have focused regressions. The final browser harnesses exercise the production entry points rather than evaluating private source strings.

## Runtime and build evidence

- All three application test/build gates pass locally; final exact-candidate counts and CI links are recorded in [implementation progress](IMPLEMENTATION_PROGRESS.md).
- The isolated Windows Python 3.12 development environment passes 76 deterministic backend tests; 8 live tests are explicitly skipped in that profile.
- Separate pinned OCR2 and OCR3 environments each pass all 8 real-image tests. `pip check` passes all three environments. Both advertised Paddle generations remain supported.
- Real bundled Chromium 151 runs the unpacked MV3 extension through 9 scenario groups. The fixture services are deterministic; Chrome messaging, page DOM, worker restart, popup and rendering are real.
- Real bundled Tesseract/WASM recognizes English, Japanese and default combined English/Japanese input; cancellation, queued reuse, production 60-second idle close and recreation pass. Japanese smoke output duplicated one glyph; these cases do not certify exact recognition accuracy.
- Website production browser acceptance records 23 cases/groups, including 20 public route/viewport combinations and deterministic partial/error/cancel paths. One live Japanese OCR3→MyMemory request rendered and exported 1/1 regions correctly.
- Additional website reflow at a 200% equivalent viewport, reduced-motion computation and 24 light/dark text/action contrast pairs passed; [UI measurements](ui-gates.json) record the precise sampled scope.
- The short [ownership lesson](../lessons/0001-who-may-paint.html) was inspected at 390px; both feedback paths work, with no overflow or runtime errors. No user learning achievement is inferred.

The extension's deterministic browser harness is included in CI alongside application unit/build jobs. Live OCR/provider/model-download runners stay opt-in and use isolated profiles. Exact commands are in the slice reports and browser READMEs.

## Explicit qualification limits

No authenticated OpenAI/Claude/Gemini/custom/Google Vision/ElevenLabs request or Auth0 sign-in/preference round trip was performed without credentials. [Provider qualification](provider-qualification.md) distinguishes current official catalog support from live-account availability. MyMemory live evidence is one non-sensitive fixture, not a service reliability guarantee.

Docker is unavailable locally. Linux/macOS native OCR, GPU execution, arbitrary host CSS, other Tesseract languages, screen-reader operation and broad manga-language accuracy remain unverified. Complex transforms, repeated/multiple CSS backgrounds and `calc()` positions are outside the demonstrated layout matrix. Bounded cache accounting estimates serialized payloads; it is not a promise about all browser/GPU/native-model allocations.

Auth0 extension preference sync, Firefox packaging and a wrapper-free overlay architecture remain deliberately deferred product work. Source-language heuristics were not retuned without a labeled corpus. No production deployment, store publication, personal image upload, contact submission or branch deletion is included.

## Integration contract

All previous thermo commits are preserved. Fetch the remote, require a clean candidate and passing CI, confirm origin/main ancestry, fast-forward without force, then verify remote main and its exact CI result. The PR and final project-state receipt record the actual integration outcome; passing a local fixture alone does not authorize a success claim.
