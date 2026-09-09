# Extension core audit — thermo

Read-only review of thermo at 172c2d2c9fd297304956bb634bab1877a377db47 against main at bbe553c32ef9ecd46f089a62f53a0b3eb3b75460. No repository source, branch, commit, or vault mutations. All 16 assigned first-party files were read completely, 8,819 lines total; supporting skill and project state notes were also read. Probes execute actual production content.js through its existing harness, or actual renderer/queue exports. They do not prove browser layout, live OCR, or provider behavior.

## Review conclusion

Request changes before merge. The queue and outcomes extraction removed some duplicate control flow, but the content module still lacks one owner for an image transaction. That architectural gap causes confirmed wrong-target deduplication, discarded clicks, stale overlays, and work that paints after deactivation. Splitting files alone will not repair it.

File sizes:
- content.js: main 2,938 → thermo 3,417 (+479).
- background.js: main 1,441 → thermo 1,666 (+225).
- overlay.js: main 1,693 → thermo 1,548 (-145).
All three were already above 1k; do not claim this branch newly crosses 1k. The more meaningful defect is growing state and ordering knowledge across callers, queue, imageStates, imageOverlays, translateIcons, activeJobs, mutatedElementStyles, and promise closures.

## Confirmed findings

### EC-01 — P1 — Distinct images sharing a source become the same render job (thermo regression)

Locations: content.js:252–260; shared/image-work-queue.js:31 and 85–94.
getImageWorkKey() encodes activation, mode and source/dimensions but no DOM target identity. schedule() indexes globally by that key and returns an existing promise before considering element. Two images with the same URL and dimensions collide. Every same-size canvas also collides because its source key is dimensions only.

Probe: two separate default images, click both before either completes. Actual output:
{"ocr":1,"firstOverlay":true,"secondOverlay":false,"icons":["rendered","rendered"]}

The second element falsely reports a successful translation but has no overlay. A preparation cache can share work by content/settings; a render transaction must be owned by each DOM target. The queue was introduced on thermo; git diff main...thermo shows the entire key function as an addition.

### EC-02 — P1 — Source changes on wrapped images bypass invalidation (thermo regression)

Location: content.js:2977–2979; source invalidation at 3020–3026.
isInsideExtensionNode(target) walks ancestors, so normal host IMG elements inside extension icon/overlay wrappers are treated as extension-generated attributes. src/srcset records are discarded before source invalidation. After the page changes a translated image, the old overlay remains over different content until some unrelated rediscovery or explicit click occurs.

Probe: render an image; swap src; deliver that attributes record to the real MutationObserver callback; advance its 500 ms timer. Actual output:
{"staleOverlay":true,"sourceKey":"img::http://page.test/a.png::http://page.test/a.png::300::200","liveSrc":"http://page.test/replaced.png","pendingTimers":0}

git diff confirms the ancestor guard is new on thermo. Filter actual extension-owned mutations, not every descendant of extension wrappers. Better: target records own source observation and disposal.

### EC-03 — P1 — A lower-priority prefetch cancels a queued user click (thermo regression)

Locations: shared/image-work-queue.js:97–99; content.js:2859–2872 and 2953–2955.
Any new key on the same element removes an older queued entry, independent of priority. Mode is part of the key. With all workers busy, a user click queues render at priority 2; a discovery-triggered prefetch queues priority 1 for the same unchanged source and silently replaces it. No subsequent operation renders the clicked image.

Probe against the production queue with one blocked worker:
{"clickResult":null,"rendered":false,"prefetched":true}

This queue is new. Render intent should promote or subsume preparation work; prefetch must never replace explicit render intent. Use one preparation transaction per image revision plus an accumulated user render request, not independent prefetch/render jobs competing to delete each other.

### EC-04 — P1 — A visual settings redraw can recreate overlays after deactivation (inherited, still present)

Locations: content.js:3350–3364; conditional job checks at 2317, 2331, 2336, 2341; DOM mutation at 2349.
Settings changes call renderPreparedImage() without a job. Every async stale-result check is conditional on a non-null renderJob. A redraw that is waiting for source-image load survives deactivate(), then calls createOverlay() and paints into the cleaned page because the target is still connected.

Probe: successful initial translation; start the same preserveVisibility redraw used by settings; gate loadImage; deactivate; resolve the load. Output:
{"active":false,"overlays":1,"outcome":{"status":"rendered","reason":"","unfit":0}}

git show main confirms optional renderJob and unowned settings redraw existed there. Every DOM update, including cosmetic redraw, needs an ImageSession revision token checked after awaits and before committing any DOM change. Remove nullable job semantics.

### EC-05 — P2 — Deactivation during initial module import leaves controls active in an inactive session (thermo regression)

