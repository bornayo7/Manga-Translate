# Website and popup audit — 2026-09-09

Reviewed tree: `thermo` at `172c2d2c9fd297304956bb634bab1877a377db47`. Repository root: `C:/Users/yashb/OneDrive/Desktop/Github/Manga-Translate`. This is a read-only review. No source files, configuration, branches, vault notes, dependencies, or lockfiles changed. Checks generated ignored build/typecheck output only; final tracked status was clean.

Applied full reads of the thermo-nuclear-code-quality-review and codebase-design skills, the VisionTranslate project state note, and the complete generated frontend-design output at `C:/Users/yashb/AppData/Local/Temp/visiontranslate-frontend-design-skill.txt`. Browser inspection used the supported computer-use browser surface and its local-web-development/viewport documentation.

## Executive assessment

The existing branch makes real improvements: canonical translation outcome classification, byte-bounded requests, MangaOCR batches, Unicode text layout, and explicit save-response assertions are useful deepening work. Website lint, typecheck, build, and its five tests pass. They do not establish end-to-end product readiness. The test surface currently misses the demo pipeline and all React interaction behavior. Two deterministic popup persistence probes still demonstrate lost user intent; the website renderer can still claim success while drawing no translations. Targeted browser checks also reproduced invisible keyboard targets, clipped mobile navigation, and horizontal overflow.

Do not replace the complete application blindly. Deepen the settings persistence module and demo translation module first, make their outcomes explicit, then rebuild presentation over those tested interfaces.

## High-confidence findings

### W-01 — P1: a failed settings patch is forgotten, and a later empty save permits translation with stale settings

`lensmu/extension/src/popup/settings-persistence.js:66-73` removes a patch from `pendingPatch` before sending; the error branch at `:59-62` keeps only the Error. `saveNow()` at `:98-101` sends an empty patch when called without arguments. Its later success clears `lastError` at `:54`, without retrying the lost patch. `App.jsx:431-438, 532-537` assumes this proves the settings currently displayed in the popup were saved.

Deterministic probe against the actual module using injected transport:

```text
afterFailedPatch {"messages":[{"targetLanguage":"fr"}],"error":"simulated storage failure"}
afterEnsureSaved {"messages":[{"targetLanguage":"fr"},{}],"error":null}
```

The failed `fr` update never appears in a subsequent request, but `await saveNow()` resolves. Another unrelated successful setting change also clears the failure. Preserve all unacknowledged edits by key/revision, or reject `ensureSaved` until they are retried successfully. Parent independently reproduced a related storage read-error-to-defaults overwrite; both belong in the same settings ownership repair.

### W-02 — P1: subsequent edits remain in the popup until an earlier save response arrives

`settings-persistence.js:49-51` delays the actual `sendMessage` behind `chain`. Microtask scheduling only removes the timer; it does not transfer ownership to the background immediately. If a first save response is pending, closing the popup after a second edit destroys the second dispatch. This directly contradicts the module's lifecycle promise in `:12-18`. The background already serializes writes, so serializing dispatch in the disposable popup adds a second queue with a shorter lifetime.

Probe: hold the first response unresolved, queue a second edit, and drain the event loop.

```text
secondChangeBeforeFirstAck {"messages":[{"sourceLanguage":"ja"}],"hasPending":false}
```

The second `{targetLanguage:'es'}` has not been sent, and even `hasPending` reports false because it ignores the promise chain. Send edits promptly to the persistent background owner; track acknowledgments separately without delaying transfer. Cover close-after-second-edit with an integration/lifecycle test.

### W-03 — P2: demo export can claim completion with zero translated regions

`lensmu/website/lib/translator.ts:451-456` skips small/clipped regions without incrementing `unfit` or another outcome count. The all-unrendered check at `:520` only rejects when `unfit > 0`. If every detected region is smaller than these thresholds, the function exports the untouched source image successfully. `translateImage` then reports `done` and an empty warnings list; `TranslatorSection.tsx:326-361` presents “Translation Complete” and “Download Translated Image.”

Deterministic probe used the actual TypeScript implementation transpiled in memory, a minimal canvas adapter, a 100×100 image, bbox `[10,10,15,15]`, source Japanese, and translation `Hello`:

