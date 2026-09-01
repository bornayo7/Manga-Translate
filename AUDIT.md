# AUDIT.md — VisionTranslate deep repair

Branch: `audit/deep-repair` (from `main` @ `48955f8` "Overhaul").
Status legend for findings: **open** / **fixed** / **deferred** / **won't-fix**.

## Review pass — 2026-09-01

A second full read of the tree, running every build and test suite first.
Baseline on entry: **`npm test` in `lensmu/extension` exited 1** — the previous
pass left a hard syntax error in a shipped module, so CI on this branch was red
and the extension could not translate anything at all.

### Fixed in this pass

| Severity | File | Finding |
|---|---|---|
| **blocker** | `extension/translate/libre-translate.js` | `translateWithMyMemory` was declared twice in one module scope (exported entry point + private batch helper), so the module failed to parse: `SyntaxError: Identifier 'translateWithMyMemory' has already been declared`. `translate-manager.js` imports it, so **every** translation path died at module load, not just MyMemory. The exported wrapper also called itself rather than the helper, so it would have recursed infinitely had it parsed. Private helper renamed to `translateEachText`. |
| major | `extension/background.js` | With MangaOCR selected and PaddleOCR detecting no regions, background posted a synthetic box `[[0, 0, 1000000, 1000000]]` to `/ocr/manga`. The backend caps coordinates at `MAX_MANGA_COORDINATE` (100_000) and total area at `MAX_MANGA_TOTAL_REGION_PIXELS` (50_000_000), so that request was rejected 422 every time. Now returns an empty block list — MangaOCR recognizes crops and cannot detect regions, so there is nothing to send. |
| major | `extension/content.js` | The MutationObserver flush read `mutationsList` from whichever callback armed the surviving debounce timer, so `invalidateImageState()` only ran for the **last** batch. On lazy-loading pages several `src` swaps land in one 500 ms window, leaving stale overlays pinned over changed images. Changed images now accumulate in a `Set` drained on flush. |
| major | `backend/ocr_engines/paddle_ocr.py` | `_polygon_to_bbox` promised "the tightest axis-aligned rectangle that contains all 4 points" but built it with `int()`, which truncates toward zero and pulls the right/bottom edges *inside* the region. Those bboxes are reposted to `/ocr/manga` as crop rectangles, so this could shave the last glyph off a bubble before MangaOCR saw it. Now floors minimums and ceils maximums. (`_normalize_box` already rounded properly — that is how the two disagreed.) |
| minor | `extension/src/popup/App.jsx` | The local-storage fallback save wrote raw React state, bypassing the `mergeWithDefaults` every other writer goes through. |
| minor | `extension/utils/storage.js` | `migrateLegacySettings` only runs when `vt_settings` is absent, so legacy top-level keys sitting beside an existing `vt_settings` were never cleaned. `saveSettings` masked that with an unconditional `remove(LEGACY_SETTING_KEYS)` on every save, including the popup's per-keystroke debounced one. Cleanup moved to the read path, conditional. |
| minor | `extension/auth/auth0.js` | The PKCE token exchange was the last bare `fetch()` in the extension; a stalled connection left `login()` awaiting forever with the popup stuck on "Signing in...". Now uses `fetchWithTimeout`. |
| minor | `extension/translate/llm-translate.js` | `getLanguageName` had no `zh-CN` entry, but `LanguageSelector` emits `zh-CN` (never bare `zh`), so prompts read "translate ... to zh-CN". |
| minor | `extension/manifest.json` | `host_permissions` listed `<all_urls>` plus 13 hosts it already subsumes — including three LibreTranslate instances the extension no longer contacts at all. A permission list that names services the code never calls misrepresents where user text goes. Collapsed to `<all_urls>`. |
| minor | `backend/server.py`, `ocr_engines/manga_ocr.py` | `/health` read the private `MangaOCREngine._instance`. Added a public `is_loaded()`. |

### Redundancy removed

