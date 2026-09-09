# Browser acceptance

These runners load the built, unpacked MV3 extension into an isolated Chromium profile. They use the real content entry, service worker, popup, Chrome messages and canvas renderer. They never use your normal browser profile or credentials.

From `lensmu/extension`, build the popup with `npm run build` first. The verified browser tooling is Playwright 1.62.1 with bundled Chromium 151.0.7922.34. Install it outside the repository if it is not already available:

```powershell
$browserTools = Join-Path $env:TEMP 'lensmu-browser-tools'
npm install --prefix $browserTools --no-save playwright@1.62.1
node (Join-Path $browserTools 'node_modules/playwright/cli.js') install chromium
$env:PLAYWRIGHT_PACKAGE = Join-Path $browserTools 'node_modules/playwright/index.mjs'
node test/browser/acceptance.mjs
node test/browser/tesseract-acceptance.mjs
```

`PLAYWRIGHT_PACKAGE` is optional when `playwright` is resolvable through normal Node package resolution. It can point to an existing installation's `index.mjs` on any operating system. `BROWSER_ARTIFACTS` optionally selects an output directory; otherwise each run creates a directory under the OS temporary directory and prints its path. Profiles are created separately and removed when the run finishes.

`acceptance.mjs` starts a loopback HTTP fixture for deterministic OCR and OpenAI-compatible translation responses. It verifies:

- Duplicate contents share provider work while four DOM targets receive independent painted overlays.
- Contain placement, borders, DPR 2, target resize and cache reuse.
- Source replacement, mixed DOM mutations, reparenting, late image loads, responsive `currentSrc`, and canvas pixel changes.
- Cosmetic redraws preserve a hidden original; provider settings invalidate preparation.
- In-flight cancellation, domain disabling, reload behavior and host style/structure restoration.
- Actual MV3 worker replacement preserves live page state. A volatile worker marker proves replacement; Playwright keeps its Worker handle across restarts.
- Closing the popup preserves page overlays. The reopened popup's sections, keyboard navigation and 400-pixel layout work without page exceptions.

`tesseract-acceptance.mjs` uses real bundled Tesseract/WASM and downloads genuine traineddata on first use. It verifies English recognition, active-result cancellation, queued work, document reuse, the production 60-second idle close, subsequent recreation, Japanese recognition and the default combined English/Japanese configuration. Expect at least one minute plus model download time. The OCR/translation fixtures in the first runner do **not** establish the quality or availability of external OCR or paid translation services.

English asserts an exact expected phrase. Japanese/default checks assert the key phrase `日本語`; they are model-route smoke checks, not exact-transcription benchmarks. The recorded Japanese result duplicated one glyph in the longer sentence.

Both runners exit nonzero on failure. The first writes page/popup screenshots and a JSON result; the second writes recognized blocks and lifecycle results. Chromium is required because installed Chrome/Edge no longer expose the extension sideloading flags used by this workflow. See the [official Playwright extension documentation](https://playwright.dev/docs/chrome-extensions), including its explanation of persistent Worker handles across MV3 restarts.