```text
tinyRegionRender {"rendered":0,"unfit":0,"returnedBlob":true,"fillCalls":0}
```

Every detected region needs one explicit rendered/skipped outcome. Reject a zero-render export; report partial outcomes with counts/reasons. Preserve source pixels for unrenderable regions, as the branch already correctly does for layout failures.

### W-04 — P2: successful HTTP responses still bypass runtime OCR response validation

`translator.ts:302` casts `response.json as T`. The shared bounded fetch returns `json:null` for malformed JSON; `runOCR` at `:198,208` turns this into an empty detection list. Invalid success bodies are consequently described to the user as no text in their image. `normalizePaddleDetections` at `:269-279` also trusts that detections is an array and every bbox has four valid coordinates.

Actual-module probe with fetch returning HTTP 200, JSON content type, body `{broken json`:

```text
malformedSuccess {"returned":null,"detections":[]}
```

Use the shared OCR response decoder/normalization interface for both adapters and distinguish invalid provider payload, empty OCR, and valid detections. Do not add another unchecked generic response wrapper.

### W-05 — P2: mobile navigation clips controls and retains hidden keyboard targets; tablet navigation overflows

`lensmu/website/components/layout/Navbar.tsx:112-118` collapses an always-mounted menu with `max-h-0` and overflow clipping. Links/buttons remain accessible and focusable. The expanded `max-h-80` is smaller than the contents. Desktop navigation/actions are enabled together at `md` (`:55,68`), before they fit.

Verified using the local production build in the Codex in-app browser:

- At 390×844, expand menu: Get Extension is visibly cut through its button by the menu's bottom edge.
- Collapse menu then press Tab: the AX focused element is the invisible Home link inside the collapsed `mobile-menu`.
- At an 820px viewport: `document.documentElement.clientWidth = 805`, `scrollWidth = 863`, and `nav.scrollWidth = 863`. The desktop header causes horizontal overflow.

Unmount or truly hide the closed menu and restore focus appropriately. Size the open menu to contents with bounded viewport scrolling. Select a desktop breakpoint from actual content widths, including enabled Auth0 controls. Add keyboard/browser tests at mobile and tablet sizes.

### W-06 — P2: the primary acquisition action does not install or identify this extension

`components/sections/Hero.tsx:37` and `components/layout/Navbar.tsx:83,164` all point “Get Extension” at `https://chrome.google.com/webstore`, the generic store homepage. Browser AX state confirms these exact targets. There is no product-specific install destination in these CTAs. Until a verified listing exists, link a working installation guide/release route and name the action accordingly. `data/site.ts:20` separately retains a legacy `Hack-SMU-VII` repository URL; reconcile it with the actual remote, but a redirect was not checked and is not asserted broken.

### W-07 — P2: API key UI reports “Saved” before the save outcome

`lensmu/extension/src/popup/components/ApiKeyInput.jsx:30-43` sets `saved=true` immediately after synchronous `onChange`, displays “Saved” for 1.2 seconds, and `:69` labels the optimistic value “Stored.” The actual persister can still be pending or fail. This worsens W-01/W-02 by telling the user it is safe to close the popup. Drive saving/saved/error from real acknowledged revisions, or remove this claim.

### W-08 — P2: backend health timeout stops before the response body is consumed

`lensmu/extension/src/popup/App.jsx:358-373` clears its abort timer as soon as fetch headers arrive, then awaits `response.json()` without a timeout. A server/proxy that returns headers and stalls its body leaves status at “checking,” and `:453` disables translation indefinitely. Reuse the existing bounded fetch module, keeping the timeout and response-size bound through body consumption. This is direct control-flow evidence; it was not reproduced through the live popup.

## Additional specific issues to fold into the redesign