| Cluster | Was | Now |
|---|---|---|
| `normalizeForComparison`, `isEffectivelyIdenticalTranslation`, `stripDataUrlPrefix`, `toErrorMessage` | copies in `background.js`, `offscreen/ocr.js`, `translate-manager.js`, `libre-translate.js` | new `extension/shared/text.js` |
| `clampNumber` | `tts/elevenlabs.js`, `popup/components/ReadAloudSettings.jsx` | `shared/preferences.js` (+ `.d.ts`) |
| `'vt_settings'` literal | `utils/storage.js`, `popup/App.jsx` | `SETTINGS_STORAGE_KEY` in `shared/preferences.js` |
| dead functions | `overlay.js`: `insetBox`, `getConfidenceBorderColor`, `truncateWithEllipsis`, `restoreOriginal`. `content.js`: `createToolbar`, `updateToolbarStatus`, `toggleAllOverlays`, `toolbarContainer`, no-op `showIcon`/`hideIcon` + their `removeEventListener` calls, `TRANSLATE_PAGE` alias. `background.js`: `getMessageSettings`, a shadowed `rawImage`. `ocr/tesseract.js`: the `globalThis.Tesseract` branch. `auth/auth0.js`: `isAuthenticated()`. `paddle_ocr.py`: write-only `_instance`. | deleted |
| dead website files | `.eslintrc.json` (legacy format, ignored by ESLint 9 flat config), `FeaturesSection.tsx`, `githubLinks`/`linkedinLinks`, duplicated `@/lib/auth0` import in `layout.tsx` | deleted |
| dead CSS | 66 lines of `.choice-card` radio-picker rules replaced by `RichSelect`; popup CSS 20.24 kB to 19.28 kB | deleted |
| `ocr_engines/__init__.py` | `__all__` named two symbols the package deliberately does not import, so `import *` raised `AttributeError` | replaced with a pointer to the real module paths |

### Verified after every change

`extension`: `npm test` 16/16, `npm run build` clean.
`backend`: `pytest test_server.py` 29 passed.
`website`: `eslint .` clean, `tsc --noEmit` clean, `next build` clean.

### Deliberately not changed

Two duplicate helper copies stay: `content.js` is registered as a **classic**
content script and cannot use static imports, and `ocr/tesseract.js` is
dynamically imported by it on the non-Chrome OCR path. Sharing would mean
routing one-liners through `import()` and widening `web_accessible_resources`
— a net loss for five lines each.

### Still open

Behavioural or product decisions, not deterministic defects:

- **Firefox (M3)** — the manifest declares only `background.service_worker`;
  Firefox MV3 wants `background.scripts`. Unverified: no Firefox available here.
- **Docker (M9)** — `Dockerfile` installs `libgl1-mesa-glx`, removed in Debian
  12, which is what `python:3.11-slim` is based on. Unverified: no Docker here.
- **Offscreen lifetime (m19)** — the offscreen document and its Tesseract worker
  are created once and never closed. `terminateWorker()` exists and is correct
  but nothing calls it; wiring idle teardown is a lifecycle design change, not a
  cleanup, so it is left for a deliberate pass.
- **Tesseract `auto` (m32)** — maps to `eng+jpn` only, so "auto" users reading
  Korean or Chinese get nothing. Widening it loads four models per recognition;
  that is a real speed/coverage trade-off to decide, not a bug to patch.
- **LLM `max_tokens: 2000` (m22)** — caps a response at roughly 30 blocks.
- **MyMemory has no fallback (M2)** — 5,000 chars/day anonymous, and the dead
  LibreTranslate instances are now gone from the manifest too. The free tier is
  MyMemory-or-nothing by design; that needs a product answer.
- **Preference sync (M8)** — `website/app/api/preferences` is still callable and
  still has no caller. The extension requests no `audience`, so its token could
  not pass `api-auth.ts` anyway.
- **`website/lib/translator.ts` (M29)** — still a second renderer alongside
  `overlay.js`; deferred as a "limited demo" per PIPELINES.md.
- **English stop-word list (m21)** — still overfit to one test passage
  (`climbed`, `eastward`, `steep`, `sky`, `sun`, `watch`, ...).
- **Root `.env.example`** — documents four variables no code reads.

---

## Remediation update — 2026-08-31

The deterministic security and reliability findings from this audit and the
follow-up repository audit have been repaired. Highlights: content scripts no
longer receive credentials; sensitive payload logging is removed; provider
fallback is opt-in; external requests time out; Tesseract work is serialized;
host styles are restored; image and MangaOCR workloads are bounded; long text
uses one tested chunker; dead OCR routing was removed; localhost is the backend
default; setup scripts and documentation match the live architecture; and CI
now validates all three applications.

Still intentionally deferred because they require deployment configuration or
a product choice: Auth0 preference-sync wiring, Firefox packaging/testing, real
OCR-model/provider smoke tests, and a broader redesign that avoids wrapping
host-page images merely to display per-image controls.

---

## Phase 0 — Baseline (recorded before any edits)