Locations: content.js:3182–3204.
activate() changes isActive then awaits ensureSharedModules(). deactivate() can run during that wait, clean up, and set inactive; activate resumes afterward and installs an observer plus image controls without verifying its generation.

Probe invokes activate(), immediately deactivates before its dynamic imports resolve, then awaits activation:
{"active":false,"controls":1,"observerTargets":1}

The await is new on thermo. Activation must be an owned transaction with rollback on failure and generation check before binding observers/controls. The same transaction model also fixes failed imports leaving isActive=true and making retries falsely succeed.

### EC-06 — P2 — Changing translation settings can make an immediate retry reuse a cancelled job (thermo regression)

Locations: content.js:252–254; 3344–3347; shared/image-work-queue.js:85–94.
Settings updates invalidate image state and cancel its running job, but the work key contains no settings or revision. A new click before the old request settles receives the cancelled old promise. No fresh OCR/translation begins; the requested new translation disappears.

Probe: gate first OCR, change target language and invoke the same invalidateImageState path as settings, click again, resolve old OCR:
{"requests":1,"overlay":false,"icon":"idle"}

Key work by target plus source/settings revision. Cancellation must synchronously relinquish ownership so a new request is distinct even while obsolete provider work is unwinding.

### EC-07 — P2 — Mixed observer deliveries can skip removals and retain detached state (inherited early-exit pattern; new removal mechanism incomplete)

Location: content.js:3051.
The mutation loop breaks after its first relevant addition unless removalsPending is already set. A later removal record in the same delivery is never examined. The discovery refresh therefore never invokes releaseDisconnectedTargets for that delivery.

Probe: tracked image wrapper removed; new image added; observer delivery contains addition record first, removal second. After debounce:
{"removedTargetStillTracked":true,"controls":2,"disconnectedControls":1}

main already used an even broader first-relevant-record break. thermo added removal cleanup but did not repair that ordering problem. Collect every relevant record; schedule only once after aggregation. Current tests emit synthetic one-record deliveries and never exercise real mixed batches.

### EC-08 — P2 — A renderer that draws zero regions can still show success (inherited behavior; incomplete thermo reporting fix)

Locations: overlay.js:1322–1325 and 1370–1372; content.js:2388–2393.
Small displayed OCR boxes are reported as skipped rather than unfit. content rejects a zero-render report only when unfit>0. Thus a translation can create a transparent overlay and show a green checkmark despite painting nothing.

Probe uses the real renderer through content.js with a valid 5x5 OCR box:
renderer report {"rendered":0,"skipped":1,"unfit":0,"unfitIndices":[]}
content result {"icon":"rendered","overlay":true}

Do not equate prepared data with displayed success. Return per-block display outcomes from the renderer and decide success on actual rendered regions. Distinguish empty/skipped translation, geometry too small, no-fit, and paint failure.

### EC-09 — P2 — Vertical rendering breaks graphemes that the new layout module measured correctly (inherited drawing bug exposed by new contract)

Locations: shared/text-layout.js:224–245; overlay.js:1430–1435.
The layout module segments graphemes and constructs columns from them, but the renderer measures column height with UTF-16 string length and indexes each UTF-16 code unit. Emoji, combining sequences and surrogate-pair CJK glyphs split into incorrect glyphs; the drawing count and height also disagree with the fitted layout.

Probe using real renderTranslation with Japanese plus emoji ('ああ😀ああ') returns rendered:1, but fillText receives separate "\ud83d" and "\ude00" strings. git show main confirms this renderer loop predates thermo.

Return columns as grapheme arrays or a complete glyph placement plan and have paint consume it without re-tokenization. Test actual draw calls, not only layout lines. Keep this separate from EC-08 because it has a different cause and regression test.

## Module plan

1. Establish behavior tests at the ImageSession interface before changing ownership. Preserve one real target record per DOM element, with immutable source/settings revision, latest requested intent, current preparation, display state, and disposal. Public interface should be small: requestTranslation(), updateSettings(), dispose(); discovery owns obtaining/releasing sessions. Avoid exposing every lifecycle flag as a setter.

2. Put reusable preparation behind a separate cache keyed on actual content fingerprint plus translation-affecting settings revision. DOM target identity is mandatory for rendering but must not prevent identical content from sharing OCR/translation. Never use canvas dimensions as a content fingerprint. Cache successful preparation promises/results, evict failed or cancelled work, bound retention. Separate consumer cancellation from shared producer cancellation.

3. Collapse queue modes into one per-target transaction whose render intent can be promoted. A background prefetch provides preparation; an explicit click adds render intent to the same target revision. It cannot demote a click. Invalidation creates a new revision, rejects stale completion at one acceptance point, and owns provider cancellation. Every visual redraw also belongs to a revision. Delete the independent mutable activeJob/preparePromise/clicked coordination spread across callers.

