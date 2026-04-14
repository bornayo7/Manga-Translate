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
- **activeTab** — Temporary access to the current tab only when the user clicks the icon. Most privacy-friendly permission.
- **storage** — Access to `chrome.storage.local`/`sync` for persisting settings and API keys.
- **scripting** — Programmatic script injection via `chrome.scripting.executeScript()`.

## host_permissions
Grants the extension permission to make fetch requests to these origins (bypasses CORS):
- `localhost:8000` — Local Python backend for OCR
- `api.openai.com` — OpenAI API for LLM translation
- `api.anthropic.com` — Claude API for LLM translation
- `api.mymemory.translated.net` — Free MyMemory translation
- `libretranslate.com` etc. — Free LibreTranslate instances

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

## commands
Keyboard shortcuts. Users can customize at `chrome://extensions/shortcuts`.

## web_accessible_resources
Files the content script can load into the page DOM. Without this listing,
extension files are invisible to web pages.

## content_security_policy
`script-src 'self'` — Only scripts from the extension package can run.
No inline scripts, no eval(), no remote scripts.
