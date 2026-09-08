/*
 * ==========================================================================
 * VisionTranslate — Background Service Worker (background.js)
 * ==========================================================================
 *
 * WHAT IS A SERVICE WORKER?
 * -------------------------
 * In Manifest V3, the background script runs as a "service worker." Think
 * of it as a lightweight helper that sits between the browser and your
 * content scripts. It has NO access to any web page's DOM — it cannot
 * read or modify HTML elements. Instead, it:
 *
 *   1. Listens for EVENTS (extension icon clicked, messages received,
 *      tabs opened/closed, keyboard shortcuts pressed).
 *   2. Communicates with content scripts via MESSAGE PASSING.
 *   3. Makes network requests that content scripts cannot (bypassing CORS).
 *   4. Manages extension-wide state and coordinates between tabs.
 *
 * LIFECYCLE:
 * ----------
 * The service worker does NOT run continuously. Chrome will terminate it
 * after ~30 seconds of inactivity. It wakes up again when an event fires.
 * This means:
 *   - You CANNOT rely on global variables to persist between events.
 *   - Use chrome.storage.local for anything that must survive restarts.
 *   - Event listeners MUST be registered at the top level (not inside
 *     callbacks or async functions) so Chrome knows to wake the worker.
 *
 * MESSAGE-PASSING ARCHITECTURE:
 * -----------------------------
 * The extension has three "worlds" that cannot directly call each other's
 * functions:
 *
 *   ┌──────────────┐     messages     ┌──────────────┐
 *   │   Popup UI   │ <=============> │  Background   │
 *   │ (popup.html) │                 │   (this file) │
 *   └──────────────┘                 └───────┬───────┘
 *                                            │ messages
 *                                            │ (chrome.tabs.sendMessage /
 *                                            │  chrome.runtime.onMessage)
 *                                    ┌───────┴───────┐
 *                                    │ Content Script │
 *                                    │ (content.js)  │
 *                                    │ — runs in the │
 *                                    │   web page    │
 *                                    └───────────────┘
 *
 * Messages are simple JSON objects with an "action" field that acts like
 * a command name, plus a "payload" field for data.
 *
 * Example message: { action: "START_TRANSLATION", payload: { lang: "es" } }
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Module Imports
 * --------------------------------------------------------------------------
 * Because the manifest declares "type": "module" for the service worker,
 * we can use ES module imports. We import our storage helpers so the
 * background script can read/write settings.
 */
import { getSettings, saveSettings, getDisabledDomains, addDisabledDomain, removeDisabledDomain } from './utils/storage.js';
import { translateTexts } from './translate/translate-manager.js';
import { login as auth0Login, logout as auth0Logout, getAuthState } from './auth/auth0.js';
import { generateReadAloudAudio, loadElevenLabsVoices, syncReadAloudTranslation } from './tts/elevenlabs.js';
import { toContentScriptSettings } from './shared/preferences.js';
import { fetchWithTimeout, isAbortError } from './shared/fetch-with-timeout.js';
import {
  describeHttpFailure,
  stripDataUrlPrefix,
  toContentScriptBlocks,
  toErrorMessage,
  trimTrailingSlashes
} from './shared/text.js';
import {
  batchMangaBboxes,
  mergeMangaResults,
  parseGoogleVisionResponse
} from './shared/ocr-responses.js';

/*
 * --------------------------------------------------------------------------
 * In-Memory State
 * --------------------------------------------------------------------------
 * We track which tabs currently have translation active. This is a Map
 * from tabId (number) to a state object.
 *
 * WARNING: This Map lives in memory and will be LOST when the service
 * worker restarts. For critical state, we also persist to chrome.storage.
 * The in-memory Map is a fast cache; on worker restart we re-hydrate it
 * from storage.
 *
 * Tab state object shape:
 * {
 *   active: boolean,        — Is translation currently on for this tab?
 *   imageCount: number,     — How many images were found
 *   translatedCount: number — How many images have been translated so far
 * }
 */
const tabStates = new Map();
const REQUEST_TIMEOUT_MS = 30000;
const IMAGE_FETCH_TIMEOUT_MS = 15000;
const MAX_FETCH_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_OCR_RESPONSE_BYTES = 8 * 1024 * 1024;

/*
 * --------------------------------------------------------------------------
 * In-flight requests owned by content scripts
 * --------------------------------------------------------------------------
 * A content script that deactivates, or whose image changed source, sends
 * CANCEL_REQUESTS with the ids of the OCR/translation requests it no longer
 * wants. The matching fetches are aborted here. Ids are scoped to the
 * sending tab so one page can never cancel another page's work.
 *
 * Aborting the fetch frees this worker and the network connection; it does
 * not stop an inference the backend has already started on its side.
 */
const inflightRequests = new Map();

function requestKey(tabId, requestId) {
  return `${tabId ?? 'ext'}:${String(requestId)}`;
}

function beginTrackedRequest(tabId, requestId) {
  const controller = new AbortController();
  if (requestId) {
    const key = requestKey(tabId, requestId);
    inflightRequests.get(key)?.abort(new DOMException('Superseded by a newer request.', 'AbortError'));
    inflightRequests.set(key, controller);
  }
  return controller;
}

function endTrackedRequest(tabId, requestId, controller) {
  if (!requestId) {
    return;
  }
  const key = requestKey(tabId, requestId);
  if (inflightRequests.get(key) === controller) {
    inflightRequests.delete(key);
  }
}

function cancelTrackedRequests(tabId, requestIds = []) {
  let cancelled = 0;
  for (const requestId of Array.isArray(requestIds) ? requestIds : []) {
    const key = requestKey(tabId, requestId);
    const controller = inflightRequests.get(key);
    if (controller) {
      controller.abort(new DOMException('Cancelled by the content script.', 'AbortError'));
      inflightRequests.delete(key);
      cancelled += 1;
    }
  }
  return cancelled;
}

function cancelTrackedRequestsForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const [key, controller] of inflightRequests) {
    if (key.startsWith(prefix)) {
      controller.abort(new DOMException('Tab navigated or closed.', 'AbortError'));
      inflightRequests.delete(key);
    }
  }
}

function cancelledResponse() {
  return { ok: false, cancelled: true, status: 0, statusText: 'Cancelled', headers: {}, body: { error: 'Request cancelled.' } };
}