| Item | Result |
|---|---|
| Toolchain present | node v24.11.1, npm 11.6.2, Python 3.12.10 (system, no venv), pip 25.0.1. No Docker. |
| `lensmu/extension` `npm run build` | OK — Vite 8.2.2 → `dist/popup/{index.html,popup.js,popup.css}` |
| `lensmu/extension` `npm test` | 3/3 pass (`node --test test/preferences.test.js`) |
| `lensmu/website` `next build` | OK — Next 16.3.1/Turbopack; prints "Auth0 is disabled" warning 7× (no env) |
| `lensmu/website` `tsc --noEmit` | 0 errors |
| `lensmu/website` `eslint .` | clean |
| `lensmu/backend` `pytest test_server.py` | 22 passed (1 StarletteDeprecationWarning: httpx with `starlette.testclient`) |
| `lensmu/backend` `python server.py` | starts; `GET /health` → 200. Startup warnings are logged twice (module imported twice). |
| `npm audit` (both) | 0 vulnerabilities |
| `pip-audit` | not installed (not run) |
| Secret scan, full git history (excl. vendored) | nothing found. Auth0 tenant + public client id hardcoded in `extension/auth/auth0.js`. |
| PaddleOCR / manga-ocr | not installed locally → OCR endpoints return 501; engine wrappers are **unverifiable** here |

So the rewrite *compiles and its existing tests pass*. The defects are behavioral, structural, and in untested paths.

---

## Phase 1 — Project map

### Languages, package managers, toolchain pins

| Sub-project | Language | Manager / lockfile | Pins |
|---|---|---|---|
| `lensmu/backend` | Python 3.12 (README says 3.8+/3.10+; setup scripts want 3.12) | pip; `requirements.txt`, `requirements-dev.txt`, `requirements-ocr.txt` — **no lockfile**, all `>=` ranges | Dockerfile `python:3.11-slim`, `paddlepaddle==2.6.2` |
| `lensmu/extension` | JS (ESM), React 18, JSX | npm; `package-lock.json` v3 | `engines.node >=20.19.0`; vite ^8.2.2, tesseract.js ^5.1.0 (vendored copy in `lib/` = 5.1.1) |
| `lensmu/website` | TypeScript, Next.js 16 App Router, Tailwind 3 | npm; `package-lock.json` v3 | `engines.node >=20.9.0`; next ^16.3.1, zod ^4, @auth0/nextjs-auth0 ^4.17, auth0 ^4.37 |

No CI: `.github/workflows/` exists locally but is empty and untracked.

### Entry points

- **Extension (the product)**: `manifest.json` (MV3) → `background.js` (module service worker), `content.js` (content script on `<all_urls>`, document_idle), `dist/popup/index.html` (React popup built by Vite from `src/popup`), `offscreen/ocr.html` (offscreen doc that runs Tesseract). `content.js` dynamically imports `overlay.js` and `ocr/tesseract.js` via `web_accessible_resources`.
- **Backend**: `python server.py` → uvicorn on `0.0.0.0:8000`; FastAPI app `server:app`. Docker `CMD ["python","server.py"]`.
- **Website**: `next dev|build|start`; routes `/`, `/about`, `/contact`, `/translate`, `/api/preferences`; `proxy.ts` (Next 16 middleware) wraps Auth0.
- **Setup scripts**: `setup.sh`, `setup.ps1` (root) — create venv, pip install, npm install, vite build.

### Directory responsibilities

```
lensmu/backend/
  server.py            FastAPI app: /health, /ocr/paddle, /ocr/manga; base64 decode; language aliasing
  security.py          body-size limit, per-IP rate limiter, security headers (ASGI + BaseHTTPMiddleware)
  ocr_engines/         PaddleOCR + MangaOCR singleton wrappers (2.x/3.x compat shims)
  test_server.py       22 contract tests w/ fake engines
lensmu/extension/
  background.js        message router; OCR routing (inline!); translation dispatch; auth; TTS; tab state/badge
  content.js           image discovery, per-image icons, OCR→group→translate→render pipeline w/ cancellation, read-aloud UI
  overlay.js           pure-ish: groupTextBlocks, buildSpeechText, renderTranslation (canvas), container detection
  ocr/tesseract.js     Tesseract.js wrapper (used by offscreen doc + content-script fallback)
  ocr/{ocr-manager,backend-ocr,cloud-vision}.js   DEAD — nothing imports them (background does its own routing)
  translate/           translate-manager (provider routing + "already target language" heuristics), llm-translate, libre-translate (MyMemory + LibreTranslate)
  tts/elevenlabs.js    ElevenLabs TTS + audio cache in chrome.storage.local
  auth/auth0.js        PKCE login via chrome.identity
  shared/preferences.js(+.d.ts)  canonical defaults, local-only key list, merge/split helpers (shared with website)
  utils/storage.js     vt_settings read/write + legacy migration; disabled-domain list; dead API-key helpers
  src/popup/           React popup (App.jsx + 7 components), styles/globals.css
  lib/                 vendored tesseract.js 5.1.1 runtime + 4 wasm cores (~30 MB)
lensmu/website/
  app/                 pages + /api/preferences (GET/PUT/OPTIONS)
  lib/auth0.ts, api-auth.ts, extension-cors.ts, preferences-schema.ts, preferences-store.ts (Auth0 user_metadata)
  lib/translator.ts    browser-side demo pipeline (backend OCR → MyMemory → canvas redraw) — duplicates overlay.js in simpler form
  components/          marketing sections + shadcn-style ui primitives
  data/site.ts         copy, team, links
```