4. Deepen page discovery around records from the browser, not full-document rescans after every qualifying mutation. Aggregate all records, observe actual host targets inside wrappers, and reconcile source changes/removals centrally. Keep original DOM ownership and inline-style restoration in one place. For the first repair milestone preserve existing wrapper behavior; a separate no-wrap overlay-root design requires browser fixtures and a deliberate product decision.

5. Move DOM attachment and controls into an overlay-session implementation with mount/update/dispose behavior. Store control, canvas, style restoration and playback references on their owner instead of parallel maps/sets plus linear getTranslateControl searches. Keep heavy OCR/translation orchestration in background-owned modules, leaving background.js as message/event composition. content.js should select targets and accept/display results.

6. Give shared text layout a concrete display plan consumed by both renderers. Geometry, grapheme order, fit verdict and draw coordinates should be decided once. Separate OCR grouping/reading-order logic from DOM painting so the preparation pipeline can use it without importing the full overlay renderer. Keep provider translation and display outcomes explicit rather than inferring success from nonempty arrays.

7. Make read-aloud an owned session with one latest-selection token. Delay expensive hashes/cache synchronization until read-aloud is enabled or requested, where feasible, rather than adding a mandatory network/cache round trip to every translation. Preserve source-text protection and opt-in third-party fallback.

This should reduce concepts, not merely distribute 3,417 lines among files. Dependencies that genuinely vary: browser target/DOM adapter versus fixture adapter; Chrome message transport versus in-memory pipeline adapter; real canvas measure/paint versus recording canvas adapter. The production interface and test interface should match.

## Ordered verification gates

- First reproduce EC-01–EC-09 in behavioral tests and retain only meaningful fixtures.
- Repair target identity, promotion, cancellation/revision, and observer aggregation together as one cohesive ownership milestone. Verify both click and Translate All paths, plus repeated source and settings changes.
- Test settings redraw/deactivate and activate/deactivate races with controlled deferred promises.
- Exercise renderer reporting and Unicode through actual renderTranslation; preserve the pure layout tests as algorithm tests, but do not let an always-fit stub certify displayed success.
- Add browser fixtures for two identical URLs, two equal-size canvases with different pixels, src/srcset/picture changes, mixed mutation batches, reparenting, background images, resize/DPR/object-fit, transparent sources, and page-style restoration.
- After module refactor, eliminate tests that require vm eval of private bindings when equivalent observable assertions exist. The current harness reaches imageStates, activeJobs and imageOverlays directly; these tests will otherwise prevent structural simplification.
- Parent owns complete suite execution, build validation, CI, branch workflow and consolidated documentation. Live provider/OCR checks and actual browser pixel layout remain separate verification requirements.

## Reproduction scripts

These are outside the repository in the process TEMP directory:
- vision-core-audit.mjs: EC-01, EC-02, EC-03, EC-04, EC-05.
- vision-queue-followup-audit.mjs: EC-06, EC-07.
- vision-render-audit.mjs: EC-09 and renderer-only EC-08.
- vision-empty-render-audit.mjs: EC-08 through real renderer plus real content.
Run content-harness scripts with node --experimental-vm-modules. Run renderer-only script with node. All completed successfully and printed the observations above.

## Fully reviewed first-party inventory

- lensmu/extension/content.js — 3,417 lines
- lensmu/extension/background.js — 1,666
- lensmu/extension/overlay.js — 1,548
- lensmu/extension/shared/image-work-queue.js — 133
- lensmu/extension/shared/translation-outcomes.js — 108
- lensmu/extension/shared/translation-outcomes.d.ts — 33
- lensmu/extension/shared/text-layout.js — 299
- lensmu/extension/shared/text-layout.d.ts — 43
- lensmu/extension/test/content-lifecycle.test.js — 474
- lensmu/extension/test/image-work-queue.test.js — 201
- lensmu/extension/test/translation-outcomes.test.js — 119
- lensmu/extension/test/text-layout.test.js — 111
- lensmu/extension/test/helpers/content-harness.js — 223
- lensmu/extension/test/helpers/fake-dom.js — 375
- lensmu/extension/test/helpers/overlay-stub.mjs — 12
- lensmu/extension/test/helpers/fetch-mock.js — 57

Additional complete reads: project vault state; Brain Protocol; thermo-nuclear-code-quality-review/SKILL.md; codebase-design/SKILL.md; codebase-design/DEEPENING.md. Specific git-show/diff evidence from main was inspected for regression attribution. No vendor/generated code was scanned.
