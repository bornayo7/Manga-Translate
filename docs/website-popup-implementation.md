# Website and popup implementation

The approved overhaul is implemented across the website and popup. The extension remains the product; the website provides an honest local demo and installation guide. No store listing, automatic settings sync, or prepared illustration is presented as a live translation.

## Ownership and outcomes

- Popup `App.jsx` is now 599 lines (formerly 1,196). Settings, page status/actions, account state, speech preview and Chrome transport each have an explicit owner. Native selects replace the custom listbox. Keyboard tab navigation uses roving focus and an associated panel; errors and durable save status are visible.
- `settings-persistence.js` dispatches edits within the current task even while earlier acknowledgments are outstanding. It retains failed field revisions, handles out-of-order acknowledgments and retries the actual values. Background storage remains the durable write owner. Opening the popup without edits sends no empty save.
- Speech operations use `speech-preview.js`: changes to account credentials, voice, target language or synthesis settings invalidate pending results and stop prior playback. Late voice lists cannot overwrite a newer manual choice. Account changes clear the old list. Invalid voice lists produce a visible error.
- API-key fields show a masked key description; only the footer's durable acknowledgment says settings are saved. The unused Google Vision custom-key override UI was removed. Local backend health has a three-second deadline and 64 KB response bound.
- Website `translation-session.js` owns cancellation, current request acceptance, progress and result URLs. Old requests cannot publish state or allocate an orphaned URL. Reset, rerun, cancellation and unmount release accepted URLs; preview and decoded-image URLs have separate cleanup.
- `translator.ts` composes image input, OCR, translation and rendering. OCR uses the shared validated backend decoder, including Manga batch alignment and warnings. Translation uses bounded MyMemory requests and canonical outcome classification. A source echo in a mixed response is retained as an explicitly failed region rather than painted.
- `image-renderer.ts` paints shared `createTextDisplayPlan` placements, preserving whole vertical graphemes. It counts actually painted regions; skipped regions keep their original pixels. All-unfit images reject rather than export an unchanged image as success. The transcript includes useful translations that could not fit and explicit missing-translation notices. Completed results retain their original language metadata even if controls change afterward.
- Image input matches backend limits: JPG/PNG/WEBP, 10 MiB, 16,000,000 pixels and at most 16,384 pixels on either side. Language mismatches fail before network work; MangaOCR requires Japanese.
- Website preferences derive their keys, defaults and validation from the canonical extension contract through a Zod adapter. Malformed stored preferences fail visibly instead of appearing absent and being overwritten with defaults. Secrets remain excluded from website preferences; live Auth0 integration was not configured for acceptance.

## Design

The approved reading palette is implemented in both surfaces: paper `#FFFFFF`, page `#F1F4FA`, ink `#20304A`, reading blue `#3157C8`, confirmation `#176F67`, correction `#B33A43`, with explicit dark-theme values. Display and reading font stacks prefer Barlow Condensed and Source Sans 3 when locally installed and fall back to Bahnschrift Condensed/Segoe UI. No remote font download is required.

The website presents the reading task first: concise copy and an original two-panel SVG scene, an explicit Original/English comparison, and an installation link that leads to real unpacked-extension instructions. The illustration is authored in this repository and explicitly labeled as a prepared example. The demo uses a two-column image/control workspace on desktop and a single column on narrow screens, with the transcript below. Continuous decorative motion, dead marketing sections and the shared reveal helper were removed.

The popup uses a compact masthead, three tabs, one independently scrolling content area and a persistent action/save footer. Its normal 420-pixel width contracts to the available viewport. Mobile website navigation is conditionally mounted rather than height-clipped; Escape closes it and restores focus. Inputs, status messages, file controls, comparison buttons and error associations use native semantics. Reduced-motion mode disables animation, transitions and smooth scrolling.

## Verification

Verified on the current working tree:

- Website: `npm test --prefix lensmu/website` — **16/16 passing**; `npm run lint --prefix lensmu/website` — pass; production build (including TypeScript) — pass. Standalone typecheck also passed before the final build.
- Popup: settings persistence **11/11** and speech ownership **3/3** regressions pass; extension Vite build passes.
- Portable production-browser harness: `lensmu/website/test/browser/acceptance.mjs` — **23 recorded cases/groups passing**, zero page errors. This includes all five public routes at 320, 390, 820 and 1280 pixels; no horizontal overflow; headings and image alternative text; mobile menu unmount/Escape focus; sample selection; dark mode; contact error association; cancellation/retry; mixed source echoes; immutable result language; all-unfit output rejection; malformed OCR rejection. The final installation check also asserts that Load unpacked selects `lensmu/extension`, the directory containing `manifest.json`, rather than the popup bundle in `dist`.
- Final installation correction: the complete deterministic browser rerun passed **22 cases/groups**, including the exact manifest-directory assertion at all four widths. It made no live provider request.
- Live browser path: PaddleOCR 3 backend on loopback port 8001 and real MyMemory translated the generated Japanese fixture `こんにちは` to `Hi`. The browser displayed **1/1 regions translated**, the transcript matched, and the downloaded 720×360 PNG was visually inspected. This verifies one real provider request, not general OCR quality or every supported language/model.
- Core agent's independent unpacked-extension harness checked Translate, Engines and Settings at 400 pixels, keyboard Home navigation and zero page errors. It passed the nine core/browser scenario groups. Paid speech and translation providers were not exercised live; popup speech regressions use controlled adapters.
- Additional UI gates, recorded separately from the 23/22 browser groups: all five public routes fit a 640×450 CSS viewport at device scale 2 (the viewport equivalent of 200% zoom in a 1280×900 window), including the open mobile menu. This checks reflow equivalence, not native browser zoom controls. With reduced motion enabled, every route computed `scroll-behavior: auto`, no active CSS animations and zero transition durations. Twenty-four light/dark contrast pairs were measured using relative luminance: actual website heading/body/action/link colors and feedback tokens, plus popup stylesheet text/action/feedback tokens. All exceeded 4.5:1; the minimum was 5.43:1, and primary actions measured 6.31:1 in light and 7.32:1 in dark. These checks do not qualify every possible control state or native popup zoom. Raw measurements are in [ui-gates.json](ui-gates.json).
- `git diff --check` on owned source paths passed. Git emits its normal LF-to-CRLF working-tree warnings.