### External dependencies & env vars

Services: local FastAPI backend (`backendUrl`, default `http://localhost:8000`); MyMemory (`api.mymemory.translated.net`, no key); LibreTranslate instances (×3, **all currently non-functional**); OpenAI / Anthropic / Gemini / custom OpenAI-compatible; Google Cloud Vision; ElevenLabs; Auth0 (tenant `dev-f061rrmnizussvbh.us.auth0.com`); jsDelivr (Tesseract traineddata); GitHub/Unsplash (website images).

Env vars referenced in code:

| Var | Where | Documented? |
|---|---|---|
| `AUTH0_DOMAIN` / `AUTH0_ISSUER_BASE_URL` | website/lib/auth0.ts | `.env.example` has `AUTH0_DOMAIN` only |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL` | website/lib/auth0.ts | yes |
| `AUTH0_API_AUDIENCE` | website/lib/api-auth.ts | yes |
| `AUTH0_MANAGEMENT_CLIENT_ID/_SECRET` | website/lib/preferences-store.ts (falls back to client creds) | yes |
| `VT_EXTENSION_ORIGINS` | website/lib/extension-cors.ts | yes |
| `NODE_ENV` | website/lib/auth0.ts | implicit |
| `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK` | backend/ocr_engines/paddle_ocr.py (sets it) | no |
| `HF_ENDPOINT` | backend/README only | README |
| `BUILD_TARGET` | extension package.json scripts + setup scripts | **read by nothing** (vite.config.js ignores it) |
| Root `.env.example` (`GOOGLE_CLOUD_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `BACKEND_URL`) | read by **no code** (file says so) | documentation only |

Backend host/port are hardcoded (`0.0.0.0:8000`); no env/CLI override.

### Existing tests

- Backend: 22 pytest contract tests (validation, CORS, mocked engines, body limit). Pass. Shares one module-level `TestClient`; the rate limiter and engine singletons are global state, so tests are order-coupled in principle (passes today because <60 requests).
- Extension: 3 `node --test` unit tests for `shared/preferences.js`. Nothing for overlay grouping, translation heuristics, LLM response parsing, storage migration, background routing, or any provider client.
- Website: none.
- Coverage: not measured by any tool; obtainable for backend via `pytest --cov` (not installed) — see Phase 5.

### Lint / type / format

- Website: `eslint.config.mjs` (flat, next/core-web-vitals + typescript) — enforced by `npm run lint`, currently clean. A stale `.eslintrc.json` (legacy format) also exists and is ignored by ESLint 9. `tsconfig` strict; `tsc --noEmit` clean. No Prettier.
- Extension: **no ESLint, no type checking** (plain JS + hand-written `.d.ts`). Nothing enforced.
- Backend: **no ruff/flake8/mypy/black** config; nothing enforced.

### Top 10 things that look most wrong at a glance (pre-deep-dive)