- Demo OCR/language configuration admits a contradictory state: `TranslatorSection.tsx:262-306` leaves any source language selectable with MangaOCR, while `translator.ts:204-207` forcibly recognizes Japanese and `:115-119` forwards the user's unrelated language to MyMemory. Disable the incompatible combination or produce a settings validation outcome before processing. Do not silently change the selected language.
- `website/tailwind.config.ts` defines no `destructive` token and `app/globals.css` defines no matching variable, but the demo uses `text-destructive`, `border-destructive/40`, and `bg-destructive/5` for failures (`TranslatorSection.tsx:209,367,376-378`). The intended error color treatments are absent from generated utility CSS.
- Popup tab controls expose `role=tab` without associated tabpanel IDs, keyboard arrow handling, or roving tabIndex (`App.jsx:676-689`). Theme segments expose no pressed/selected state (`:1123-1137`). RichSelect keeps all options tab stops, has no Tab-dismiss/focus-out behavior, and uses buttons as listbox options; native select plus adjacent provider description would delete 190 lines and much accessibility responsibility unless the rich UI materially helps.
- Popup CSS has no reduced-motion rule, while website CSS already has one. Popup fixed width 420px (`index.html:37`) meets its own `@media(max-width:420px)` at `globals.css:1260`, so the supposedly double/triple fields are always stacked in the actual popup. This is intentional-or-stale design policy that should be resolved, not another media query patched around it.
- Popup runtime errors for sign-in, sign-out, page toggle, and translate mostly go only to console (`App.jsx:490-519,557-558`). A rejected authenticated action needs a visible recoverable outcome. Health checks have no retry UI. “Protect and save your data!” at `:1009` overpromises while the following copy explicitly says sync is disabled.
- Contact form labels its mailto launch “Submit Message” (`ContactSection.tsx:156-164`) even though its honest final text says the user still needs to send in their mail app. Rename the action “Open email draft.” Field error text has no aria-describedby association or focus-first-error behavior (`:107-153`). Do not add a messaging backend without a product reason.
- Website `/about` and `/contact` have only section h2 headings, no page h1. Processing/error/complete demo state changes mostly have no live announcement or focus management. The output is only a raster image; the existing `blocks` and `translations` results could power an accessible transcript.
- `/translate` serializes every MyMemory region and chunk and provides neither cancellation nor progress counts. Navigating away does not cancel outstanding processing; a late result URL can be allocated after unmount and never revoked. Give the demo a request lifetime/AbortSignal and an outcome containing partial counts, then keep concurrency within an explicit small budget.
- Preference defaults and secret-key membership are shared, but the Zod contract still re-lists every key and numeric range (`preferences-schema.ts:11-40`), and stored envelope normalization lives separately (`preferences-store.ts:63-113`). Avoid claiming a completely canonical schema: defaults are canonical; complete validation/migration is not. Parent owns the extension schema audit. Stored metadata that fails validation is silently represented as no stored preferences; decide whether that should be an invalid-data outcome rather than overwrite invitation.

## Structural overhaul plan

1. **Make the settings module own durable intent.** Small interface: load, applyPatch, ensureSaved, subscribe. The background adapter owns serialized durable writes; the popup adapter sends patches immediately. Return acknowledged revisions, current snapshot, and retryable errors; retain failed fields. Group language swaps/provider+model changes atomically. Do not treat a storage read error as defaults. Test lost acknowledgment, rejected write, second edit while first pending, and failed read followed by patch.
2. **Make the demo translation module own one request lifetime.** Small interface: `translateImage(input, {signal, onProgress}) -> result`. Decode image once, validate dimensions before expensive work, use shared OCR/translation contracts and shared layout. Internal file/canvas adapters are the real variation seams. Return a per-region outcome and aggregate counts; the UI should not infer success from a Blob existing.
3. **Reduce popup App ownership.** It is 1,196 physical lines (main: 1,140), with about 17 state slots plus persistence, loading/migration, health, auth, tab commands, voices, audio lifetime, and all screen composition. It was already over 1k; this branch did not cross that threshold. Extract behavior-owning modules for settings session, page session, and speech preview; then focused screen modules consume their small interfaces. Merely moving JSX or forwarding a 20-prop settings surface would move complexity instead of deleting it. Keep orchestration architecture rules intact.
4. **Reduce presentation machinery.** Replace unnecessary RichSelect with native controls if provider badges can sit in a description; use one shared status/field error presentation and a CSS token vocabulary. Keep website shell/navbar/footer in one route layout so it does not remount theme/navigation state on every route. Do not introduce a global state framework for this.
5. **Keep extension as the product.** Website should demonstrate the exact supported reading behavior and provide a real install path. Keep its limited local demo visibly scoped; a hosted OCR/backend offering is a separate product decision. Do not advertise production readiness, broad automatic language coverage, or account sync until their relevant flows have evidence.