/*
 * Only pages the extension itself ships (popup, offscreen document) may
 * change settings, sign in or out, or use the ElevenLabs key. A content
 * script runs inside a web page and has sender.tab set.
 */
function isExtensionPageSender(sender) {
  return !sender?.tab && (!sender?.url || sender.url.startsWith(chrome.runtime.getURL('')));
}
const PADDLE_LANGUAGE_ALIASES = Object.freeze({
  auto: 'japan',
  ja: 'japan',
  jp: 'japan',
  zh: 'ch',
  'zh-cn': 'ch',
  'zh-tw': 'chinese_cht',
  ko: 'korean',
  de: 'de',
  fr: 'fr',
  en: 'en',
  es: 'es'
});

/*
 * --------------------------------------------------------------------------
 * Helper: Get or Create Tab State
 * --------------------------------------------------------------------------
 * Returns the state object for a given tab, creating a default one if
 * it does not exist yet. This avoids repetitive "if not exists" checks.
 */
function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, {
      active: false,
      imageCount: 0,
      translatedCount: 0
    });
  }
  return tabStates.get(tabId);
}

/*
 * --------------------------------------------------------------------------
 * OCR Helpers
 * --------------------------------------------------------------------------
 * The popup and older stored settings use a few different engine/API-key
 * identifiers. Normalize them here so the background worker stays backward
 * compatible and the OCR_REQUEST handler only needs one set of branches.
 */
function normalizeOcrEngine(engine) {
  switch (engine) {
    case 'paddle':
    case 'paddleocr':
      return 'paddleocr';
    case 'manga':
    case 'mangaocr':
      return 'mangaocr';
    case 'cloudvision':
    case 'cloud-vision':
    case 'google_vision':
      return 'google_vision';
    case 'custom':
    case 'customocr':
    case 'custom_ocr':
      return 'custom_ocr';
    case 'tesseract':
    default:
      return 'tesseract';
  }
}

function normalizeCustomOcrResponse(body, fallbackSourceLang = 'auto') {
  const rawBlocks = Array.isArray(body?.blocks)
    ? body.blocks
    : Array.isArray(body?.detections)
      ? body.detections
      : [];

  const blocks = rawBlocks
    .map((block) => {
      const text = typeof block?.text === 'string' ? block.text : String(block?.text || '');
      const confidence = Number(block?.confidence) || 0;
      const orientation = block?.orientation === 'vertical' ? 'vertical' : 'horizontal';

      if (block?.bbox && !Array.isArray(block.bbox) && typeof block.bbox === 'object') {
        const x = Math.round(Number(block.bbox.x) || 0);
        const y = Math.round(Number(block.bbox.y) || 0);
        const width = Math.max(0, Math.round(Number(block.bbox.width) || 0));
        const height = Math.max(0, Math.round(Number(block.bbox.height) || 0));
        return { text, confidence, orientation, bbox: { x, y, width, height } };
      }

      const bbox = Array.isArray(block?.bbox) ? block.bbox : [0, 0, 0, 0];
      const [x1, y1, x2, y2] = bbox.map((value) => Math.round(Number(value) || 0));

      return {
        text,
        confidence,
        orientation,
        bbox: {
          x: x1,
          y: y1,
          width: Math.max(0, x2 - x1),
          height: Math.max(0, y2 - y1)
        }
      };
    })
    .filter((block) => block.text.trim().length > 0);

  const source_lang =
    body?.source_lang ||
    body?.sourceLang ||
    body?.locale ||
    body?.language ||
    fallbackSourceLang;

  return { blocks, source_lang };
}

function normalizePaddleLanguage(language) {
  const normalized = String(language || 'auto').trim().toLowerCase();
  return PADDLE_LANGUAGE_ALIASES[normalized] || normalized || 'japan';
}

function showFatalErrorNotification(errorMessage) {
  const notificationId = `vt-error-${Date.now()}`;
  return chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/VT_KD_128.png',
    title: 'VisionTranslate Error',
    message: errorMessage || 'An unexpected fatal error occurred.',
    priority: 2
  });
}

const OFFSCREEN_TESSERACT_DOCUMENT_PATH = 'offscreen/ocr.html';
const OFFSCREEN_TESSERACT_TARGET = 'offscreen-tesseract';
let offscreenTesseractCreation = null;

async function hasOffscreenTesseractDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_TESSERACT_DOCUMENT_PATH);

  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }

  const matchedClients = await self.clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenTesseractDocument() {
  if (!chrome.offscreen?.createDocument) {
    return false;
  }

  if (await hasOffscreenTesseractDocument()) {
    return true;
  }

  if (!offscreenTesseractCreation) {
    offscreenTesseractCreation = chrome.offscreen.createDocument({
      url: OFFSCREEN_TESSERACT_DOCUMENT_PATH,
      reasons: ['WORKERS'],
      justification: 'Run bundled Tesseract OCR in an extension-owned document so page CSP and opaque origins do not block worker creation.'
    });
  }

  try {
    await offscreenTesseractCreation;
    return true;
  } finally {
    offscreenTesseractCreation = null;
  }
}

async function runBundledTesseractInOffscreen(imageBase64, sourceLang = 'auto') {
  const offscreenReady = await ensureOffscreenTesseractDocument();
  if (!offscreenReady) {
    throw new Error('Bundled Tesseract OCR requires Chrome offscreen documents in this browser.');
  }

  const response = await chrome.runtime.sendMessage({
    target: OFFSCREEN_TESSERACT_TARGET,
    action: 'RUN_TESSERACT_OCR',
    payload: {
      imageBase64,
      sourceLang
    }
  });

  if (!response?.ok) {
    throw new Error(response?.body?.error || 'Bundled Tesseract OCR failed in the offscreen document.');
  }

  return {
    blocks: toContentScriptBlocks(response.body?.blocks || []),
    source_lang: sourceLang
  };
}

/*
 * --------------------------------------------------------------------------
 * Helper: Extract Hostname from URL
 * --------------------------------------------------------------------------
 * Returns the hostname (e.g., "example.com") from a URL string, or null
 * for special pages (chrome://, about:, etc.) where content scripts can't run.
 */