1. `ocr/ocr-manager.js`, `ocr/backend-ocr.js`, `ocr/cloud-vision.js` (≈1,270 lines) are imported by nothing; `background.js` re-implements OCR routing inline with *different* engine ids — and the dead client parses the wrong response key (`results` vs backend's `detections`).
2. One shared `llmModel` setting (default `gemini-2.0-flash`) is sent to OpenAI/Claude too; the `|| 'gpt-4o-mini'` fallbacks can never fire.
3. Content script logs the full settings object — including every API key — to every page's console on activation, and activation is automatic on every site by default.
4. All three LibreTranslate fallback instances are dead; the "free" provider is MyMemory-only with a 5,000 char/day anonymous quota and no working fallback.
5. README/CONTRIBUTING/setup scripts reference files and build targets that don't exist (`google-translate.js`, `paddleocr_engine.py`, `BUILD_TARGET=overlay`, `lensmu-backend serve`).
6. Manifest claims Firefox support but declares only `background.service_worker`; Firefox MV3 needs `background.scripts`, so the background never runs there.
7. Google Cloud Vision OCR reads `customOcrApiKey` *before* `googleCloudApiKey` (plus two invented legacy keys).
8. Website preference-sync API (`/api/preferences`, JWT verification, Auth0 Management client, CORS allowlist) has no caller anywhere — extension never syncs, website has no UI for it.
9. `python server.py` imports the app module twice (`uvicorn.run("server:app")`) → duplicated middleware registration logs; rate limiter dict grows per IP forever.
10. Massive comment-to-code ratio with tutorial prose; three copies each of `previewText`, `normalizeForComparison`, `sha256Hex`, `stripDataUrlPrefix`; ElevenLabs defaults duplicated outside `shared/preferences.js`.

---

## Phase 2 — Findings inventory (ordered by severity)

Severity: **blocker** = primary flow/security broken or data loss; **major** = a feature is broken or user-visibly wrong; **minor** = robustness/smell/drift; **nit** = style/docs.

### Blockers

| ID | File:line | Finding | Failure scenario | Status |
|---|---|---|---|---|
| B1 | `extension/content.js:2733` (+ `background.js:586`) | `console.log('Activating with settings:', currentSettings)` prints the entire settings object including `openaiApiKey`, `claudeApiKey`, `geminiApiKey`, `googleCloudApiKey`, `elevenLabsApiKey`, `customApiKey`, `customOcrApiKey` to the *page's* DevTools console. `autoTranslate` defaults to true, so this happens on every page load of every site. | User opens DevTools on any site (or shares a console log / screen-records a bug report) → all their provider keys are visible in plain text. | open |
| B2 | `extension/translate/translate-manager.js:515,533,551`; `shared/preferences.js:20`; `src/popup/components/TranslateSettings.jsx:53-72,196-220` | `llmModel` is a single setting shared by all providers with default `'gemini-2.0-flash'`. `mergeWithDefaults` guarantees it is non-empty, so `settings.llmModel \|\| 'gpt-4o-mini'` never falls through. The popup's model `<select>` for OpenAI/Claude has no option matching the stored value, so it renders as if a model were chosen while state still holds the Gemini id. | User picks OpenAI, pastes a valid key, clicks Translate → request `model: "gemini-2.0-flash"` → 404 from OpenAI → `translate-manager` silently falls back to MyMemory with `fallback: true` → user believes GPT translated the page. Same for Claude. | open |

### Majors

| ID | File:line | Finding | Failure scenario | Status |
|---|---|---|---|---|
| M1 | `extension/ocr/ocr-manager.js`, `ocr/backend-ocr.js`, `ocr/cloud-vision.js` | Dead modules (no importer). They also contradict the live code: engine ids `paddle/manga/cloud-vision` vs background's `paddleocr/mangaocr/google_vision`; settings keys `cloudVisionApiKey`/`mangaBboxes` that don't exist; `backend-ocr.js:387,418` reads `responseData.results \|\| responseData.data` while the backend returns `detections`; error text tells users to run a non-existent `lensmu-backend serve` CLI. CONTRIBUTING.md tells contributors to register new engines here. | Anyone following CONTRIBUTING adds an engine to a file that is never executed; anyone "fixing" OCR edits the wrong layer. If ever wired up, backend OCR would always return "no text". | open |
| M2 | `extension/translate/libre-translate.js:67-71,149-167` | All three LibreTranslate instances are non-functional today (`libretranslate.com` → 400 key required; `translate.terraprint.co` → 502; `translate.fedilab.app` → 403). The default provider (`libre`) is therefore MyMemory with no fallback. MyMemory anonymous quota is 5,000 chars/day. | Heavy page or second manga chapter of the day → MyMemory returns status 403 → three more failing requests → "All free translation services failed" for every image until tomorrow. LLM providers also "fall back" to this dead path. | open |
| M3 | `extension/manifest.json:51-54`; README "Firefox" section | Background declared only as `service_worker`; Firefox MV3 requires `background.scripts` (it ignores a `service_worker`-only manifest). `offscreen` permission and `chrome.offscreen` are Chrome-only; the Firefox fallback path (`useClientOCR`) exists but is unreachable because the background never starts. | Load in Firefox per README → no background → popup messages time out → nothing works. | open (unverified in a real Firefox; based on MDN) |
| M4 | `extension/background.js:901-905`; `src/popup/components/OcrSettings.jsx:110-120` | Google Cloud Vision uses `settings.customOcrApiKey` *first*, then `googleCloudApiKey`, then two keys that never existed (`googleVisionApiKey`, `cloudVisionApiKey`). `customOcrApiKey` is the same field used by the Custom OCR engine. | User configures Custom OCR with a bearer key, later switches to Cloud Vision and enters a Google key → the custom key is sent to Google → 400/403 with a confusing message. | open |
| M5 | `extension/content.js:1202-1225,2466-2571` | Every activation runs `scanForImages()` which calls `getComputedStyle()` on **every** `div, section, header, article, figure, span, a` ≥ min size, and a `MutationObserver` with `attributeFilter: ['src','srcset','style']` on the whole subtree re-runs it (debounced 500 ms) whenever *any* element's inline `style` changes. | Any site with JS-driven inline-style animation (carousels, progress bars, React animation libs) → perpetual full-page rescans with forced layout every 500 ms while the tab is open; visible jank on large pages. | open |
| M6 | `extension/content.js:2141-2165,1324-1331` | Default-on activation wraps every qualifying `<img>` whose parent is `position: static` in a new `display:inline-block` `div` (and on click, a second fixed-pixel wrapper, forcing `width/height:100%` on the image). | Responsive images (`width:100%` in flex/grid, `display:block; margin:auto`, `object-fit` heroes) change size/alignment on every site the user visits even if they never translate anything. Overlays don't track window resize (fixed px). | open — needs product decision (see checkpoint) |
| M7 | `extension/tts/elevenlabs.js:3-4,128-145` | Audio cache stores up to 8 MB of base64 data URLs in `chrome.storage.local` (default quota 10 MB; `unlimitedStorage` not requested). Every TTS call reads and rewrites the whole cache blob. No clear-cache UI. | After ~8 MB of cached audio + settings, `chrome.storage.local.set` throws `QUOTA_BYTES quota exceeded` → every Read Aloud fails with an opaque error until the user finds "Reset Settings" (which also wipes their keys). | open |
| M8 | `website/app/api/preferences/route.ts`, `lib/api-auth.ts`, `lib/preferences-store.ts`, `lib/extension-cors.ts`; `extension/auth/auth0.js:97-106` | Half-finished sync feature: website exposes a full preferences API (JWT/JWKS verification with `AUTH0_API_AUDIENCE`, Management API writes, extension CORS allowlist) but nothing calls it — not the website UI, not the extension. The extension's login requests no `audience`, so its access token is opaque and could never pass `api-auth.ts`. Popup copy admits "Cross-device settings sync is not enabled in this build." | Dead but deployable surface area that writes to Auth0 user_metadata; maintenance burden; misleading docs (REPO_MAP/DECISIONS describe it as the goal). | open — needs product decision |
| M9 | `lensmu/backend/Dockerfile:27` | `apt-get install libgl1-mesa-glx` — that package was removed in Debian 12 (bookworm), which is what `python:3.11-slim` is based on. | `docker build` fails at the apt step. | open (unverified: no Docker here; well-documented Debian change) |
| M10 | `website/components/sections/ContactSection.tsx:50-62` | Contact form validates, then shows "Thanks. Your message has been received by the VisionTranslate team." while sending nothing anywhere. | Business inquiries are silently dropped and the sender is told otherwise. | open — needs product decision |
| M11 | `extension/background.js:781-786,490-550` | `PROXY_FETCH`: any message can make the service worker fetch **any URL with any headers/options** (host permission `<all_urls>`) and return the body. No caller exists in the codebase (content.js never sends it). `options.signal` can't cross a message boundary, so that branch is dead too. | Unused privilege surface; if any future content-script bug lets page-controlled data reach `sendMessage`, it becomes an SSRF/exfil primitive. | open |
| M12 | Test coverage (all three projects) | Core logic has no tests: `overlay.groupTextBlocks`, `buildSpeechText`, `wrapText`; `translate-manager.shouldTranslateTextBlock`/dispatch/fallback; `llm-translate.parseNumberedResponse`; `storage.js` legacy migration; background message routing; Paddle/Manga response mapping; website schema vs shared defaults (verified manually only); no end-to-end smoke of OCR→translate→render. | Any of the fixes above can regress silently. | open |

### Minors

| ID | File:line | Finding | Status |
|---|---|---|---|
| m1 | `backend/server.py:324-333` | `uvicorn.run("server:app")` re-imports the module as `server` while `__main__` already executed it → every middleware/log/semaphore is created twice (explains doubled startup logs). Use the `app` object. | open |
| m2 | `backend/security.py:107-134` | Rate limiter `defaultdict(list)` keyed by client IP never evicts idle IPs; unbounded growth on a long-lived public bind. | open |
| m3 | `backend/server.py:328` | Binds `0.0.0.0` with no auth by default → local OCR server exposed on the LAN. Needs 0.0.0.0 only inside Docker. | open — behavior change, see checkpoint |
| m4 | `backend/server.py:242` | Reaches into `MangaOCREngine._instance` (private) for `/health`. Add `is_loaded()`. | open |
| m5 | `backend/server.py:21-24,30-33,44-47` | `if __package__:` relative/absolute import shims in three places. | open |
| m6 | `backend/ocr_engines/paddle_ocr.py:80,137` | Unused legacy `_instance` alias kept "for older code" that doesn't exist. `int()` truncation in `_polygon_to_bbox` vs `round()` in `_normalize_box`. | open |
| m7 | `backend/test_server.py` | Module-level shared `TestClient`; invalid-base64 tests accept `400 or 501` (non-deterministic contract); no test for the streamed-body limit path, base64 whitespace handling, or 413 from `validate_image_size`. | open |
| m8 | `backend/README.md`, root `README.md`, `CONTRIBUTING.md`, `.env.example` | Doc drift: `/health` shape; "requirements.txt installs PaddleOCR"; file names `paddleocr_engine.py`/`mangaocr_engine.py`/`google-translate.js`; defaults table (Google Translate default, opacity 0.85, font size auto); Python 3.8+ vs 3.12 requirement; `.env.example` documents vars no code reads. | open |
| m9 | `setup.sh:126-127`, `setup.ps1:128-134` | `BUILD_TARGET=overlay vite build` — no such target; builds the popup twice. `setup.sh` hides npm/vite errors with `2>/dev/null`. `setup.ps1` installs unpinned `paddlepaddle`. Neither installs `requirements-dev.txt`. | open |
| m10 | `extension/package.json` | `webextension-polyfill` declared, never imported. `cross-env BUILD_TARGET=…` in 4 scripts though vite.config ignores it; `dev` and `watch:popup` are identical. | open |
| m11 | `extension/utils/storage.js:84-108,137-145,148-165` | Dead: `getApiKeys/saveApiKey/removeApiKey` (legacy `vt_api_keys` with google/deepl/azure), `clearAllData`, `onSettingsChanged`. `saveSettings` issues a redundant `remove(LEGACY_SETTING_KEYS)` on every save. | open |
| m12 | `extension/shared/preferences.js:70-83` | `mergeWithDefaults` does no type validation; a stored `null`/string for a numeric key is kept as-is (callers defensively `Number()` it everywhere). | open |
| m13 | `extension/tts/elevenlabs.js:6-15` | `DEFAULT_ELEVENLABS_SETTINGS` duplicates `shared/preferences.js` defaults (drift). `Accept: audio/mpeg` sent even for wav/pcm output formats. | open |
| m14 | `extension/overlay.js:1385-1407,680-688,495-508,1770-1777` | Dead: `truncateWithEllipsis`, `getConfidenceBorderColor`, `insetBox`, exported `restoreOriginal`. | open |
| m15 | `extension/content.js:2601,2608,2620-2630,1469-1471,184,2263-2264,216-237` | Dead: `createToolbar`, `updateToolbarStatus`, `toggleAllOverlays`, `removeOverlay` alias, `toolbarContainer`, no-op `showIcon/hideIcon` + their removeEventListener calls, orphaned `imageToBase64` docblock, unused `TRANSLATE_PAGE` message alias. | open |
| m16 | `extension/content.js`, `translate/translate-manager.js`, `translate/libre-translate.js`, `tts/elevenlabs.js`, `background.js`, `offscreen/ocr.js`, `ocr/tesseract.js` | Duplicate helpers: `previewText` ×3, `normalizeForComparison`/`isEffectivelyIdenticalTranslation` ×3 (+ website), `sha256Hex` ×2, `stripDataUrlPrefix` ×3, `toErrorMessage`/`getErrorMessage` ×3, `clampNumber` ×2, `languagesClearlyDiffer` ×2. | open |
| m17 | `extension/background.js:730-734` | Logs every inbound message payload; `sanitizeForLog` redacts keys but not `imageBase64`, so every OCR request dumps a multi-MB base64 string into the SW console. `content.js` lifecycle logging is similarly unconditional. | open |
| m18 | `extension/background.js:160-180,901-905` | `normalizeOcrEngine` accepts nine spellings; `googleVisionApiKey`/`cloudVisionApiKey` never existed. | open |
| m19 | `extension/background.js:276-330` | Offscreen document (and its Tesseract worker, hundreds of MB) is created once and never closed. | open |
| m20 | `extension/background.js:1250-1278` | `FETCH_IMAGE` has no size cap or timeout; a 100 MB image is buffered and base64'd in the SW and then again in the content script. | open |
| m21 | `extension/translate/translate-manager.js:93-168,389-399` | Language heuristics: English "stop words" include `climbed, gray, eastward, trail, sky, steep, sun, watch` (overfit to one test passage). `short-ambiguous-text` rule silently skips any ≤2-word Latin text when source is `auto` (e.g. a sign reading "Ausfahrt" is never translated). | open |
| m22 | `extension/translate/llm-translate.js` | No request timeouts; `max_tokens: 2000` caps at ~30 blocks; OpenAI/Claude default model ids are 2025-era (valid but dated); `getLanguageName` lacks `zh-CN`. | open |
| m23 | `extension/translate/libre-translate.js:327-369` | `translateLongText` pushes a single >500-char sentence as one chunk (MyMemory rejects). | open |
| m24 | `extension/src/popup/App.jsx:13,97-111,249-251` | Duplicates `SETTINGS_KEY`; fallback writes raw state to storage bypassing `mergeWithDefaults`. Number inputs emit `0` on empty. | open |
| m25 | `extension/src/popup/components/ErrorBoundary.jsx:49-57` | "Reset Settings" = `chrome.storage.local.clear()` — wipes auth tokens and audio cache too (acceptable but undocumented). | open |
| m26 | `website/lib/preferences-schema.ts` | Hand-maintained key list must stay identical to `DEFAULT_SYNCED_PREFERENCES` (`.strict()`); currently 25/25 (verified by running it) but unguarded. Bounds drift: `elevenLabsSpeed` 0.5–2 vs extension 0.7–1.2; `maxConcurrentImages` ≤32 vs popup/content ≤12. | open |
| m27 | `website/.eslintrc.json` | Legacy ESLint config ignored by ESLint 9 flat config — dead/confusing. | open |
| m28 | `website/components/sections/FeaturesSection.tsx`, `data/site.ts:198-216` | `FeaturesSection`, `githubLinks`, `linkedinLinks` unused. `app/layout.tsx` imports `@/lib/auth0` twice. | open |
| m29 | `website/lib/translator.ts:440-672` | Re-implements background sampling/auto-size/rendering from `overlay.js` in a simpler form; two renderers to keep in sync. | open — deferred (labelled "limited demo" per PIPELINES.md) |
| m30 | `backend/security.py:99-135,162-176` | `BaseHTTPMiddleware` for rate limit + headers (known perf caveats, fine locally); CORS `allow_credentials=True` with a wildcard-regex origin; `X-XSS-Protection` is a deprecated header. | open |
| m31 | `extension/shared/preferences.d.ts` | Hand-written twin of `preferences.js`; no check that keys match. | open |
| m32 | `extension/ocr/tesseract.js:293-308,426-433,323-352` | `loadTesseractLibrary` checks a `globalThis.Tesseract` that never exists; `terminateWorker` unused; `auto` → `eng+jpn` only (Korean/Chinese "auto" users get nothing). | open |
| m33 | `extension/manifest.json:37-48` | `<all_urls>` already in `host_permissions`, so the 13 explicit hosts are redundant; `key` is hard-coded (fine, public) but undocumented; Auth0 tenant host hard-coded. | open |

### Nits

| ID | Finding |
|---|---|
| n1 | `README.md` project tree and feature table drift (see m8); `MANIFEST_GUIDE.md` omits `offscreen`, `notifications`, `identity`, `commands`. |
| n2 | `extension/src/styles/globals.css` has unused `.choice-*` rules from an older picker UI. |
| n3 | `backend/ocr_engines/__init__.py` declares `__all__` for names it doesn't import. |
| n4 | `website/tsconfig.json` `target: es5` (Next overrides); `website/README.md` file tree lists `ProductPreview.tsx` which doesn't exist. |
| n5 | `DemoSection` "See it in Action" links to `/contact`. |
| n6 | Tutorial-length comments (40–80 line banners) in every extension file; `content.js` is 2,955 lines of which ~35% is prose. |

### Redundancy clusters (canonical implementation chosen)

| Cluster | Copies | Canonical |
|---|---|---|
| `previewText`, `normalizeForComparison`, `isEffectivelyIdenticalTranslation`, `languagesClearlyDiffer` | content.js, translate-manager.js, libre-translate.js, (website translator.ts) | new `extension/shared/text.js` |
| `stripDataUrlPrefix`, `sha256Hex`, `toErrorMessage` | background.js, content.js, ocr-manager.js, offscreen/ocr.js, tesseract.js, elevenlabs.js | new `extension/shared/text.js` / `shared/crypto.js` |
| `clampNumber` | elevenlabs.js, ReadAloudSettings.jsx | `shared/preferences.js` (with typed coercion) |
| ElevenLabs defaults | elevenlabs.js `DEFAULT_ELEVENLABS_SETTINGS` | `shared/preferences.js` |
| `SETTINGS_KEY` | storage.js, App.jsx | storage.js export |
| Paddle language aliases | backend `server.py`, `background.js` | keep backend authoritative; extension passes ISO code through |
| OCR engine routing | background.js (live) vs ocr/ocr-manager.js + backend-ocr.js + cloud-vision.js (dead) | background.js → extract to `ocr/ocr-router.js` (tested), delete the dead trio |
| Bbox `[x1,y1,x2,y2]` → `{x,y,width,height}` mapping | background.js ×4 inline copies | one helper |

### Unverified claims (cannot run here)

- PaddleOCR / MangaOCR wrappers (`paddle_ocr.py`, `manga_ocr.py`) against real `paddleocr`/`manga_ocr` — packages not installed; 2.x/3.x compat shims are plausible but untested.
- M3 (Firefox) — no Firefox run; based on MDN's MV3 background docs.
- M9 (Docker) — no Docker; based on Debian 12 package removal.
- Real browser behaviour of the extension (popup → background → content → overlay) — no Chrome automation harness yet; will be covered by a DOM-level smoke test in Phase 5, and manual load instructions.
- LLM providers — no keys; only request shapes reviewed.
