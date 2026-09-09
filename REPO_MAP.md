# Repository map

The extension is the primary product. The website is an installation/marketing surface and explicitly limited local translation demo. This map describes the approved September 9 overhaul; verification status is in [implementation evidence](docs/IMPLEMENTATION_PROGRESS.md).

## Extension

| Start here | Ownership |
|---|---|
| `lensmu/extension/content.js` | Classic content-script entry; loads page controller and registers messages |
| `lensmu/extension/page/controller.js` | Page activation, discovery reconciliation, image registry and batch progress |
| `lensmu/extension/page/image-session.js` | One image occurrence's source/settings revision, intent and disposal |
| `lensmu/extension/page/image-preparation.js` | Pixel reading, content fingerprint, shared preparation subscription and transport |
| `lensmu/extension/page/discovery.js` | Eligible image/canvas/background targets and complete mutation observation |
| `lensmu/extension/page/overlay-session.js` | Per-target controls, reversible mounting, display and outcome |
| `lensmu/extension/page/read-aloud.js` | One page playback lifetime |
| `lensmu/extension/background.js` | Synchronous MV3 composition and trusted message routing |
| `lensmu/extension/background/` | Trusted preparation snapshot, document-scoped requests, actual page state and offscreen lifetime |
| `lensmu/extension/overlay.js`, `lensmu/extension/render/` | Rendering, source-space grouping and host geometry |
| `lensmu/extension/shared/` | Canonical preferences, strict response contracts, display plans, bounded cache/queue and provider helpers |
| `lensmu/extension/utils/storage.js` | Serialized authoritative settings/domain storage and migration |
| `lensmu/extension/ocr/`, `lensmu/extension/translate/`, `lensmu/extension/tts/` | OCR, translation and read-aloud provider boundaries |
| `lensmu/extension/offscreen/` | Tesseract document, recognition queue and idle cleanup |
| `lensmu/extension/src/popup/` | UI composition plus settings, page, account and speech-preview sessions |
| `lensmu/extension/test/` | Public behavior, provider and lifecycle regressions |

## Backend

- `lensmu/backend/server.py`: request/response schema, middleware, HTTP mapping and `create_app(runtime)` seam.
- `lensmu/backend/ocr_runtime.py`: bounded workers, model loading/cache, actual completion, cancellation and health snapshots.
- `lensmu/backend/image_decoder.py`: compressed/decoded input validation and owned RGB image.
- `lensmu/backend/ocr_engines/`: Paddle version/BGR/geometry adapter and Manga aligned region outcomes.
- `lensmu/backend/requirements*.txt`, `lensmu/backend/constraints/`: shared pinned core/development/OCR2/OCR3 profiles.
- `lensmu/backend/test_*.py`: deterministic contracts plus opt-in real OCR matrix.

## Website

- `lensmu/website/app/`: landing, translation, installation, about and contact pages, plus the authenticated preferences API at `app/api/preferences/route.ts`. There is no separate preferences page.
- `lensmu/website/components/sections/TranslatorSection.tsx`: UI that consumes the cancellable translation session.
- `lensmu/website/lib/translation-session.js`: current request, progress acceptance and result URL ownership.
- `lensmu/website/lib/`: `image-input.ts`, `demo-ocr.ts`, `demo-translation.ts` and `image-renderer.ts` are narrow stages composed by `translator.ts`.
- `lensmu/website/lib/preferences-schema.ts`, `lensmu/website/lib/preferences-store.ts`: canonical shared validation and safe preference metadata; no extension keys.
- `lensmu/website/public/sample-panel*.svg`: original authored comparison panel assets.

## Persistent project context

- [Review](CODEBASE_REVIEW.md) and `docs/reviews/2026-09-09/`: historical full-source snapshot and reproduced findings.
- [Plan](OVERHAUL_PLAN.md), [current state](TASK_STATE.md), [implementation evidence](docs/IMPLEMENTATION_PROGRESS.md): accepted scope and actual progress.
- [Decision](docs/adr/0001-image-and-settings-ownership.md), [pipelines](PIPELINES.md), [glossary](CONTEXT.md): ownership and vocabulary.
- [Teaching mission](MISSION.md), `lessons/`, `reference/`, `assets/`: small maintenance lessons; learning achievements are not inferred.

Do not scan vendor `extension/lib/`, dependency trees, virtual environments or generated build output for application behavior. Review them only when packaging/build tooling is in scope.