function getHostname(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || parsed.protocol === 'chrome:' || parsed.protocol === 'chrome-extension:' || parsed.protocol === 'about:') {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/*
 * --------------------------------------------------------------------------
 * Helper: Persist Tab States to Chrome Storage
 * --------------------------------------------------------------------------
 * Saves the current in-memory tab states to chrome.storage.local so they
 * survive service worker restarts. We serialize the Map to a plain object
 * because chrome.storage cannot store Map instances directly.
 */
async function persistTabStates() {
  /*
   * Convert Map to a plain object:
   *   Map { 123 => { active: true, ... } }
   *   becomes { "123": { active: true, ... } }
   */
  const serialized = Object.fromEntries(tabStates);
  await chrome.storage.local.set({ _tabStates: serialized });
}

/*
 * --------------------------------------------------------------------------
 * Helper: Restore Tab States from Chrome Storage
 * --------------------------------------------------------------------------
 * Called when the service worker starts up. Reads persisted tab states
 * and populates the in-memory Map.
 */
async function restoreTabStates() {
  const result = await chrome.storage.local.get('_tabStates');
  if (result._tabStates) {
    for (const [tabIdStr, state] of Object.entries(result._tabStates)) {
      tabStates.set(Number(tabIdStr), state);
    }
  }
}

/*
 * --------------------------------------------------------------------------
 * Helper: Update Badge
 * --------------------------------------------------------------------------
 * The "badge" is the small colored text overlay on the extension's toolbar
 * icon. We use it to show status at a glance:
 *   - Green "ON" when translation is active on the current tab
 *   - No badge when translation is inactive
 *   - Blue number showing count of translated images during processing
 *
 * chrome.action.setBadgeText()            — sets the text (max ~4 chars)
 * chrome.action.setBadgeBackgroundColor() — sets the background color
 */
async function updateBadge(tabId) {
  const state = getTabState(tabId);

  if (state.active) {
    /*
     * Show a green "ON" badge when translation is active.
     * The array [76, 175, 80, 255] is RGBA (red, green, blue, alpha).
     * This is a pleasant green color.
     */
    await chrome.action.setBadgeText({ text: 'ON', tabId });
    await chrome.action.setBadgeBackgroundColor({
      color: [76, 175, 80, 255],
      tabId
    });
  } else {
    /* Clear the badge when translation is inactive. */
    await chrome.action.setBadgeText({ text: '', tabId });
  }
}

/*
 * --------------------------------------------------------------------------
 * Helper: Send Message to Content Script (with safety)
 * --------------------------------------------------------------------------
 * Wraps chrome.tabs.sendMessage in a try-catch because the content script
 * may not be injected yet (e.g., on chrome:// pages, new tab page, or
 * pages loaded before the extension was installed). Without the try-catch,
 * the error "Could not establish connection" would cause unhandled
 * promise rejections.
 */
async function sendToContentScript(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error) {
    /*
     * Common reasons for failure:
     *   - Content script not injected on this page (chrome:// URLs, PDFs)
     *   - Tab was closed between sending and receiving
     *   - Page is still loading and content script hasn't registered yet
     */
    console.warn(
      `[VisionTranslate] Could not send message to tab ${tabId}:`,
      error.message
    );
    return null;
  }
}

/*
 * --------------------------------------------------------------------------
 * Helper: Bounded JSON/text fetch for background-owned OCR providers
 * --------------------------------------------------------------------------
 * Network access stays in the trusted service worker. Content scripts send
 * typed OCR/translation requests and never receive a general-purpose proxy.
 */
async function proxyFetch(url, options = {}) {
  try {
    /*
     * The deadline and the caller's signal cover the body read too, and the
     * body is capped: a backend that answers 200 and then stalls, or streams
     * without end, no longer hangs the request forever.
     */
    const response = await fetchWithTimeout(url, options, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_OCR_RESPONSE_BYTES
    });
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    /*
     * The body was already read within the deadline. JSON.parse can never
     * yield undefined, so undefined is a safe sentinel for "the server said
     * JSON and then sent something that is not".
     */
    const body = isJson ? response.json : response.text;
    const headers = Object.fromEntries(response.headers.entries());

    if (response.ok && isJson && body === undefined) {
      /*
       * A 2xx with an unparseable body must not pass as "no detections":
       * the paddleocr branch would read body?.detections and report an
       * empty page instead of a broken server.
       */
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers,
        body: { error: `${describeOrigin(url)} returned malformed JSON (HTTP ${response.status}).` }
      };
    }

    if (!response.ok) {
      /*
       * The content script only ever reads body.error, so fold whatever the
       * server actually said (FastAPI uses "detail") into that field.
       * Without this a 501 "PaddleOCR is not installed" or a 422
       * "Unsupported PaddleOCR language" reached the user as the generic
       * "OCR request failed."
       */
      const errorBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        headers,
        body: {
          ...errorBody,
          error: describeHttpFailure(response.status, response.statusText, body)
        }
      };
    }

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers,
      body
    };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      return cancelledResponse();
    }
    return {
      ok: false,
      status: 0,
      statusText: 'Network Error',
      headers: {},
      body: { error: describeNetworkFailure(url, error) }
    };
  }
}

/*
 * fetch() rejects with the famously unhelpful "Failed to fetch". Name the
 * host that could not be reached so a stopped backend or a mistyped URL is
 * obvious from the notice on the image.
 */
function describeNetworkFailure(url, error) {
  return `Could not reach ${describeOrigin(url)}: ${toErrorMessage(error)}`;
}

function describeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return String(url);
  }
}

/*
 * ==========================================================================
 * EVENT LISTENERS
 * ==========================================================================
 * All event listeners MUST be registered at the TOP LEVEL of the service
 * worker script. If you register them inside an async function or a
 * setTimeout callback, Chrome will not know about them and will not wake
 * the service worker when those events fire.
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Event: Service Worker Installed
 * --------------------------------------------------------------------------
 * Fires when the extension is first installed OR when it's updated to a
 * new version. This is a good place to set default settings.
 *
 * chrome.runtime.onInstalled provides a "reason" field:
 *   - "install":  First time the extension is installed
 *   - "update":   Extension was updated to a new version
 *   - "chrome_update": Chrome itself was updated
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[VisionTranslate] Extension ${details.reason}. Version: ${chrome.runtime.getManifest().version}`);

  if (details.reason === 'install') {
    /*
     * First install — set default settings. getSettings() already
     * returns defaults if nothing is stored, but we explicitly save
     * them so the storage is populated for the popup to read.
     */
    const defaults = await getSettings();
    await saveSettings(defaults);
    console.log('[VisionTranslate] Default settings saved:', defaults);
  }

  if (details.reason === 'update') {
    console.log(
      `[VisionTranslate] Updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}`
    );
  }
});

