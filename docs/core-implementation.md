# Extension image lifecycle and rendering implementation

The approved overhaul replaces shared URL-keyed target state with one `ImageSession` per DOM occurrence. Identical images now share OCR/translation preparation while retaining separate controls, revisions and overlays. This closes EC-01 through EC-09 from the original core audit.

## Responsibility boundaries

| Owner | Responsibility |
| --- | --- |
| `extension/content.js` | Classic MV3 message adapter and activation generation around lazy module loading. |
| `extension/page/controller.js` | One page registry of DOM target → session; activation, reconciliation, settings updates, batch progress and real page state. |
| `extension/page/image-session.js` | Source/settings revision, accumulated render intent, subscription acceptance, outcome and disposal. |
| `extension/shared/image-work-queue.js` | Scheduling keyed by owner/revision; promoted priority and permits retained until actual settlement. |
| `extension/shared/preparation-cache.js` | Successful preparation sharing by pixel fingerprint/settings, bounded to 24 entries and an estimated 32 MiB. |
| `extension/page/image-preparation.js` | Pixel acquisition, request/cancellation transport, hashing and runtime validation of the worker's preparation response. |
| `extension/page/discovery.js` | Full mutation delivery reconciliation, load recovery and discovery of images, canvases and CSS backgrounds. |
| `extension/page/overlay-session.js` | Controls, detached rendering and DOM commit, overlay visibility, reversible wrappers/styles and resize observation. |
| `extension/page/target-geometry.js`, `extension/render/image-placement.js` | Containing-block coordinates and source-pixel placement for sampling and paint. |
| `extension/page/read-aloud.js` | One page audio selection, including cancellation of pending synthesis and late playback. |
| `extension/render/text-regions.js` | Pure OCR grouping and reading order shared with worker preparation. |
| `extension/shared/text-layout.js`, `extension/overlay.js` | One fitted grapheme/coordinate display plan and its actual canvas consumer. |

Paths in this table are relative to `lensmu/`. The entry is 43 lines; the page owners are 29–188 lines. Grouping is 388 lines and the renderer remains below 750 lines. The old shadow lifecycle maps, private-evaluation content harness and fake renderer stub are removed.

## Lifetime contract

Each request belongs to an immutable source/preparation revision. A click promotes a queued or running prefetch to render and raises its priority. A later prefetch cannot demote it. A new source/settings revision retires acceptance immediately and obtains a new queue identity, even while obsolete work unwinds.

Every result and canvas commit checks current session identity, cancellation, connected target, current source and attached host anchor. Deactivation invalidates lazy activation and every target, stops discovery/audio/resize observation, drops queued jobs and clears the preparation cache. A stale redraw cannot recreate controls or a canvas afterward. Reparenting invalidates the previous view before a later mutation delivery creates the replacement owner.

Cancelling one preparation consumer detaches only that consumer. The producer is cancelled when its last consumer leaves. Executing tasks retain queue capacity until their underlying promises actually settle. Completed target outcomes retain no image data or preparation promise; reusable image data lives in the bounded cache. Failed, skipped and cancelled preparation is not cached as reusable success. Cache byte accounting estimates serialized retained data rather than browser canvas/GPU memory; current displayed canvases belong to live target views.

Preparation keys use content hashes and the opaque `preparationRevision` provided by the worker. Credentials stay in trusted settings. Visual updates reuse preparation and read current appearance settings before committing. Opacity changes preserve original/translated visibility. A fresh click on an already processed canvas recaptures pixels, so equal dimensions are never assumed to imply equal content.

Image acquisition rejects inputs above 16,000,000 pixels or 16,384 pixels on either side, matching the website/backend policy. Known image/canvas dimensions are checked before capture or proxy fallback. Fetched and CSS background images are decoded and checked before capture-canvas allocation and `PREPARE_IMAGE`; compressed-byte limits alone do not establish a pixel bound. This reader does not downscale oversized inputs to bypass admission. Browser decoding can itself allocate native image resources before dimensions are available.

## Outcome and layout contract

Worker `PREPARE_IMAGE` uses one trusted OCR/translation settings snapshot and returns validated raw/grouped OCR blocks, translations, per-region outcomes, language metadata and warnings. Page preparation classifies each region; failed and echoed output is excluded from both paint and speech. Warnings remain visible alongside partial results.

`createTextDisplayPlan` extends the compatible layout result with `{text, x, y}` placements in relative inner-region coordinates. Vertical entries are whole graphemes. Canvas paint uses those placements directly with left/top alignment. Tiny, clipped, missing and unfit regions remain untouched. If zero regions paint, the image reports failure and no successful overlay is attached. Partial display reports the number of untranslated/unfit regions rather than claiming complete success.

Sampling and OCR boxes use the same fit/position transform. The implementation covers fill, contain, cover, none, scale-down, keyword/percentage/pixel positions and basic CSS background sizes. Borders, padding, ancestor scaling, target resize and DPR are accounted for in canvas positioning. Complex CSS transforms, repeated/multiple background layers and CSS `calc()` positions are outside the demonstrated browser matrix; `calc()` placement currently fails visibly. No claim is made that arbitrary host CSS is universally supported.

## Verification

The complete extension suite passed 229/229 after the lifecycle, renderer, settings, worker and image-admission changes. Admission tests cover known oversize input and fetched/background dimension rejection. Tests exercise public Chrome messages and observable DOM; the real renderer is used in lifecycle tests. They include duplicate targets, changed canvases, queued promotion, mixed mutation delivery, settings retry, activation/deactivation races, stale redraw suppression, reparenting before observation, no-painted success, combined graphemes, partial failure notices and speech filtering. The extension production build also passed.

The real Chromium runner passed nine scenario groups, including zero-painted/empty distinctions, actual worker restart and popup browser behavior. Screenshots were inspected for fit geometry and visible paint. The separate real Tesseract runner passed English, Japanese and default combined English/Japanese recognition, cancellation/reuse, production idle close and recreation. Browser commands and exact coverage are in [`extension/test/browser/README.md`](../lensmu/extension/test/browser/README.md).

The English fixture matched its expected text exactly. Japanese and combined-language checks assert recognition of the phrase `日本語`; the observed output duplicated one `語` character in the longer fixture. Those checks establish a functioning language/model route, not perfect transcription accuracy.

External paid-provider credentials are not required by these fixtures. Live provider quality, other Tesseract languages, vertical OCR accuracy and arbitrary host layouts need their own representative fixtures. Backend real-model acceptance is documented separately by its owner. The automated checks support their stated cases; they do not establish perfect behavior on every image or website.
