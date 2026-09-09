# lensmu / VisionTranslate

A Chrome Manifest V3 extension that reads text in webpage images and draws translated text over each image. The repository is named Manga-Translate; VisionTranslate is the project name and lensmu is the product.

The extension is the primary product. The Next.js website introduces it, explains installation, and offers a limited demo that uses your local OCR backend. The demo does not accept extension provider credentials.

## Start here

- [Install the extension](#browser-extension)
- [Run local OCR](#local-ocr-backend)
- [Run the website](#website)
- [Review findings](CODEBASE_REVIEW.md), [approved overhaul plan](OVERHAUL_PLAN.md), [implementation evidence](docs/IMPLEMENTATION_PROGRESS.md)

## Requirements

| Component | Tested setup |
|---|---|
| Extension and website | Node.js 20.19 or later; `npm ci` |
| Backend | Python 3.12 with a selected pinned dependency profile |
| Browser | Chromium with Manifest V3 offscreen documents; manifest minimum Chrome 109 |

The minimum browser version is an API requirement, not a claim that every Chromium release has been tested. Firefox is not a supported release target. Exact qualification and remaining external checks are recorded in the implementation evidence.

## Browser extension

```sh
cd lensmu/extension
npm ci
npm run build
```

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select `lensmu/extension` (the directory containing `manifest.json`).
3. Pin lensmu from the browser's extensions menu.
4. Open a normal webpage containing images and choose the source/target languages in the popup.
5. Activate the page controls and use an image's translation button, or translate all discovered images.

Switching the page off removes its overlays and remembers that choice for the site. `Alt+Shift+V` toggles the current page. Browser internal pages cannot run content scripts.

OCR choices are bundled Tesseract, local PaddleOCR, local Japanese MangaOCR, Google Cloud Vision and a custom OCR endpoint. Translation choices are MyMemory, OpenAI, Claude, Gemini and a custom OpenAI-compatible endpoint. Paid providers require a key; MyMemory has service quotas. Public-provider fallback is opt-in. Provider failures and regions that cannot be displayed remain visible as failures or partial results.

Provider keys live in trusted extension storage and are excluded from page messages, website settings and account metadata. Tesseract downloads language data on first use and runs in an extension offscreen document. Local OCR sends image data to your configured backend; translation sends recognized text to the selected provider.

## Local OCR backend

Use Python 3.12 in an isolated environment. Core server tests do not install the OCR models. Choose one OCR profile when recognition is needed; do not combine profiles in the same environment.

```sh
cd lensmu/backend
python -m venv venv
# PowerShell: .\venv\Scripts\Activate.ps1
# macOS/Linux: source venv/bin/activate
python -m pip install -r requirements-ocr.txt
python server.py
```

| Profile | Installation | Engines |
|---|---|---|
| Core | `python -m pip install -r requirements.txt` | Server without optional OCR libraries |
| Development | `python -m pip install -r requirements-dev.txt` | Core plus deterministic test tools |
| OCR 2 | `python -m pip install -r requirements-ocr.txt` | PaddleOCR 2.10.0 / PaddlePaddle 2.6.2 plus MangaOCR |
| OCR 3 | `python -m pip install -r requirements-ocr3.txt` | PaddleOCR 3.2.0 / PaddlePaddle 3.2.2 plus MangaOCR |

Exact dependency constraints are under `lensmu/backend/constraints`. Both OCR profiles passed real English, Japanese horizontal/vertical, colored-text, shifted-coordinate and blank-image cases on Windows with Python 3.12. See the backend implementation report for the full matrix. Installing a profile on another OS still requires platform qualification.

The server binds to `127.0.0.1:8000` by default. Check `http://localhost:8000/health` and use the same backend URL in extension settings. Models download on first recognition. MangaOCR reads Japanese; select Japanese or automatic source language.

From the repository root, the setup scripts create the backend environment and build the extension:

```sh
./setup.sh ocr2
# PowerShell:
.\setup.ps1 -Profile ocr2
```

For core-only setup use `core`; for PaddleOCR 3 use `ocr3`. Setup failures return an error and preserve the original shell location. [Backend documentation](lensmu/backend/README.md) describes configuration and limits.

Docker uses the same profiles, with a loopback-only published port:

```sh
cd lensmu/backend
docker build --build-arg OCR_PROFILE=ocr2 -t lensmu-backend .
docker run --rm -p 127.0.0.1:8000:8000 lensmu-backend
```

Docker build/run has not been verified on the current machine because Docker is unavailable.

## Website

```sh
cd lensmu/website
npm ci
npm run dev
```

The website's installation route describes loading the actual extension. Its demo sends images to a local OCR backend, translates with MyMemory and exports the rendered image. Provider limits and partial results are surfaced. The authored sample panel is illustrative; it is not a claim of OCR accuracy.

## Ownership and data flow

1. The popup sends intent to the background worker. Durable settings writes are serialized there and acknowledged only after storage succeeds.
2. `content.js` loads the page controller. Discovery finds eligible image occurrences; each `ImageSession` owns its controls, revision, overlay and cleanup.
3. Identical image contents may share a bounded preparation cache. They keep separate display lifetimes. Detaching one image cannot cancel another image's shared preparation.
4. A single trusted settings snapshot spans OCR and translation. OCR or translation changes, including actual credential rotations, invalidate preparation through an opaque revision. Cosmetic changes redraw existing results.
5. OCR providers normalize and validate their responses. The translation manager distinguishes translated, unchanged, empty and failed regions.
6. A shared display plan measures text and placements. The canvas renderer reports what it actually painted; off-image or unreadable regions cannot count as complete success.
7. Cancellation retires obsolete ownership immediately. Resource capacity remains occupied until work that cannot physically stop has actually finished.

| Module | Responsibility |
|---|---|
| `lensmu/extension/background.js` + `lensmu/extension/background/` | Message composition, request scope, live page state, trusted preparation, offscreen lifecycle |
| `lensmu/extension/content.js` + `lensmu/extension/page/` | Discovery, per-image lifetime, preparation consumers and read aloud |
| `lensmu/extension/overlay.js` + `lensmu/extension/render/` | Reversible host-page mounting, grouping and rendering |
| `lensmu/extension/ocr/`, `lensmu/extension/translate/`, `lensmu/extension/tts/` | Provider boundaries |
| `lensmu/extension/shared/` | Canonical preferences, response contracts, display plans and bounded queues/cache |
| `lensmu/extension/src/popup/` | Settings draft, page/account/playback sessions and UI |
| `lensmu/backend/ocr_runtime.py`, `lensmu/backend/image_decoder.py` | Bounded inference ownership and image validation before model work |
| `lensmu/website/lib/` | Demo input, OCR, translation, rendering and cancellable UI session |

The [ownership decision](docs/adr/0001-image-and-settings-ownership.md) records the alternatives and tradeoffs. [REPO_MAP.md](REPO_MAP.md) and [PIPELINES.md](PIPELINES.md) provide navigation.

## Validation and development

```sh
# Extension
cd lensmu/extension
npm test
npm run build

# Website
cd lensmu/website
npm run lint
npm run typecheck
npm test
npm run build

# Backend (development profile)
cd lensmu/backend
python -m pytest -q
```

The directory changes above are separate commands from the repository root. CI performs clean installs and checks all three applications. Live OCR tests are opt-in because they download models and require an OCR profile; instructions are in the backend report. Browser acceptance uses an isolated profile and local fixtures.

Use `npm run watch` in the extension while developing, then reload the extension on `chrome://extensions` after changes. Keep credentials out of source, logs and fixtures.

## Troubleshooting

- **No page controls:** use a normal webpage, activate lensmu, and check minimum image dimensions. Images removed or replaced by the host page receive new lifetimes.
- **Backend unavailable:** check its health URL, port and the selected backend URL. PaddleOCR/MangaOCR require the corresponding Python profile; Tesseract does not.
- **Poor recognition:** choose the actual source language and a suitable OCR engine. Blank, tiny or low-contrast regions may produce no readable result.
- **Translation failure:** check provider configuration and quota. Enabling public fallback explicitly allows the recognized text to be sent to MyMemory.
- **Settings save failed:** correct the reported storage error and retry; failed writes do not become successful saves.

## Team and license

Built at HackSMU VII by [bornayo7](https://github.com/bornayo7), [Logan722](https://github.com/Logan722), and [KBuildingPrograms](https://github.com/KBuildingPrograms).

[MIT License](LICENSE)