/*
 * --------------------------------------------------------------------------
 * Event: Service Worker Startup
 * --------------------------------------------------------------------------
 * Fires every time the service worker starts (including after being
 * terminated for inactivity). We restore persisted tab states here.
 *
 * NOTE: chrome.runtime.onStartup fires when the BROWSER starts (not
 * the service worker). For service worker lifecycle, we just run
 * restoration code at the top level.
 */
const tabStatesReady = restoreTabStates().then(() => {
  console.log('[VisionTranslate] Tab states restored from storage.');
});

/*
 * chrome.storage.local is readable by content scripts by default. Nothing
 * in content.js reads it (settings arrive through messages with the keys
 * stripped), but the provider keys live there, so on browsers that support
 * StorageArea.setAccessLevel() restrict the area to extension pages and
 * the service worker. Older browsers simply keep the default; the
 * extension's own contexts are unaffected either way.
 */
void (async () => {
  try {
    if (typeof chrome.storage?.local?.setAccessLevel === 'function') {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      console.log('[VisionTranslate] chrome.storage.local restricted to trusted extension contexts.');
    }
  } catch (error) {
    console.warn('[VisionTranslate] Could not restrict chrome.storage.local access:', toErrorMessage(error));
  }
})();

/*
 * --------------------------------------------------------------------------
 * Event: Keyboard Shortcut (Command)
 * --------------------------------------------------------------------------
 * Fires when the user presses one of the keyboard shortcuts defined in
 * the manifest's "commands" section.
 *
 * We handle the "toggle-translation" command here. The "_execute_action"
 * command automatically opens the popup, so we don't need to handle it.
 */
chrome.commands.onCommand.addListener(async (command, tab) => {
  await tabStatesReady;
  console.log(`[VisionTranslate] Command received: ${command} on tab ${tab?.id}`);

  if (command === 'toggle-translation' && tab?.id) {
    await toggleTranslation(tab.id);
  }
});

/*
 * --------------------------------------------------------------------------
 * Event: Tab Removed (Closed)
 * --------------------------------------------------------------------------
 * Clean up state when a tab is closed. Without this, the tabStates Map
 * would grow indefinitely as the user opens and closes tabs.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await tabStatesReady;
  cancelTrackedRequestsForTab(tabId);
  if (tabStates.has(tabId)) {
    tabStates.delete(tabId);
    persistTabStates();
    console.log(`[VisionTranslate] Cleaned up state for closed tab ${tabId}`);
  }
});

/*
 * --------------------------------------------------------------------------
 * Event: Tab Updated (Page Navigation)
 * --------------------------------------------------------------------------
 * When the user navigates to a new page within the same tab, the content
 * script is re-injected (because we declared it in content_scripts in the
 * manifest). But our in-memory state still says "active: true" for that
 * tab. We reset the state on navigation so the user has to re-activate.
 *
 * changeInfo.status === 'loading' fires when a new navigation starts.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await tabStatesReady;
  if (changeInfo.status === 'loading') {
    cancelTrackedRequestsForTab(tabId);
  }

  if (changeInfo.status === 'loading' && tabStates.has(tabId)) {
    const state = getTabState(tabId);
    state.active = false;
    state.imageCount = 0;
    state.translatedCount = 0;
    updateBadge(tabId);
    persistTabStates();
  }

  /*
   * Auto-activate: The extension defaults to ON for all websites.
   * When the page finishes loading, activate translation automatically
   * unless the user has previously disabled it for this domain.
   */
  if (changeInfo.status === 'complete' && tab?.url) {
    const hostname = getHostname(tab.url);
    if (hostname) {
      const settings = await getSettings();
      if (!settings.autoTranslate) {
        return;
      }

      const disabledDomains = await getDisabledDomains();
      if (!disabledDomains.includes(hostname)) {
        const state = getTabState(tabId);
        if (!state.active) {
          const response = await sendToContentScript(tabId, {
            action: 'ACTIVATE',
            payload: { settings: toContentScriptSettings(settings) }
          });
          if (response?.success === true) {
            state.active = true;
            await updateBadge(tabId);
            await persistTabStates();
            console.log(`[VisionTranslate] Auto-activated on ${hostname} (tab ${tabId})`);
          }
        }
      }
    }
  }
});