## Subject-specific frontend design proposal

Audience: readers translating manga/manhwa and image-based webpage text. Primary jobs: install/use the extension, see a trustworthy example, choose language and translate without interrupting reading. Product name from memory is lensmu; repository/project is VisionTranslate. Consolidate naming deliberately with the root plan.

**Design concept: a reading desk built around one actual translated panel.** The panel is the memorable element. Everything else should support reading rather than perform a SaaS dashboard aesthetic. Use one owned/licensed fixture with source/translated transcript and a keyboard-operable reveal control; no stock scenery pretending to demonstrate OCR.

Proposed 6-color token palette (contrast to be measured in implementation):

- Paper white `#FFFFFF`: reading surface and export preview.
- Cool page `#F1F4FA`: outer workspace.
- Ink blue `#20304A`: text, frames, and dark surface foundation.
- Reading blue `#3157C8`: primary action and selected translation state.
- Clear teal `#176F67`: confirmed completion.
- Correction red `#B33A43`: failed/superseded region or validation error.

Type: Barlow Condensed, 600–700, for a compact masthead/display voice influenced by comic lettering; Source Sans 3, 400–600, for readable UI and paragraphs. User content rendering remains language-aware with Noto CJK/system fallback. Use 13/16/20/28/40/56px scale; body line length around 60–70 characters. Self-host font files once licensing/source is verified; do not add network font dependence casually.

Layout A (recommended): asymmetric demonstration-first page. Left-aligned copy and controls, large translated panel to the right, short setup instructions immediately below. At mobile widths, panel follows headline and precedes secondary details. The demo keeps the image stable while status/settings live beside it; the popup keeps page state, language direction, and its one action in the first view.

```text
Desktop website
+-------------------------------------------------------------+
| lensmu                         Demo  Install  About            |
+--------------------------+----------------------------------+
| Read the next panel.      | Actual source/translated panel   |
| Brief supported promise  |                                  |
| [Install extension]      | [Original | Translation]          |
| [Try a sample]           | Region count + honest status      |
+--------------------------+----------------------------------+
| Set up -> Choose language -> Click image   (real sequence)   |
| Supported engines / local demo requirements / readable FAQ   |
+-------------------------------------------------------------+

Popup
+-------------------------------------+
| lensmu            This page: ready   |
| Source [Japanese]  To [English]      |
| [Translate this page]                |
| Settings saved / actionable failure |
+-------------------------------------+
| Translation   Appearance   Account  |
| Current section, compact fields     |
+-------------------------------------+
```

Layout B considered: a full-width cinematic manga wall with floating controls. Rejected because image cropping, mobile space, and overlays would compete with the actual reading job. The current design's blurred purple/pink gradients, stock hero, repeated pill eyebrows, matching shadow cards, and continuous floating/pulsing motion would reappear in a generic SaaS prompt; remove them. Boldness stays in the actual source/translation panel and compact lettering. Borders indicate image/page or form grouping; step numbering appears only for the true setup sequence. Motion answers a reveal click or status transition, respects reduced motion, and never distracts from reading.

Quality checks for the revised UI: keyboard-only navigation and upload; no hidden tab targets; 320/390/820/1280px layouts with enabled/disabled account states; both themes; real error/empty/partial/complete samples; high zoom; readable contrast; explicit progress/cancel; transcript access; no CTA leading to a generic store home. This is a plan, not a claim that a redesign has been implemented or visually verified.

## Validation actually completed

- `npm test`: 5 tests passed, 0 failed. Tests only cover Auth0/Jose error mapping; no demo/UI coverage. Module-typeless package warning only.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, Next.js 16.3.1, public routes prerendered and preferences route dynamic. Auth0 is disabled because required config is absent; build logs contain missing variable names only.
- Runtime: Node v24.11.1, npm 11.6.2. No installs or lockfile writes performed.
- Logs: `C:/Users/yashb/AppData/Local/Temp/visiontranslate-website-test.log`, `visiontranslate-website-lint.log`, `visiontranslate-website-typecheck.log`, `visiontranslate-website-build.log` in the same Temp folder.
- Deterministic in-memory probes: lost failed settings patch; queued second dispatch held until first acknowledgment; zero-render image success; malformed HTTP 200 JSON accepted.
- Production browser inspection: desktop home, 390px mobile menu/keyboard behavior, 820px navigation overflow, demo initial upload screen. Screenshots were inspected inline in tool output; no local screenshot files were saved.
- Temporary production server on port 3039 was stopped, own browser tab closed, viewport override reset. No unrelated tabs/processes touched.
- No live OCR image submission, provider credential calls, Auth0 login/sync, extension installation, browser extension popup session, contact transmission, or downloadable image quality verification was performed. These remain specific acceptance work; the green build cannot establish them.

