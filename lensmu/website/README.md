# lensmu website

The website introduces the Chrome extension, provides a local installation guide at `/install`, and hosts a deliberately limited image translator at `/translate`. The comic in the home page and demo is original SVG artwork with a prepared translation; switching it makes no provider request.

## Run

Use Node.js 20.19 or newer (the same baseline as the extension and CI).

```sh
cd lensmu/website
npm ci
npm run dev
```

Open `http://localhost:3000`. Public pages do not require Auth0. Sign-in and the preferences API activate only with the server configuration described in `.env.example`. Cross-device extension sync is not enabled in this build.

## Image demo

Follow `../backend/README.md` to install a supported OCR profile and start the backend. The default OCR address is `http://localhost:8000`; a different local port can be entered under Local OCR server address. Configure the backend CORS allowlist if this website is served from another origin.

The browser sends image pixels to that backend and extracted text to MyMemory. The demo supports JPG, PNG and WEBP up to 10 MB, 16 megapixels, and 16,384 pixels on either side. It provides cancellation, per-region progress, original/translated comparison, PNG download, and a readable transcript. Regions that cannot fit retain their original pixels; zero-render results are errors. MangaOCR requires Japanese input. No API keys are collected by the demo.

## Ownership

- `lib/translator.ts`: one cancellable request, composing image decoding, OCR, translation and rendering.
- `lib/image-input.ts`: file validation, image decoding and local read cleanup.
- `lib/demo-ocr.ts`: HTTP adapter for the shared runtime OCR response contract and Manga region batching.
- `lib/demo-translation.ts`: bounded MyMemory requests using the extension's canonical translation rules.
- `lib/image-renderer.ts`: canvas adapter consuming the shared display plan, with explicit region outcomes.
- `lib/translation-session.js`: accepts only the current request's events and owns output URL lifetime.
- `lib/preferences-schema.ts`: Zod adapter around the extension's canonical preference validator.
- `app/layout.tsx`: persistent navigation/auth/theme shell; individual routes own their main content.

## Verify

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

The tests cover real Jose error mapping, the production TypeScript OCR/render interfaces, cancellation and URL cleanup. `lib/test-import.mjs` compiles production TypeScript in memory with the existing compiler, so tests work on CI Node 20 without another runtime dependency. Tests using controlled adapters do not establish real OCR/provider availability; record live browser results separately.

Fonts use named local/system fallbacks. The site does not download fonts or load stock image/CDN assets for its main demonstration. The contact form opens an email draft for the user to send; it does not claim to send a message itself.