Representative evidence is checked in under `docs/screenshots/`: `website-desktop.png`, `website-mobile.png`, and `demo-real-output.png`. Full browser reports/screenshots are emitted to the harness artifact directory. Accessibility checks cover DOM semantics, focus and responsive rendering; no screen-reader or formal accessibility certification is claimed. Auth0 sign-in and preference round trips remain unverified without credentials. No personal image, provider credential, external message or contact form submission was used.

## Reproduce browser acceptance

Build and serve the website in one terminal:

```powershell
npm run build --prefix lensmu/website
npm run start --prefix lensmu/website -- --port 3001
```

Run in another terminal with a separately provisioned Playwright and Chromium:

```powershell
# Optional when Playwright is not resolvable from this checkout:
$env:PLAYWRIGHT_PACKAGE = 'C:\path\to\playwright\index.mjs'
node lensmu/website/test/browser/acceptance.mjs
```

The default run uses deterministic HTTP fixtures for provider responses and a locally generated non-sensitive image. `WEBSITE_URL` overrides the origin; `BROWSER_ARTIFACTS` selects the output directory. To additionally exercise real OCR and MyMemory, set `LIVE_OCR_URL` and `LIVE_IMAGE` to a running backend and a non-sensitive Japanese PNG. The backend must allow the website origin. The live service may be rate limited or unavailable; no keys or dependencies are written into the repository by the harness.

## Changed paths owned by this implementation

Deleted paths in the list below are intentional removals of unused sections/helpers. Shared contracts, background/core changes and their tests are documented by their respective owners.

- `lensmu/extension/src/popup/App.jsx`
- `lensmu/extension/src/popup/components/ApiKeyInput.jsx`
- `lensmu/extension/src/popup/components/LanguageSelector.jsx`
- `lensmu/extension/src/popup/components/OcrSettings.jsx`
- `lensmu/extension/src/popup/components/ReadAloudSettings.jsx`
- `lensmu/extension/src/popup/components/RichSelect.jsx`
- `lensmu/extension/src/popup/components/SettingFields.jsx`
- `lensmu/extension/src/popup/index.html`
- `lensmu/extension/src/popup/runtime.js`
- `lensmu/extension/src/popup/settings-persistence.js`
- `lensmu/extension/src/popup/speech-preview.js`
- `lensmu/extension/src/popup/use-account-session.js`
- `lensmu/extension/src/popup/use-page-session.js`
- `lensmu/extension/src/popup/use-settings-session.js`
- `lensmu/extension/src/popup/use-speech-preview.js`
- `lensmu/extension/src/styles/globals.css`
- `lensmu/extension/test/settings-persistence.test.js`
- `lensmu/extension/test/speech-preview.test.js`
- `lensmu/website/app/about/page.tsx`
- `lensmu/website/app/contact/page.tsx`
- `lensmu/website/app/globals.css`
- `lensmu/website/app/install/page.tsx`
- `lensmu/website/app/layout.tsx`
- `lensmu/website/app/page.tsx`
- `lensmu/website/app/translate/page.tsx`
- `lensmu/website/components/layout/BrandLogo.tsx`
- `lensmu/website/components/layout/Footer.tsx`
- `lensmu/website/components/layout/Navbar.tsx`
- `lensmu/website/components/sections/AboutSection.tsx`
- `lensmu/website/components/sections/ContactSection.tsx`
- `lensmu/website/components/sections/DemoSection.tsx`
- `lensmu/website/components/sections/Hero.tsx`
- `lensmu/website/components/sections/HowItWorksSection.tsx`
- `lensmu/website/components/sections/PanelSample.tsx`
- `lensmu/website/components/sections/TeamSection.tsx`
- `lensmu/website/components/sections/TranslatorSection.tsx`
- `lensmu/website/components/sections/UseCasesSection.tsx`
- `lensmu/website/components/ui/reveal-on-scroll.tsx`
- `lensmu/website/data/site.ts`
- `lensmu/website/lib/demo-ocr.ts`
- `lensmu/website/lib/demo-pipeline.test.mjs`
- `lensmu/website/lib/demo-translation.ts`
- `lensmu/website/lib/image-input.ts`
- `lensmu/website/lib/image-renderer.ts`
- `lensmu/website/lib/preferences-schema.ts`
- `lensmu/website/lib/preferences-store.ts`
- `lensmu/website/lib/test-import.mjs`
- `lensmu/website/lib/translation-session.d.ts`
- `lensmu/website/lib/translation-session.js`
- `lensmu/website/lib/translation-session.test.mjs`
- `lensmu/website/lib/translator-types.ts`
- `lensmu/website/lib/translator.ts`
- `lensmu/website/public/sample-panel-translated.svg`
- `lensmu/website/public/sample-panel.svg`
- `lensmu/website/README.md`
- `lensmu/website/tailwind.config.ts`
- `lensmu/website/test/browser/acceptance.mjs`
- `docs/website-popup-implementation.md`
- `docs/ui-gates.json`
- `docs/screenshots/website-desktop.png`
- `docs/screenshots/website-mobile.png`
- `docs/screenshots/demo-real-output.png`
