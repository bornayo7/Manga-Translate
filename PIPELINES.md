# Pipelines

## Image translation

1. Popup or keyboard intent reaches the background. The worker queries actual page state rather than restoring a stale tab snapshot.
2. The page controller discovers eligible targets. Each occurrence has an independent `ImageSession`.
3. Image preparation reads pixels, fingerprints content and acquires shared work by content/settings identity. A click promotes existing prefetch intent.
4. `PREPARE_IMAGE` reaches the background with an opaque preparation revision and a request ID scoped to the sending document.
5. The background loads one trusted settings snapshot, calls normalized OCR, groups regions and translates text. It checks the preparation revision before accepting each stage.
6. Shared outcome classification preserves failed/skipped regions and rejects known-language source echoes. A concrete display plan determines graphemes and placements.
7. The current image session alone can commit its overlay. Painted-region counts decide full/partial/failed display; unpaintable regions keep original pixels.
8. Source replacement, settings changes, deactivation or target removal retire obsolete authority. Shared work survives while another current consumer needs it; an unstoppable worker holds capacity until actual completion.

Trace source identity, OCR result, grouped region indices, provider outcomes, display placements and current session acceptance in order. Use controlled fixtures rather than logging provider keys, image payloads or private source text.

## Local OCR

HTTP schema and compressed-byte validation → bounded runtime admission → header/pixel/full-decode validation → lazy model/cache → serialized engine inference → normalized aligned outcome → HTTP response.

Paddle receives BGR pixels and has document geometry transforms disabled. Manga accepts Japanese crops and returns recognized/empty/outside-image/failed statuses. Full attempted inference failure is an error. Partial fallback recognition is labeled by clients.

## Bundled OCR

The worker creates or reuses one offscreen document → the document serializes Tesseract recognition → its idle owner terminates the model and notifies the worker → the worker rechecks idle state and closes the document. This survives worker recreation without depending on an old in-memory idle timer.

## Settings

Popup draft patch → prompt message dispatch → background serialized read/merge/write → durable acknowledgment and opaque revisions → ordered sanitized page update.

A failed read prevents a write. A failed acknowledgment leaves the relevant UI fields unsaved. Cosmetic revisions can redraw; OCR/translation changes and actual credential rotations invalidate preparation. Canonical definitions and strict website validation are in `lensmu/extension/shared/preferences.js`. Local migration remains deliberately coercive.

Website preference metadata accepts only safe shared fields. Extension API keys, auth tokens and local backend/provider endpoints are excluded. Account preference sync from the extension remains explicitly deferred; the website API is not evidence that extension sync is live.

## Website demo

Bounded local input → backend OCR → MyMemory translation → shared display plan → rendered Blob → current session-owned result URL. The session rejects stale progress/results and revokes URLs on replacement, cancellation or unmount. A transcript exposes recognized text, translated text and partial outcomes. The sample/installation routes keep the extension primary.

## Validation

See [implementation evidence](docs/IMPLEMENTATION_PROGRESS.md) and the slice reports for deterministic tests, real browser fixtures and the OCR profile matrix. Authenticated provider calls, real account flows and Docker require their own evidence; passing local fixtures cannot substitute for those routes.