## Full reviewed inventory

59 tracked text files were read completely, listed below. Exclusions: real `.env` files (none read), `.env.example` (not needed and deliberately not read), generated `next-env.d.ts`, dependency lockfile, binary public logo, and ignored/vendor/generated folders. Shared extension modules outside popup scope belong to the parent's other audit slices; only modules needed for direct probes were imported.

- `lensmu/extension/src/popup/App.jsx`
- `lensmu/extension/src/popup/components/ApiKeyInput.jsx`
- `lensmu/extension/src/popup/components/ErrorBoundary.jsx`
- `lensmu/extension/src/popup/components/LanguageSelector.jsx`
- `lensmu/extension/src/popup/components/OcrSettings.jsx`
- `lensmu/extension/src/popup/components/ReadAloudSettings.jsx`
- `lensmu/extension/src/popup/components/RichSelect.jsx`
- `lensmu/extension/src/popup/components/TranslateSettings.jsx`
- `lensmu/extension/src/popup/index.html`
- `lensmu/extension/src/popup/index.jsx`
- `lensmu/extension/src/popup/settings-persistence.js`
- `lensmu/extension/src/styles/globals.css`
- `lensmu/website/README.md`
- `lensmu/website/app/about/page.tsx`
- `lensmu/website/app/api/preferences/route.ts`
- `lensmu/website/app/contact/page.tsx`
- `lensmu/website/app/globals.css`
- `lensmu/website/app/layout.tsx`
- `lensmu/website/app/page.tsx`
- `lensmu/website/app/translate/page.tsx`
- `lensmu/website/components.json`
- `lensmu/website/components/auth/AppAuthProvider.tsx`
- `lensmu/website/components/auth/AuthButtons.tsx`
- `lensmu/website/components/layout/BrandLogo.tsx`
- `lensmu/website/components/layout/Footer.tsx`
- `lensmu/website/components/layout/Navbar.tsx`
- `lensmu/website/components/sections/AboutSection.tsx`
- `lensmu/website/components/sections/ContactSection.tsx`
- `lensmu/website/components/sections/DemoSection.tsx`
- `lensmu/website/components/sections/Hero.tsx`
- `lensmu/website/components/sections/HowItWorksSection.tsx`
- `lensmu/website/components/sections/TeamSection.tsx`
- `lensmu/website/components/sections/TranslatorSection.tsx`
- `lensmu/website/components/sections/UseCasesSection.tsx`
- `lensmu/website/components/ui/badge.tsx`
- `lensmu/website/components/ui/button.tsx`
- `lensmu/website/components/ui/card.tsx`
- `lensmu/website/components/ui/input.tsx`
- `lensmu/website/components/ui/label.tsx`
- `lensmu/website/components/ui/reveal-on-scroll.tsx`
- `lensmu/website/components/ui/textarea.tsx`
- `lensmu/website/data/site.ts`
- `lensmu/website/eslint.config.mjs`
- `lensmu/website/lib/api-auth-errors.d.ts`
- `lensmu/website/lib/api-auth-errors.js`
- `lensmu/website/lib/api-auth-errors.test.mjs`
- `lensmu/website/lib/api-auth.ts`
- `lensmu/website/lib/auth0.ts`
- `lensmu/website/lib/extension-cors.ts`
- `lensmu/website/lib/preferences-schema.ts`
- `lensmu/website/lib/preferences-store.ts`
- `lensmu/website/lib/translator.ts`
- `lensmu/website/lib/utils.ts`
- `lensmu/website/next.config.mjs`
- `lensmu/website/package.json`
- `lensmu/website/postcss.config.mjs`
- `lensmu/website/proxy.ts`
- `lensmu/website/tailwind.config.ts`
- `lensmu/website/tsconfig.json`
