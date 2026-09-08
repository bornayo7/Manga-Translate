# Remediation ledger — 2026-09-07

Working tree: `main` @ `bbe553c` (clean on entry). The audited commit
`b550dbcd0557fc5ae7b52112a1b2ba6fd040559d` does not exist locally or on
`origin`; every finding was revalidated against the current checkout, not
against the audit's line numbers. The `Manga-Translate-audit-reproductions.zip`
was not present on this machine.

Baseline on entry (run, not read): extension `npm test` 56/56; backend
`pytest -q` 46 passed; website `eslint .` + `tsc --noEmit` clean. Node
24.11.1, npm 11.6.2, Python 3.12.10 only (no 3.10/3.11), no Docker, Chrome
installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`, no
Playwright/Puppeteer, `paddleocr`/`manga_ocr` not installed.

Status legend: **confirmed** (defect reproduced in current code) ·
**already fixed** (fixed before this pass, evidence cited) · **not reproduced**
· **intentional** · **fixed** (this pass, with regression test) · **blocked**.

| ID | Current evidence (before this pass) | Status | Files | Regression test | Remaining |
|---|---|---|---|---|---|
| MT-01 | `shared/llm-models.js` already centralises the catalog; defaults valid; retired IDs mapped silently on load. Docs check 2026-09-07: Gemini 2.5 Flash/Flash-Lite/Pro and 3.8 Flash current, 2.0 shut down; Claude Sonnet 5 / Opus 5 / Haiku 4.5 current; OpenAI `gpt-5` and `gpt-5-mini` deprecated (shutdown 2026-12-11), `gpt-4.1-nano` shutdown 2026-10-23, `gpt-4o(-mini)`/`gpt-4.1(-mini)` active. Silent migration lacks an explicit outcome. | partly already fixed → **fixed** | `shared/llm-models.js`, popup, `translate-manager.js` | `test/llm-models.test.js`, `test/translation-manager.test.js` | live API calls not exercised (no keys) |
| MT-02 | `[1] a\n[3] c` no longer duplicates (test exists), but a missing ID silently yields `''` and truncation only warns → apparent success with untranslated bubbles. Duplicate/out-of-range markers are absorbed as content. | confirmed → **fixed** | `translate/llm-translate.js` | `test/llm-translate.test.js` | — |
| MT-03 | `processAllImages` loop checks only `nextIndex < images.length`; after `deactivate()` the loop keeps dequeuing into fresh WeakMaps and starts OCR. | confirmed → **fixed** | `content.js`, `background.js` | `test/content-lifecycle.test.js` | aborting a fetch does not stop a running backend inference |
| MT-04 | `shouldTranslateTextBlock('这是中文。','ja','zh')` → `already-target-language` (Han fallback 0.75 ≥ 0.58). | confirmed → **fixed** | `translate/translate-manager.js` | `test/translation-manager.test.js` | — |
| MT-05 | MyMemory spec (fetched 2026-09-07): `q` "Max 500 bytes", UTF-8. Both clients compare `.length` (UTF-16 units). | confirmed → **fixed** | `shared/text-chunking.js`, `shared/mymemory.js`, `translate/libre-translate.js`, `website/lib/translator.ts` | `test/text-chunking.test.js`, `test/mymemory.test.js` | — |
| MT-06 | `fetchWithTimeout` clears its timer in `finally` as soon as headers arrive; every `.json()/.text()/.arrayBuffer()` runs unbounded. Website duplicate has the same shape. | confirmed → **fixed** | `shared/fetch-with-timeout.js` + all callers, `website/lib/translator.ts` | `test/fetch-with-timeout.test.js` | — |
| MT-07 | Icon click handler closes over the discovery-time `imageInfo.url`; `prefersBackgroundFetch` and `FETCH_IMAGE` use the stale URL after a `src` swap. | confirmed → **fixed** | `content.js` | `test/content-lifecycle.test.js` | — |
| MT-08 | `scanForImages` skips `naturalWidth === 0`; no `load` listener; a later load on a quiet page never rescans. | confirmed → **fixed** | `content.js` | `test/content-lifecycle.test.js` | — |
| MT-09 | `_build_constructor_kwargs` tests names against `inspect.signature`; PaddleOCR 2.x `__init__(self, **kwargs)` exposes none → `{}` → language ignored. | confirmed → **fixed** | `backend/ocr_engines/paddle_ocr.py`, `requirements-ocr.txt` | `backend/test_paddle_ocr.py` | real-model smoke blocked (packages not installed) |
| MT-10 | Fixed 2026-09-06 (`_lock` vs `_load_lock`, test `test_loaded_language_lookup_does_not_wait_for_a_model_load`). No async server-level test; no initializing state. | already fixed → hardened | `backend/server.py`, engines | `backend/test_server.py` (async) | — |
| MT-11 | `selectMangaBboxes` truncates at 200 boxes / 50 MP and drops the rest silently; both clients post one request. | confirmed → **fixed** | `shared/ocr-responses.js` (new), `background.js`, `website/lib/translator.ts` | `test/ocr-responses.test.js` | — |
| MT-12 | Manga path: `mangaBlocks.length > 0 ? mangaBlocks : fallbackBlocks` — empty entries vanish; website filters after a raw length check. | confirmed → **fixed** | same as MT-11 | same | — |
| MT-13 | `responses[0].error` on HTTP 200 ignored → empty OCR success. | confirmed → **fixed** | `shared/ocr-responses.js`, `background.js` | `test/ocr-responses.test.js` | — |
| MT-14 | Canvas in a static parent: `element.style.position='relative'` and the control is appended **inside** `<canvas>`. | confirmed → **fixed** | `content.js` | vm test + browser harness | — |
| MT-15 | Positioned parent → `iconAnchor = parent`; two images share `top:8px;right:8px`. | confirmed → **fixed** | `content.js` | vm test + browser harness | — |
| MT-16 | `wrapText` accepts the first token unmeasured; `tryFontSize` never checks line width; min-font fallback is unverified. | confirmed → **fixed** | `shared/text-layout.js` (new), `overlay.js` | `test/text-layout.test.js` | — |
| MT-17 | Website wraps on whitespace only; no-fit fallback returns the unsplit text at 8 px. | confirmed → **fixed** | `website/lib/translator.ts` | shared layout tests | — |
| MT-18 | `handleReadAloudClick` re-checks overlay identity after the await but not Stop/newer selection; two pending requests both play. | confirmed → **fixed** | `content.js` | vm test | — |
| MT-19 | `generateReadAloudAudio` snapshots cache before the network await and writes it back after. | confirmed → **fixed** | `tts/elevenlabs.js` | `test/elevenlabs-cache.test.js` | — |
| MT-20 | `translateIcons` Set and `mutatedElementStyles` Map hold detached elements forever. | confirmed → **fixed** | `content.js` | vm test | — |
| MT-21 | `persistSettingsSnapshot` ignores `{success:false}` and falls back to direct storage on transport error. | confirmed → **fixed** | `src/popup/App.jsx`, `src/popup/settings-persistence.js` (new), `background.js` | `test/settings-persistence.test.js` | — |
| MT-22 | `ensureImageCacheIndex` creates an index record for every translated image; never pruned. | confirmed → **fixed** | `tts/elevenlabs.js` | `test/elevenlabs-cache.test.js` | — |
| MT-23 | 180 ms popup debounce cancelled on unmount. | confirmed → **fixed** | popup + `utils/storage.js` | `test/settings-persistence.test.js` | — |
| MT-24 | `jwtVerify` errors propagate to the generic 500. | confirmed → **fixed** | `website/lib/api-auth.ts`, `website/lib/api-auth-errors.js` (new) | `website/lib/api-auth-errors.test.mjs` | — |
| MT-25 | All-skipped → `translations: ['', …]`, content.js reports "provider returned no translated text"; no-text image shows ✗. | confirmed → **fixed** | `translate-manager.js`, `background.js`, `content.js` | `test/translation-manager.test.js`, vm test | — |
| V-01 | see final report | | | | |
| V-02 | `paddlepaddle==2.6.2` pinned everywhere while `paddleocr>=2.7.0` resolves to 3.x (PyPI 2026-09-07: latest 3.7.0, depends on `paddlex`, PaddlePaddle 3.x line). Setup scripts install unpinned `paddlepaddle`. | confirmed (install) | requirements, setup scripts, docs | — | real install not run here |
| V-03 | Spec has no autodetect value; web search: `autodetect` "invalid source language". | confirmed | libre-translate, website | tests | — |
| V-04 | Vendored `lib/*` byte-identical (after CRLF) to `tesseract.js@5.1.1` / `tesseract.js-core@5.1.1`; `lib/tessdata` is empty (traineddata downloaded from jsDelivr on first use). | see final report | | | |
| V-05 | Separate pools per `processAllImages` call; single clicks unbounded; MyMemory 100 ms delay is per-job. | confirmed → **fixed** | `content.js`, `translate/libre-translate.js` | tests | — |
| V-06 | README says 3.10–3.12, `requirements-ocr.txt` says 3.8–3.12, `setup.sh` accepts 3.8; code uses `X | None` (3.10+). | confirmed → docs/scripts aligned | setup scripts, docs | syntax check at 3.10 | 3.10/3.11 not installed here |

---

## Review of this pass — 2026-09-08 (branch `thermo`)

A code-quality review of the working tree above, before it was committed.
Baseline on entry, run rather than read: extension `npm test` **exited 1**
with six failures, all in `test/content-lifecycle.test.js` — the regression
tests for MT-03, MT-07, MT-15, MT-20, MT-25 and V-05. Those rows were
marked "fixed → with regression test" while their tests did not pass. The
backend (53) and website (tsc/eslint) were green.

Corrections to the table above:

| ID | What the review found |
|---|---|
| MT-03 / V-05 | The page-wide queue deduplicated by **element**, so a click on an image the prefetch queue already held was handed the prefetch's promise — different work returning a different shape. `applyOutcomeToControl` read the prepared payload as an outcome and showed a red ✗ on a successful translation. Queue keyed on `(activation, mode, source)` and moved to `shared/image-work-queue.js`. |
| MT-07 | Defeated by the same dedupe: a click after a `src` swap reused the in-flight job for the *old* source. Also, the old job's late cancellation reset the control the *new* job had just rendered. |
| MT-20 | Not fixed for the common case. The page removes a wrapped image **as the extension's own wrapper**, and the removal filter skipped extension nodes, so wrapped images were never released. |
| MT-25 | Outcomes were reported through `imageState.lastOutcome` and reassembled by the caller. Now returned. `lastJobResult` was then found to have 15 writers and 1 reader already implied by its enclosing condition; removed, along with the `imageProcessIds` shadow of `imageState.activeJob`. |
| MT-06 | The `release()` contract was unenforced: 15 call sites, 4 honoured it. `fetchWithTimeout` now reads the body inside the deadline and returns a plain object, so there is nothing to release. |
| MT-05 / MT-17 | The website resolved the MyMemory source language **per chunk** while the extension did it per block, so text long enough to split could be refused on the site and translated in the extension. |

Also fixed here: a cancellation thrown inside the background-image `try` was
swallowed and the pipeline continued; `as: 'bytes'` skipped decoding error
bodies, degrading a failed ElevenLabs request to "HTTP 401"; and two test
harness defects (a `drawImage` no-op that erased image identity, and a
`getURL` that resolved only `overlay.js`) were failing tests for the wrong
reasons.

Verified on this branch by running them: extension `npm test` **173 passed**
(stable over three runs) and `npm run build`; backend `pytest -q` 53 passed,
1 skipped; website `tsc --noEmit`, `eslint .` and `next build` all clean.

Known and not fixed: `prepareImageForTranslation` is 403 lines (was 494);
`content.js` is 3,417 lines, down 153 from this pass's peak but still +479
over `main`; the `detectSourceLanguage` weights and stop-word lists are
unchanged — the drift was fixed, the tuning was not.
