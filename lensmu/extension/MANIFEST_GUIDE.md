# manifest.json — Field-by-Field Guide

JSON doesn't support comments, so this file explains every field in `manifest.json`.

## manifest_version: 3
Manifest V3 is required by Chrome. Key differences from V2:
- Background pages → service workers (sleep when idle, wake on events)
- No remote code execution (no eval, no external scripts)
- More granular permissions model

## browser_specific_settings
Ignored by Chrome, required by Firefox. Gives the extension a stable ID
so `chrome.storage` persists across reloads during development.

## icons
Chrome shows these in: toolbar, extensions page, Chrome Web Store.
- 16×16: extensions dropdown list
- 32×32: Windows taskbar
- 48×48: chrome://extensions page
- 128×128: Web Store listing

## permissions
- **activeTab** — Temporary access to the current tab when the user clicks the icon.
- **storage** — `chrome.storage.local` for settings, API keys, the per-domain disable list, the Auth0 session and the read-aloud audio cache.
- **offscreen** — Creates the offscreen document that runs bundled Tesseract.js (`offscreen/ocr.html`), because MV3 service workers cannot spawn Web Workers.
- **notifications** — Shows a system notification when an image translation fails fatally.
- **identity** — `chrome.identity.launchWebAuthFlow` for the Auth0 PKCE sign-in.

Nothing else is requested. In particular `scripting` is not: the content script is declared statically below and nothing calls `chrome.scripting`.

## host_permissions
`<all_urls>` lets the service worker fetch page images that taint a canvas
(cross-origin, no CORS headers) and reach whichever OCR backend, LLM
provider or custom endpoint the user configures. The set of hosts actually
contacted is decided by the user's settings, not by this list.

## background.service_worker
The service worker runs in the background with NO DOM access. It:
- Wakes on events (messages, icon clicks, tab changes)
- Sleeps after ~30s of inactivity
- Cannot use `document` or `window`
- `"type": "module"` enables ES module imports

## content_scripts
Injected into every page at `document_idle`. The script is lightweight — it only
sets up message listeners and waits for activation. No scanning until user acts.

## action
Toolbar button config. `default_popup` points to the built React UI.

## web_accessible_resources
Files the content script can `import()` from the page context. Only what
it actually loads is listed: `overlay.js` (rendering), `ocr/*` and `lib/*`
(the in-page Tesseract fallback and its worker/WASM files). Anything listed
here is also probeable by web pages, which is why icons and utilities are
not.

## content_security_policy
`script-src 'self' 'wasm-unsafe-eval'` — Only scripts from the extension
package can run, plus the WebAssembly compilation Tesseract.js needs. No
inline scripts, no eval(), no remote scripts.

## commands
`_execute_action` opens the popup; `toggle-translation` (Alt+Shift+V)
flips activation on the current tab and remembers that choice for the
domain. Users can rebind both at `chrome://extensions/shortcuts`.