/*
 * --------------------------------------------------------------------------
 * Event: Messages from Content Script or Popup
 * --------------------------------------------------------------------------
 * This is the MAIN communication hub. Every message has an "action" field
 * that tells us what to do, like a router in a web server.
 *
 * chrome.runtime.onMessage.addListener takes a callback with 3 params:
 *   - message: The message object sent by the sender
 *   - sender: Info about who sent it (tab ID, URL, extension ID, etc.)
 *   - sendResponse: A function to call to send a reply SYNCHRONOUSLY
 *
 * IMPORTANT: If you need to send a response ASYNCHRONOUSLY (after an
 * await), you MUST return `true` from the listener. This tells Chrome
 * to keep the message channel open. If you return nothing or false,
 * Chrome closes the channel immediately and sendResponse becomes a no-op.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === OFFSCREEN_TESSERACT_TARGET) {
    return false;
  }

  /*
   * We use an immediately-invoked async function (IIAFE) so we can use
   * await inside the listener. We return `true` at the bottom to keep
   * the message channel open for the async response.
   */
  (async () => {
    await tabStatesReady;
    const action = typeof message?.action === 'string' ? message.action : null;
    const payload = message?.payload ?? {};
    const tabId = sender.tab?.id;

    console.log('[VisionTranslate] Message received:', { action, tabId });

    switch (action) {
      /*
       * ---- TOGGLE_TRANSLATION ----
       * Sent by the popup when the user clicks the "Translate Page" button.
       * Toggles translation on the sender's tab.
       */
      case 'TOGGLE_TRANSLATION': {
        if (tabId) {
          await toggleTranslation(tabId);
          sendResponse({ success: true, state: getTabState(tabId) });
        } else if (payload?.tabId) {
          /*
           * When sent from the popup, sender.tab is undefined (the popup
           * is not a tab). The popup should include the target tabId in
           * the payload.
           */
          await toggleTranslation(payload.tabId);
          sendResponse({ success: true, state: getTabState(payload.tabId) });
        } else {
          sendResponse({ success: false, error: 'No tabId provided for TOGGLE_TRANSLATION.' });
        }
        break;
      }

      /*
       * ---- GET_TAB_STATE ----
       * Sent by the popup to check if translation is active on a tab.
       * This lets the popup show the correct toggle state when opened.
       */
      case 'GET_TAB_STATE': {
        const queryTabId = payload?.tabId || tabId;
        if (queryTabId) {
          sendResponse({ state: getTabState(queryTabId) });
        } else {
          sendResponse({ state: null });
        }
        break;
      }

      /*
       * ---- OCR_REQUEST ----
       * Sent by the content script with a base64-encoded image.
       * We route it to the configured OCR engine.
       */
      case 'OCR_REQUEST': {
        const settings = await getSettings();
        const engine = normalizeOcrEngine(settings.ocrEngine);
        const backendUrl = trimTrailingSlashes(settings.backendUrl) || 'http://localhost:8000';
        const rawImage = stripDataUrlPrefix(payload.imageBase64);
        const requestController = beginTrackedRequest(tabId, payload.requestId);
        const signal = requestController.signal;

        try {
          let ocrResult;

          if (engine === 'paddleocr') {
            /*
             * PaddleOCR: send to local FastAPI backend.
             * The backend returns { detections: [{text, bbox, confidence, orientation}] }
             * We normalize this to the format content.js expects.
             */
            const response = await proxyFetch(`${backendUrl}/ocr/paddle`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image: rawImage,
                lang: normalizePaddleLanguage(payload.sourceLang || settings.sourceLanguage)
              }),
              signal
            });

            if (!response.ok) {
              sendResponse(response);
              break;
            }

            ocrResult = {
              blocks: toContentScriptBlocks(response.body?.detections),
              source_lang: payload.sourceLang || settings.sourceLanguage || 'auto'
            };

          } else if (engine === 'mangaocr') {
            /*
             * MangaOCR: two-step. First PaddleOCR for detection, then MangaOCR for recognition.
             * If PaddleOCR isn't available, tell the user.
             */
            const detectResponse = await proxyFetch(`${backendUrl}/ocr/paddle`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: rawImage, lang: 'japan' }),
              signal
            });

            if (!detectResponse.ok) {
              sendResponse(detectResponse);
              break;
            }

            const paddleDetections = detectResponse.body.detections || [];

            /*
             * MangaOCR recognizes crops; it cannot detect regions on its own.
             * With no boxes from PaddleOCR there is nothing to recognize, so
             * return an empty result instead of inventing a whole-page box.
             */
            if (paddleDetections.length === 0) {
              sendResponse({ ok: true, body: { blocks: [], source_lang: 'ja', noText: true } });
              break;
            }

            /*
             * The backend validates every box and rejects the whole request
             * (422) on the first bad one, and caps a request at 200 boxes
             * and 50 MP of total area. Detections are therefore posted in
             * as many compliant batches as needed (sequentially: the
             * backend serialises inference anyway) and the answers are
             * merged back by detection index, so a page with 201 bubbles
             * loses none of them. Any region MangaOCR fails on keeps
             * PaddleOCR's own text.
             */
            const plan = batchMangaBboxes(paddleDetections);
            if (plan.invalid.length || plan.oversized.length) {
              console.warn(
                `[VisionTranslate] ${plan.invalid.length} invalid and ${plan.oversized.length} oversized PaddleOCR boxes keep their PaddleOCR text instead of going to MangaOCR.`
              );
            }

            const batchResponses = [];
            let batchFailure = null;
            for (const batch of plan.batches) {
              if (signal.aborted) {
                break;
              }
              const mangaResponse = await proxyFetch(`${backendUrl}/ocr/manga`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: rawImage, bboxes: batch.bboxes }),
                signal
              });

              if (mangaResponse.cancelled) {
                batchFailure = mangaResponse;
                break;
              }

              if (!mangaResponse.ok) {
                batchFailure = batchFailure || mangaResponse;
                console.warn('[VisionTranslate] MangaOCR batch failed; keeping PaddleOCR text for it:', mangaResponse.body?.error);
                batchResponses.push(null);
                continue;
              }

              batchResponses.push(mangaResponse.body?.detections);
            }

            if (batchFailure?.cancelled) {
              sendResponse(batchFailure);
              break;
            }

            if (batchFailure && batchResponses.every((entry) => entry === null)) {
              /*
               * Every batch failed: MangaOCR is unavailable (501), the
               * backend is down, ... Report that rather than pretending
               * the detector's rough text is what the user configured.
               */
              sendResponse(batchFailure);
              break;
            }

            const merged = mergeMangaResults(paddleDetections, plan.batches, batchResponses);
            if (merged.fellBack || merged.unexpectedBatches) {
              console.warn(
                `[VisionTranslate] MangaOCR recognized ${merged.recognized} regions; ${merged.fellBack} kept PaddleOCR text (${merged.unexpectedBatches} batch responses unusable).`
              );
            }

            ocrResult = {
              blocks: toContentScriptBlocks(merged.blocks),
              source_lang: 'ja',
              engineStats: {
                recognized: merged.recognized,
                fellBack: merged.fellBack,
                dropped: merged.dropped,
                batches: plan.batches.length
              }
            };

          } else if (engine === 'google_vision') {
            /*
             * Google Cloud Vision: call the API directly from the service worker.
             */
            const apiKey = settings.googleCloudApiKey;
            if (!apiKey) {
              sendResponse({ ok: false, body: { error: 'Google Cloud Vision requires an API key. Set it in extension settings.' } });
              break;
            }

            const visionResponse = await fetchWithTimeout(
              `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  requests: [{
                    image: { content: rawImage },
                    features: [{ type: 'TEXT_DETECTION' }]
                  }]
                }),
                signal
              },
              { timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_OCR_RESPONSE_BYTES }
            );

            if (!visionResponse.ok) {
              const err = visionResponse.json || {};
              sendResponse({ ok: false, body: { error: `Google Cloud Vision error (${visionResponse.status}): ${err?.error?.message || visionResponse.statusText}` } });
              break;
            }

            /*
             * An HTTP 200 can still carry responses[0].error for the image;
             * the parser turns that into a failure instead of "no text".
             */
            const vision = parseGoogleVisionResponse(visionResponse.json);
            ocrResult = {
              blocks: vision.blocks,
              source_lang: vision.sourceLang,
              noText: vision.noText
            };

          } else if (engine === 'custom_ocr') {
            const customOcrUrl = (settings.customOcrUrl || '').trim();
            if (!customOcrUrl) {
              sendResponse({ ok: false, body: { error: 'Custom OCR requires an endpoint URL. Set it in extension settings.' } });
              break;
            }

            const headers = {
              'Content-Type': 'application/json'
            };

            if (settings.customOcrApiKey) {
              headers.Authorization = `Bearer ${settings.customOcrApiKey}`;
            }

            const customResponse = await proxyFetch(customOcrUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                image: rawImage,
                imageBase64: rawImage,
                sourceLang: payload.sourceLang || settings.sourceLanguage || 'auto'
              }),
              signal
            });

            if (!customResponse.ok) {
              sendResponse(customResponse);
              break;
            }

            if (!customResponse.body || typeof customResponse.body !== 'object') {
              sendResponse({ ok: false, body: { error: 'Custom OCR returned a non-JSON response.' } });
              break;
            }

            ocrResult = normalizeCustomOcrResponse(
              customResponse.body,
              payload.sourceLang || settings.sourceLanguage || 'auto'
            );

          } else {
            /*
             * Run bundled Tesseract inside an offscreen extension document.
             * That keeps worker creation on the extension origin instead of
             * the page origin, which avoids CSP and opaque-origin failures on
             * direct image documents.
             */
            const sourceLang = payload.sourceLang || settings.sourceLanguage || 'auto';
            if (chrome.offscreen?.createDocument) {
              ocrResult = await runBundledTesseractInOffscreen(rawImage, sourceLang);
            } else {
              ocrResult = {
                blocks: [],
                source_lang: sourceLang,
                useClientOCR: true
              };
            }
          }

          if (signal.aborted) {
            sendResponse(cancelledResponse());
            break;
          }

          sendResponse({ ok: true, body: ocrResult });
        } catch (ocrError) {
          if (isAbortError(ocrError) || signal.aborted) {
            sendResponse(cancelledResponse());
            break;
          }
          console.error('[VisionTranslate] OCR error:', ocrError);
          sendResponse({
            ok: false,
            body: { error: `OCR failed: ${toErrorMessage(ocrError)}` }
          });
        } finally {
          endTrackedRequest(tabId, payload.requestId, requestController);
        }
        break;
      }

      /*
       * ---- CANCEL_REQUESTS ----
       * Sent by a content script that deactivated or invalidated an image
       * while its OCR/translation requests were still in flight.
       */
      case 'CANCEL_REQUESTS': {
        const cancelled = cancelTrackedRequests(tabId, payload.requestIds);
        sendResponse({ success: true, cancelled });
        break;
      }

      /*
       * ---- TRANSLATE_REQUEST ----
       * Sent by the content script with text to translate.
       * We route to the configured translation backend.
       */
      case 'TRANSLATE_REQUEST': {
        /*
         * Translation is handled client-side by our translate-manager.js
         * module, which routes to the user's configured provider (Google,
         * OpenAI, Claude, or LibreTranslate). Unlike OCR, translation
         * does NOT go through the Python backend — the APIs are called
         * directly from the extension's service worker context.
         */
        const settings = await getSettings();
        const sourceLang = payload.sourceLang || 'auto';
        const targetLang = payload.targetLang || settings.targetLanguage || 'en';
        const requestController = beginTrackedRequest(tabId, payload.requestId);

        try {
          console.log('[VisionTranslate Background] TRANSLATE_REQUEST received', {
            providerRequested: settings.translationProvider || 'libre',
            sourceLang,
            targetLang,
            textCount: payload.texts?.length || 0,
            characterCount: (payload.texts || []).reduce(
              (total, text) => total + String(text || '').length,
              0
            )
          });

          const result = await translateTexts(
            payload.texts,
            sourceLang,
            targetLang,
            settings,
            { signal: requestController.signal }
          );

          console.log('[VisionTranslate Background] TRANSLATE_REQUEST result', {
            providerRequested: settings.translationProvider || 'libre',
            providerUsed: result.provider,
            fallbackUsed: Boolean(result.fallback),
            sourceLang: result.sourceLang || sourceLang,
            targetLang: result.targetLang || targetLang,
            diagnostics: result.diagnostics || null,
            translationCount: result.translations?.length || 0
          });

          if (requestController.signal.aborted) {
            sendResponse(cancelledResponse());
            break;
          }

          sendResponse({
            ok: true,
            body: {
              translations: result.translations,
              outcomes: result.outcomes,
              source_lang: result.sourceLang,
              target_lang: result.targetLang,
              provider: result.provider,
              fallback_used: Boolean(result.fallback),
              original_error: result.originalError || null,
              diagnostics: result.diagnostics || null
            }
          });
        } catch (translateError) {
          if (isAbortError(translateError) || requestController.signal.aborted) {
            sendResponse(cancelledResponse());
            break;
          }
          console.error('[VisionTranslate] Translation error:', translateError);
          sendResponse({
            ok: false,
            body: { error: translateError.message }
          });
        } finally {
          endTrackedRequest(tabId, payload.requestId, requestController);
        }
        break;
      }

      /*
       * ---- LOAD_ELEVENLABS_VOICES ----
       * Sent by the popup to fetch the account's available ElevenLabs voices.
       * This stays separate from OCR and translation and uses the stored API key.
       */
      case 'LOAD_ELEVENLABS_VOICES': {
        if (!isExtensionPageSender(sender)) {
          sendResponse({ ok: false, body: { error: 'ElevenLabs voices can only be loaded from the extension popup.' } });
          break;
        }
        const settings = await getSettings();

        try {
          const voices = await loadElevenLabsVoices(settings);
          sendResponse({
            ok: true,
            body: { voices }
          });
        } catch (error) {
          console.error('[VisionTranslate] ElevenLabs voice load error:', error);
          sendResponse({
            ok: false,
            body: { error: error.message }
          });
        }
        break;
      }

      /*
       * ---- TEST_ELEVENLABS_VOICE ----
       * Sent by the popup to synthesize a short preview clip with the current
       * ElevenLabs settings. Playback happens in the popup after the audio is
       * returned, but the network request stays in the background worker.
       */
      case 'TEST_ELEVENLABS_VOICE': {
        if (!isExtensionPageSender(sender)) {
          sendResponse({ ok: false, body: { error: 'Voice previews can only be started from the extension popup.' } });
          break;
        }
        const settings = await getSettings();

        try {
          const audioResult = await generateReadAloudAudio({
            text: payload.text || 'This is a VisionTranslate read aloud test.',
            language: payload.language || settings.targetLanguage || 'en',
            settings,
            cacheAudio: false
          });
          sendResponse({
            ok: true,
            body: audioResult
          });
        } catch (error) {
          console.error('[VisionTranslate] ElevenLabs voice test error:', error);
          sendResponse({
            ok: false,
            body: { error: error.message }
          });
        }
        break;
      }

      /*
       * ---- SYNC_READ_ALOUD_TRANSLATION ----
       * Sent by the content script after translation completes for an image.
       * If the translated text changed, we invalidate any older cached audio
       * tied to that image fingerprint before the user presses Read Aloud.
       */
      case 'SYNC_READ_ALOUD_TRANSLATION': {
        try {
          const result = await syncReadAloudTranslation({
            imageFingerprint: payload.imageFingerprint,
            translationHash: payload.translationHash
          });
          sendResponse({
            ok: true,
            body: result
          });
        } catch (error) {
          console.error('[VisionTranslate] Read aloud cache sync error:', error);
          sendResponse({
            ok: false,
            body: { error: error.message }
          });
        }
        break;
      }

      /*
       * ---- GENERATE_READ_ALOUD_AUDIO ----
       * Sent by the content script when the user clicks the per-image Read
       * button. We synthesize speech from the translated text only and cache
       * the audio by text, image fingerprint, language, and voice settings.
       */
      case 'GENERATE_READ_ALOUD_AUDIO': {
        const settings = await getSettings();

        try {
          const audioResult = await generateReadAloudAudio({
            text: payload.text,
            language: payload.language || settings.targetLanguage || 'en',
            imageFingerprint: payload.imageFingerprint,
            translationHash: payload.translationHash,
            settings,
            cacheAudio: true
          });
          sendResponse({
            ok: true,
            body: audioResult
          });
        } catch (error) {
          console.error('[VisionTranslate] Read aloud generation error:', error);
          sendResponse({
            ok: false,
            body: { error: error.message }
          });
        }
        break;
      }

      /*
       * ---- UPDATE_PROGRESS ----
       * Sent by the content script to report translation progress.
       * We update the badge and store the progress.
       */
      case 'UPDATE_PROGRESS': {
        if (tabId) {
          const state = getTabState(tabId);
          state.imageCount = payload.total ?? state.imageCount;
          state.translatedCount = payload.completed ?? state.translatedCount;

          /*
           * Show progress on the badge: "2/5" means 2 of 5 images done.
           * Once all are done, switch back to "ON".
           */
          if (state.imageCount > 0 && state.translatedCount < state.imageCount) {
            await chrome.action.setBadgeText({
              text: `${state.translatedCount}/${state.imageCount}`,
              tabId
            });
            await chrome.action.setBadgeBackgroundColor({
              color: [33, 150, 243, 255],  /* Blue */
              tabId
            });
          } else {
            await updateBadge(tabId);
          }

          persistTabStates();
          sendResponse({ success: true });
        } else {
          /*
           * Every branch must answer: the listener returns true, so an
           * unanswered message leaves the sender's promise pending until
           * the worker is torn down.
           */
          sendResponse({ success: false, error: 'UPDATE_PROGRESS must come from a content script.' });
        }
        break;
      }

      /*
       * ---- FETCH_IMAGE ----
       * Sent by the content script when it cannot convert a cross-origin
       * image to base64 (canvas tainting due to CORS). The background
       * service worker fetches the image bytes directly (it has
       * host_permissions that bypass CORS), converts to a base64 data URL,
       * and returns it.
       */
      case 'FETCH_IMAGE': {
        const { url } = payload;
        try {
          const parsedUrl = new URL(url);
          if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Only HTTP(S) image URLs are supported.');
          }

          const imageController = beginTrackedRequest(tabId, payload.requestId);
          let response;
          try {
            response = await fetchWithTimeout(
              parsedUrl.href,
              { method: 'GET', redirect: 'follow', credentials: 'omit', signal: imageController.signal },
              { timeoutMs: IMAGE_FETCH_TIMEOUT_MS, maxResponseBytes: MAX_FETCH_IMAGE_BYTES, as: 'bytes' }
            );
          } finally {
            endTrackedRequest(tabId, payload.requestId, imageController);
          }
          if (!response.ok) {
            sendResponse({ ok: false, error: `HTTP ${response.status}` });
            break;
          }

          const contentType = (response.headers.get('content-type') || '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
          if (!contentType.startsWith('image/')) {
            throw new Error('Fetched resource is not an image.');
          }

          const bytes = response.bytes;

          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);

          const dataUrl = `data:${contentType};base64,${base64}`;

          sendResponse({ ok: true, dataUrl });
        } catch (error) {
          if (isAbortError(error)) {
            sendResponse({ ok: false, cancelled: true, error: 'Request cancelled.' });
            break;
          }
          console.error('[VisionTranslate] FETCH_IMAGE error:', error);
          sendResponse({ ok: false, error: error.message });
        }
        break;
      }

      /*
       * ---- GET_SETTINGS ----
       * Sent by the content script or popup to read current settings.
       */
      case 'GET_SETTINGS': {
        const settings = await getSettings();
        sendResponse({ settings: sender.tab ? toContentScriptSettings(settings) : settings });
        break;
      }

      /*
       * ---- SAVE_SETTINGS ----
       * Sent by the popup when the user changes settings.
       * We save them and notify all active content scripts.
       */
      case 'SAVE_SETTINGS': {
        if (!isExtensionPageSender(sender)) {
          sendResponse({
            success: false,
            error: 'Settings can only be changed from an extension page.'
          });
          break;
        }

        if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
          sendResponse({ success: false, error: 'SAVE_SETTINGS needs a settings object.' });
          break;
        }

        /*
         * The popup sends a patch per change (not a debounced snapshot) so
         * a change made just before the popup closes still lands. Saves are
         * serialised inside saveSettings(); a storage failure is reported
         * as { success: false } rather than as a resolved promise the popup
         * would mistake for success.
         */
        let savedSettings;
        try {
          savedSettings = await saveSettings(payload.settings);
        } catch (error) {
          sendResponse({ success: false, error: `Could not save settings: ${toErrorMessage(error)}` });
          break;
        }

        /*
         * Broadcast updated settings to all tabs that have translation
         * active. This way, if the user changes the target language in
         * the popup, active translations can update.
         */
        for (const [activeTabId, state] of tabStates) {
          if (state.active) {
            await sendToContentScript(activeTabId, {
              action: 'SETTINGS_UPDATED',
              payload: { settings: toContentScriptSettings(savedSettings) }
            });
          }
        }

        sendResponse({ success: true, settings: savedSettings });
        break;
      }

      case 'FATAL_ERROR': {
        await showFatalErrorNotification(payload.errorMessage);
        sendResponse({ success: true });
        break;
      }

      /*
       * ---- AUTH_LOGIN ----
       * Sent by the popup to initiate Auth0 login via chrome.identity.
       */
      case 'AUTH_LOGIN': {
        if (!isExtensionPageSender(sender)) {
          sendResponse({ success: false, error: 'Sign-in can only be started from the extension popup.' });
          break;
        }
        try {
          const authData = await auth0Login();
          sendResponse({ success: true, user: authData.user });
        } catch (error) {
          console.error('[VisionTranslate] Auth0 login error:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      /*
       * ---- AUTH_LOGOUT ----
       * Sent by the popup to clear stored auth tokens.
       */
      case 'AUTH_LOGOUT': {
        if (!isExtensionPageSender(sender)) {
          sendResponse({ success: false, error: 'Sign-out can only be started from the extension popup.' });
          break;
        }
        try {
          await auth0Logout();
          sendResponse({ success: true });
        } catch (error) {
          console.error('[VisionTranslate] Auth0 logout error:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;
      }

      /*
       * ---- GET_AUTH_STATE ----
       * Sent by the popup to check if the user is signed in.
       */
      case 'GET_AUTH_STATE': {
        try {
          const authState = await getAuthState();
          sendResponse(authState);
        } catch (error) {
          console.error('[VisionTranslate] Auth state error:', error);
          sendResponse({ isAuthenticated: false, user: null });
        }
        break;
      }

      /*
       * ---- Default: Unknown Action ----
       * Log it for debugging. In production you might silently ignore.
       */
      default: {
        console.warn(`[VisionTranslate] Unknown action: ${action}`);
        sendResponse({ error: `Unknown action: ${action}` });
      }
    }
  })().catch((error) => {
    console.error('[VisionTranslate] Unhandled message error:', error);
    sendResponse({
      success: false,
      error: error?.message || 'Unexpected background worker error.'
    });
  });

  /*
   * CRITICAL: Return true to indicate we will call sendResponse
   * asynchronously. Without this, Chrome closes the message channel
   * before our async code finishes, and sendResponse becomes a no-op.
   */
  return true;
});

/*
 * --------------------------------------------------------------------------
 * Core Function: Toggle Translation on a Tab
 * --------------------------------------------------------------------------
 * This function:
 *   1. Flips the active state for the given tab.
 *   2. Sends a message to the content script to start or stop.
 *   3. Updates the toolbar badge.
 *   4. Persists the new state.
 */
async function toggleTranslation(tabId) {
  await tabStatesReady;
  const state = getTabState(tabId);
  const shouldActivate = !state.active;

  /*
   * Get the tab's hostname so we can persist the per-domain preference.
   * Toggling OFF adds the domain to the disabled list (stays off on
   * future visits). Toggling ON removes it (auto-activates again).
   */
  let hostname = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    hostname = getHostname(tab?.url);
  } catch {
    /* Tab may have been closed */
  }

  if (shouldActivate) {
    /*
     * --- ACTIVATE ---
     * Load current settings and send them along with the activation
     * message so the content script has everything it needs immediately.
     */
    const settings = await getSettings();

    const response = await sendToContentScript(tabId, {
      action: 'ACTIVATE',
      payload: { settings: toContentScriptSettings(settings) }
    });

    /*
     * If the content script didn't respond (null), it might not be
     * injected. This happens on pages where content scripts aren't
     * allowed (chrome:// URLs, the Chrome Web Store, etc.). A response
     * without success means it is there but activation itself failed.
     */
    if (response?.success !== true) {
      console.warn(
        `[VisionTranslate] Could not activate on tab ${tabId} (${response?.error || 'content script not available'}). Reverting state.`
      );
      state.active = false;
    } else {
      state.active = true;
      if (hostname) {
        await removeDisabledDomain(hostname);
      }
    }

  } else {
    /*
     * --- DEACTIVATE ---
     * Tell the content script to remove overlays and clean up.
     * Add the domain to the disabled list so it stays off.
     */
    if (hostname) {
      await addDisabledDomain(hostname);
    }

    await sendToContentScript(tabId, {
      action: 'DEACTIVATE',
      payload: {}
    });

    state.active = false;

    /* Reset progress counters */
    state.imageCount = 0;
    state.translatedCount = 0;
  }

  /* Update the toolbar badge to reflect the new state */
  await updateBadge(tabId);

  /* Persist to chrome.storage so state survives worker restarts */
  await persistTabStates();

  console.log(`[VisionTranslate] Translation ${state.active ? 'activated' : 'deactivated'} on tab ${tabId}${hostname ? ` (${hostname})` : ''}`);
}
