/*
 * ==========================================================================
 * VisionTranslate — Content Script (content.js)
 * ==========================================================================
 *
 * WHAT IS A CONTENT SCRIPT?
 * -------------------------
 * A content script is JavaScript that Chrome injects into every web page
 * (matching the patterns in manifest.json). It runs in an "isolated world":
 *
 *   - It CAN read and modify the page's DOM (HTML elements, CSS).
 *   - It CANNOT access the page's JavaScript variables or functions.
 *   - It CANNOT directly call chrome.* APIs that need special permissions
 *     (like making cross-origin requests). Instead it asks the background
 *     script to do those things via message passing.
 *   - The page's JavaScript CANNOT access our variables either (isolation
 *     goes both ways).
 *
 * WHAT THIS FILE DOES:
 * --------------------
 *   1. Waits for an "ACTIVATE" message from the background script.
 *   2. Scans the page for images (img tags, CSS background images, canvas).
 *   3. Filters images by size (skip tiny icons).
 *   4. For each qualifying image, sends it to the OCR backend (via the
 *      background script's proxy) to extract text and bounding boxes.
 *   5. Sends extracted text to the translation backend.
 *   6. Creates a <canvas> overlay on top of each image and uses
 *      overlay.js to paint translated text over the original.
 *   7. Watches for dynamically loaded images (using MutationObserver).
 *   8. Responds to "DEACTIVATE" to clean everything up.
 *
 * SHADOW DOM:
 * -----------
 * We use Shadow DOM for our overlay toolbar UI. Shadow DOM creates an
 * encapsulated DOM tree that is isolated from the page's CSS. This means:
 *   - The page's styles won't accidentally break our toolbar.
 *   - Our styles won't leak into the page.
 * This is important because we are injecting into EVERY website, and each
 * one has different CSS that could conflict with ours.
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------
 */

/*
 * Minimum image dimensions (in pixels) to consider for OCR. Images smaller
 * than this are likely icons, avatars, spacer GIFs, or decorative elements
 * that don't contain translatable text. Processing them would waste API
 * calls and clutter the page with unnecessary overlays.
 *
 * 100x50 is a reasonable threshold: most text-containing images (manga
 * panels, screenshots, memes, infographics) are larger than this.
 */
const DEFAULT_MIN_IMAGE_WIDTH = 100;
const DEFAULT_MIN_IMAGE_HEIGHT = 50;

/*
 * CSS class prefix for all elements we inject into the page. Using a
 * unique prefix prevents name collisions with the page's own CSS classes.
 */
const CLASS_PREFIX = 'vt-lensmu';

/*
 * Maximum number of images to process at once. Processing too many images
 * simultaneously would overwhelm both the OCR backend and the user's
 * browser with network requests and canvas rendering.
 */
const DEFAULT_MAX_CONCURRENT_IMAGES = 5;

/*
 * --------------------------------------------------------------------------
 * Module State
 * --------------------------------------------------------------------------
 * These variables track the content script's state. They reset whenever
 * the page navigates (since the content script is re-injected).
 */

/* Is translation currently active on this page? */
let isActive = false;

/* Current extension settings (received from background on activation) */
let currentSettings = {};

function getBoundedNumberSetting(key, fallback, minimum, maximum, integer = false) {
  const parsed = Number(currentSettings?.[key]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  const bounded = Math.min(maximum, Math.max(minimum, value));
  return integer ? Math.round(bounded) : bounded;
}

function getImageDiscoveryThresholds() {
  return {
    minWidth: getBoundedNumberSetting(
      'minImageWidth',
      DEFAULT_MIN_IMAGE_WIDTH,
      1,
      4096,
      true
    ),
    minHeight: getBoundedNumberSetting(
      'minImageHeight',
      DEFAULT_MIN_IMAGE_HEIGHT,
      1,
      4096,
      true
    )
  };
}

function getMaxConcurrentImages() {
  return getBoundedNumberSetting(
    'maxConcurrentImages',
    DEFAULT_MAX_CONCURRENT_IMAGES,
    1,
    12,
    true
  );
}

function getOverlayOpacity() {
  return getBoundedNumberSetting('overlayOpacity', 1, 0, 1);
}

function setOverlayVisibility(canvas, isVisible) {
  canvas.style.opacity = isVisible ? String(getOverlayOpacity()) : '0';
  canvas.style.pointerEvents = isVisible ? 'auto' : 'none';
}

/*
 * Map from image element to its overlay data. We use a WeakMap so that
 * if the page removes an image element, the overlay data is automatically
 * garbage-collected.
 *
 * Shape of each entry:
 * {
 *   canvas: HTMLCanvasElement,     — The canvas overlay covering the image
 *   wrapper: HTMLDivElement,       — The wrapper div (position: relative)
 *   ocrResults: Array,             — Merged paragraph/text-block boxes
 *   rawOcrResults: Array,          — Raw OCR boxes before block merging
 *   translations: Array,           — Translated text for each merged block
 *   showingTranslation: boolean    — Whether translation or original is showing
 * }
 */
let imageOverlays = new WeakMap();

/*
 * Per-image runtime state. Visible overlays are only allowed after an
 * explicit click path marks clicked = true.
 *
 * Shape:
 * {
 *   state: 'discovered' | 'icon-ready' | 'prefetched' | 'clicked' | 'rendering' | 'rendered',
 *   clicked: boolean,
 *   sourceKey: string,
 *   settingsSignature: string,
 *   imageInfo: { element, type, url },
 *   activeJob: { id: string, controller: AbortController, reason: string } | null,
 *   prepared: {
 *     imageBase64,
 *     rawOcrResults,
 *     mergedOcrResults,
 *     translations,
 *     speechText,
 *     imageFingerprint,
 *     translationHash,
 *     targetLanguage
 *   } | null,
 *   preparePromise: Promise | null
 * }
 */
let imageStates = new WeakMap();

/* Reference to the MutationObserver so we can disconnect it on deactivate */
let pageObserver = null;

/*
 * Set of translate-icon buttons we've added to images, so we can
 * remove them on deactivate. Controls for images the page removed are
 * released by releaseImageTarget() so this never pins detached DOM.
 */
const translateIcons = new Set();
const mutatedElementStyles = new Map();
let activeReadAloudSession = null;

/*
 * Every activation and deactivation bumps this. Work started under an
 * older generation (a batch loop that was mid-flight when the user turned
 * the extension off, a prefetch queued by the observer) checks it before
 * starting anything new and after every await, so nothing dequeues,
 * fetches or paints after deactivate().
 */
let activationGeneration = 0;

/* Jobs whose controller must be aborted on deactivation or cleanup. */
const activeJobs = new Set();

/* <img> elements still loading, each with the listener that will rescan. */
const pendingLoadListeners = new Map();

/*
 * Read-aloud requests are numbered; only the newest number may start
 * playback. Stop, disabling read-aloud, cleanup and every new click bump
 * it, so a generation that resolves late finds itself superseded.
 */
let readAloudRequestSerial = 0;

/*
 * One queue for every image job on the page, so the configured
 * parallel-image limit applies per page rather than per caller. The queue
 * itself lives in shared/image-work-queue.js; it is created on the first
 * activation and kept for the life of the content script.
 */
const PRIORITY_CLICK = 2;
const PRIORITY_PREFETCH = 1;
let imageWorkQueue = null;
let translationOutcomes = null;

/*
 * A content script is a classic script, so the shared modules it needs are
 * pulled in once at activation rather than awaited inside the per-image
 * pipeline — an import on that path adds a tick to every image and makes
 * the ordering harder to reason about for no gain.
 */
async function ensureSharedModules() {
  if (!imageWorkQueue) {
    const { createImageWorkQueue } = await import(
      chrome.runtime.getURL('shared/image-work-queue.js')
    );
    imageWorkQueue = createImageWorkQueue({
      getLimit: getMaxConcurrentImages,
      isRunnable: (entry) => isActive && isConnectedElement(entry.element)
    });
  }

  if (!translationOutcomes) {
    translationOutcomes = await import(
      chrome.runtime.getURL('shared/translation-outcomes.js')
    );
  }
}

/*
 * The identity of one unit of work: this activation, this mode, this
 * element's current source. Anything that changes makes it a different
 * job rather than a reused result — a click must never be handed an
 * in-flight prefetch's promise, and a src swap must start fresh work.
 */
function getImageWorkKey(imageInfo, mode) {
  return `${activationGeneration}::${mode}::${getImageSourceKey(imageInfo)}`;
}

function scheduleImageWork(imageInfo, mode, priority, task) {
  if (!imageWorkQueue) {
    return Promise.resolve(null);
  }
  return imageWorkQueue.schedule(getImageWorkKey(imageInfo, mode), imageInfo.element, priority, task);
}

function dropQueuedImageWork(element = null) {
  imageWorkQueue?.drop(element);
}

/* Size of the bookkeeping that must return to zero after a page cleanup. */
function getTrackedStateCount() {
  return (
    translateIcons.size +
    mutatedElementStyles.size +
    pendingLoadListeners.size +
    activeJobs.size +
    (imageWorkQueue?.size || 0)
  );
}

function rememberOriginalInlineStyle(element) {
  if (!element || mutatedElementStyles.has(element)) {
    return;
  }

  mutatedElementStyles.set(element, element.getAttribute('style'));
}

function restoreOriginalInlineStyles() {
  for (const [element, styleAttribute] of mutatedElementStyles) {
    if (!element?.isConnected) {
      continue;
    }
    if (styleAttribute === null) {
      element.removeAttribute('style');
    } else {
      element.setAttribute('style', styleAttribute);
    }
  }
  mutatedElementStyles.clear();
}

const READ_ALOUD_BUTTON_STATES = {
  stopped: {
    label: 'Read',
    background: 'rgba(15, 118, 110, 0.92)',
    title: 'Read translated text aloud'
  },
  generating: {
    label: 'Gen...',
    background: 'rgba(37, 99, 235, 0.92)',
    title: 'Generating translated speech'
  },
  playing: {
    label: 'Stop',
    background: 'rgba(217, 119, 6, 0.92)',
    title: 'Stop translated speech'
  },
  error: {
    label: 'Retry',
    background: 'rgba(220, 38, 38, 0.92)',
    title: 'Read aloud failed. Click to retry.'
  }
};

/*
 * --------------------------------------------------------------------------
 * Utility: Convert an image element to a base64-encoded data URL
 * --------------------------------------------------------------------------
 * The OCR backend expects images as base64 strings. We draw the image
 * onto a temporary canvas and export it as a data URL.
 *
 * Why not just send the image URL?
 *   - The image might be on a different domain (CORS blocks the backend
 *     from fetching it).
 *   - The image might require cookies/auth that the backend doesn't have.
 *   - The image might be a blob URL or data URL that only exists in
 *     the browser.
 *   - Base64 is universally portable.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement
 *        The image to convert. Can be an <img> tag or a <canvas>.
 * @returns {string|null}
 *        The base64 data URL (e.g., "data:image/png;base64,iVBOR...")
 *        or null if conversion fails (usually due to CORS tainted canvas).
 */

/*
 * --------------------------------------------------------------------------
 * OCR Compatibility Helpers
 * --------------------------------------------------------------------------
 * Server-backed OCR still runs through the background worker. Tesseract.js
 * must run in the content script because the MV3 service worker does not
 * expose the Worker constructor that Tesseract needs.
 */
function stripDataUrlPrefix(imageBase64) {
  if (!imageBase64 || !imageBase64.startsWith('data:')) {
    return imageBase64;
  }

  const commaIndex = imageBase64.indexOf(',');
  return commaIndex === -1 ? imageBase64 : imageBase64.slice(commaIndex + 1);
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getReadAloudSettingsSignature(settings = currentSettings) {
  return JSON.stringify({
    voiceId: String(settings?.elevenLabsVoiceId || '').trim(),
    modelId: String(settings?.elevenLabsModelId || '').trim(),
    outputFormat: String(settings?.elevenLabsOutputFormat || '').trim(),
    stability: Number(settings?.elevenLabsStability),
    similarityBoost: Number(settings?.elevenLabsSimilarityBoost),
    style: Number(settings?.elevenLabsStyle),
    speed: Number(settings?.elevenLabsSpeed)
  });
}

/*
 * Raised by a running job's checkpoints once its result is unwanted. It
 * carries the checkpoint's reason so the one catch arm that handles it can
 * report where the job stopped.
 */
class JobStoppedError extends Error {
  constructor(reason) {
    super('Image job stopped: ' + reason);
    this.name = 'JobStoppedError';
    this.reason = reason;
  }
}

function isConnectedElement(element) {
  return Boolean(element && element.isConnected);
}

function hasLiveExtensionContext() {
  try {
    return Boolean(globalThis.chrome?.runtime?.id);
  } catch (_error) {
    return false;
  }
}

function isExtensionContextInvalidated(error) {
  const message = String(error?.message || error || '').toLowerCase();

  return (
    message.includes('extension context invalidated') ||
    message.includes('context invalidated') ||
    message.includes('receiving end does not exist') ||
    message.includes('the message port closed before a response was received')
  );
}

function isLifecycleCancellationError(error) {
  return error?.name === 'AbortError' || isExtensionContextInvalidated(error);
}

async function safeSendMessage(message) {
  if (!hasLiveExtensionContext()) {
    throw new Error('Extension context invalidated');
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (!hasLiveExtensionContext() || isExtensionContextInvalidated(error)) {
      throw new Error('Extension context invalidated');
    }

    throw error;
  }
}

function getTranslateControl(imageElement) {
  for (const control of translateIcons) {
    if (control.element === imageElement) {
      return control;
    }
  }

  return null;
}

function clearTranslationFailureNotice(imageElement) {
  const control = getTranslateControl(imageElement);
  if (!control?.failureNotice) {
    return;
  }

  control.failureNotice.remove();
  control.failureNotice = null;
}

function showTranslationFailureNotice(imageElement, message) {
  if (!isConnectedElement(imageElement)) {
    return;
  }

  const control = getTranslateControl(imageElement);
  if (!control?.iconContainer?.isConnected) {
    console.warn('[VisionTranslate Content] Unable to show translation failure notice', {
      message
    });
    return;
  }

  if (!control.failureNotice) {
    const notice = document.createElement('div');
    notice.className = `${CLASS_PREFIX}-translation-failure`;
    notice.style.cssText = `
      max-width: 240px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(185, 28, 28, 0.94);
      color: white;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
      pointer-events: auto;
      white-space: normal;
    `;
    control.iconContainer.appendChild(notice);
    control.failureNotice = notice;
  }

  control.failureNotice.textContent = message;

  if (control.icon) {
    control.icon.innerHTML = '✗';
    control.icon.style.background = 'rgba(239, 68, 68, 0.9)';
    control.icon.style.animation = 'none';
  }
}

function setReadAloudButtonState(control, state, errorMessage = '') {
  const button = control?.readAloudButton;
  if (!button) return;

  const nextState = READ_ALOUD_BUTTON_STATES[state] || READ_ALOUD_BUTTON_STATES.stopped;
  button.textContent = nextState.label;
  button.title = errorMessage ? `${nextState.title}: ${errorMessage}` : nextState.title;
  button.style.background = nextState.background;
  button.disabled = state === 'generating';
  button.dataset.state = state;
}

function updateOverlayReadAloudState(imageElement, state, errorMessage = '') {
  const overlay = imageOverlays.get(imageElement);
  const control = getTranslateControl(imageElement);

  if (overlay) {
    overlay.readAloud = {
      ...(overlay.readAloud || {}),
      state,
      errorMessage
    };
  }

  setReadAloudButtonState(control, state, errorMessage);
}

/*
 * Stops whatever is playing and supersedes every pending generation: a
 * request that resolves after this call finds a newer serial and does not
 * start playback.
 */
function stopActiveReadAloudPlayback() {
  readAloudRequestSerial += 1;

  if (!activeReadAloudSession) {
    return;
  }

  const { audio, imageElement } = activeReadAloudSession;

  audio.pause();
  audio.currentTime = 0;
  activeReadAloudSession = null;
  updateOverlayReadAloudState(imageElement, 'stopped');
}

async function syncReadAloudTranslationCache(imageFingerprint, translationHash) {
  if (!imageFingerprint || !translationHash) {
    return;
  }

  try {
    await safeSendMessage({
      action: 'SYNC_READ_ALOUD_TRANSLATION',
      payload: {
        imageFingerprint,
        translationHash
      }
    });
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (isExtensionContextInvalidated(error)) {
      console.warn('[VisionTranslate] Read aloud cache sync cancelled:', errorMessage);
      return;
    }

    console.warn('[VisionTranslate] Read aloud cache sync failed:', errorMessage);
  }
}

async function handleReadAloudClick(imageElement) {
  const control = getTranslateControl(imageElement);
  const overlay = imageOverlays.get(imageElement);

  if (!currentSettings.enableReadAloud || !control || !overlay?.speechText) {
    return;
  }

  if (overlay.readAloud?.state === 'playing') {
    stopActiveReadAloudPlayback();
    return;
  }

  if (overlay.readAloud?.state === 'generating') {
    return;
  }

  /*
   * Stop anything playing (which also supersedes older pending requests),
   * then take this request's serial. Every await below re-checks it: the
   * user may have pressed Stop, clicked another image, changed voice
   * settings or turned read-aloud off while the provider was working.
   */
  stopActiveReadAloudPlayback();
  const requestSerial = readAloudRequestSerial;
  updateOverlayReadAloudState(imageElement, 'generating');

  const isSuperseded = () =>
    requestSerial !== readAloudRequestSerial ||
    !isActive ||
    !currentSettings.enableReadAloud ||
    imageOverlays.get(imageElement) !== overlay;

  try {
    const currentSignature = getReadAloudSettingsSignature();
    let audioDataUrl = overlay.readAloud?.audioDataUrl || '';

    if (!audioDataUrl || overlay.readAloud?.settingsSignature !== currentSignature) {
      const response = await safeSendMessage({
        action: 'GENERATE_READ_ALOUD_AUDIO',
        payload: {
          text: overlay.speechText,
          language: overlay.targetLanguage,
          imageFingerprint: overlay.imageFingerprint,
          translationHash: overlay.translationHash
        }
      });

      if (isSuperseded()) {
        logImageLifecycle('read aloud result discarded (superseded)', getImageState(imageElement)?.imageInfo);
        if (imageOverlays.get(imageElement) === overlay && overlay.readAloud?.state === 'generating') {
          updateOverlayReadAloudState(imageElement, 'stopped');
        }
        return;
      }

      if (!response?.ok) {
        throw new Error(response?.body?.error || 'Could not generate read aloud audio.');
      }

      audioDataUrl = response.body?.audioDataUrl || '';

      overlay.readAloud = {
        ...(overlay.readAloud || {}),
        audioDataUrl,
        cacheKey: response.body?.cacheKey || '',
        settingsSignature: currentSignature
      };
    }

    if (isSuperseded()) {
      if (imageOverlays.get(imageElement) === overlay) {
        updateOverlayReadAloudState(imageElement, 'stopped');
      }
      return;
    }

    if (!audioDataUrl) {
      throw new Error('No audio was returned for this translation.');
    }

    /*
     * Nothing else may be audible when the accepted result starts. This
     * stop bumps the serial, so re-take it: the checks after play() below
     * compare against the value this request now owns.
     */
    stopActiveReadAloudPlayback();
    const playbackSerial = readAloudRequestSerial;

    const audio = overlay.readAloud?.audio || new Audio();
    audio.pause();
    audio.currentTime = 0;
    audio.src = audioDataUrl;

    audio.onended = () => {
      if (activeReadAloudSession?.imageElement === imageElement) {
        activeReadAloudSession = null;
      }
      updateOverlayReadAloudState(imageElement, 'stopped');
    };

    audio.onerror = () => {
      if (activeReadAloudSession?.imageElement === imageElement) {
        activeReadAloudSession = null;
      }
      updateOverlayReadAloudState(imageElement, 'error', 'Playback failed.');
    };

    overlay.readAloud = {
      ...(overlay.readAloud || {}),
      audio
    };

    activeReadAloudSession = { imageElement, audio };
    updateOverlayReadAloudState(imageElement, 'playing');
    await audio.play();

    if (playbackSerial !== readAloudRequestSerial) {
      /* Stop was pressed while play() was starting up. */
      audio.pause();
      audio.currentTime = 0;
      if (activeReadAloudSession?.audio === audio) {
        activeReadAloudSession = null;
      }
      updateOverlayReadAloudState(imageElement, 'stopped');
    }
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      console.warn('[VisionTranslate] Read aloud playback cancelled:', error?.message || String(error));
      if (activeReadAloudSession?.imageElement === imageElement) {
        activeReadAloudSession = null;
      }
      updateOverlayReadAloudState(imageElement, 'stopped');
      return;
    }

    console.error('[VisionTranslate] Read aloud playback failed:', error);
    if (activeReadAloudSession?.imageElement === imageElement) {
      activeReadAloudSession = null;
    }
    updateOverlayReadAloudState(imageElement, 'error', error.message);
  }
}

function removeReadAloudButton(control) {
  if (!control?.readAloudButton) {
    return;
  }

  if (activeReadAloudSession?.imageElement === control.element) {
    stopActiveReadAloudPlayback();
  }

  control.readAloudButton.remove();
  control.readAloudButton = null;
}

function ensureReadAloudButton(imageElement) {
  const control = getTranslateControl(imageElement);
  const overlay = imageOverlays.get(imageElement);

  if (!control) {
    return;
  }

  if (!currentSettings.enableReadAloud || !overlay?.speechText) {
    removeReadAloudButton(control);
    return;
  }

  if (!control.readAloudButton) {
    const button = document.createElement('button');
    button.className = `${CLASS_PREFIX}-read-aloud-btn`;
    button.style.cssText = `
      height: 32px;
      border-radius: 16px;
      border: 2px solid rgba(255,255,255,0.8);
      background: ${READ_ALOUD_BUTTON_STATES.stopped.background};
      color: white;
      font-size: 11px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      padding: 0 12px;
      transition: transform 0.15s ease, opacity 0.15s ease;
      white-space: nowrap;
    `;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await handleReadAloudClick(imageElement);
    });

    control.iconContainer.insertBefore(button, control.translateAllBtn);
    control.readAloudButton = button;
  }

  const shouldResetAudio =
    overlay.readAloud?.settingsSignature &&
    overlay.readAloud.settingsSignature !== getReadAloudSettingsSignature();

  if (shouldResetAudio) {
    if (activeReadAloudSession?.imageElement === imageElement) {
      stopActiveReadAloudPlayback();
    }

    overlay.readAloud = {
      ...(overlay.readAloud || {}),
      state: 'stopped',
      errorMessage: '',
      audioDataUrl: '',
      settingsSignature: ''
    };
  }

  setReadAloudButtonState(
    control,
    overlay.readAloud?.state || 'stopped',
    overlay.readAloud?.errorMessage || ''
  );
}

function refreshReadAloudButtons() {
  if (!currentSettings.enableReadAloud && activeReadAloudSession) {
    stopActiveReadAloudPlayback();
  }

  for (const control of translateIcons) {
    ensureReadAloudButton(control.element);
  }
}

async function runBundledTesseractOCR(
  imageBase64,
  sourceLanguage = currentSettings.sourceLanguage || 'auto'
) {
  if (!hasLiveExtensionContext()) {
    throw new Error('Extension context invalidated');
  }

  const { recognize } = await import(chrome.runtime.getURL('ocr/tesseract.js'));
  const results = await recognize(
    stripDataUrlPrefix(imageBase64),
    sourceLanguage
  );

  return results.map((block) => ({
    text: block.text,
    confidence: block.confidence,
    bbox: {
      x: block.bbox[0],
      y: block.bbox[1],
      width: block.bbox[2] - block.bbox[0],
      height: block.bbox[3] - block.bbox[1]
    }
  }));
}

function imageToBase64(imageElement) {
  try {
    /*
     * Create a temporary offscreen canvas. This canvas is never added
     * to the DOM — it exists only in memory for the conversion.
     */
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    /*
     * For <img> elements: use naturalWidth/naturalHeight to get the
     * image's actual dimensions, not the CSS display dimensions.
     * For <canvas> elements: use width/height attributes.
     */
    let width, height;

    if (imageElement instanceof HTMLImageElement) {
      width = imageElement.naturalWidth;
      height = imageElement.naturalHeight;
    } else if (imageElement instanceof HTMLCanvasElement) {
      width = imageElement.width;
      height = imageElement.height;
    } else {
      /* For other elements (e.g., video poster), use offset dimensions */
      width = imageElement.offsetWidth;
      height = imageElement.offsetHeight;
    }

    /* Skip if we couldn't determine dimensions */
    if (!width || !height) {
      console.warn('[VisionTranslate] Could not determine image dimensions');
      return null;
    }

    tempCanvas.width = width;
    tempCanvas.height = height;

    /*
     * Very large images are exported as JPEG (0.85 quality) to keep the
     * payload sent to the OCR engine small. JPEG has no alpha channel and
     * toDataURL() composites transparent pixels onto BLACK, so a
     * transparent PNG with dark text came out black-on-black and OCR found
     * nothing. Paint a white background first whenever JPEG is the target;
     * the PNG path keeps the alpha channel untouched.
     */
    const useJpeg = width * height > 2000000;
    if (useJpeg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }

    /*
     * Draw the image onto our temporary canvas. This copies the pixel
     * data. If the image is from a different origin and the server
     * didn't set appropriate CORS headers, this will "taint" the canvas,
     * and toDataURL() below will throw a SecurityError.
     */
    ctx.drawImage(imageElement, 0, 0, width, height);

    /*
     * Export as a data URL. PNG is lossless so we don't degrade the image
     * quality. The result is a string like:
     * "data:image/png;base64,iVBORw0KGgo..."
     */
    if (useJpeg) {
      return tempCanvas.toDataURL('image/jpeg', 0.85);
    }

    return tempCanvas.toDataURL('image/png');
  } catch (error) {
    /*
     * SecurityError: the image was cross-origin and tainted the canvas.
     * This is a browser security feature we cannot bypass. We'll try
     * an alternative approach using the image URL directly.
     */
    if (error.name !== 'SecurityError') {
      console.error('[VisionTranslate] imageToBase64 error:', error);
    }
    return null;
  }
}

function isCrossOriginHttpUrl(url) {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url, window.location.href);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }
    return parsedUrl.origin !== window.location.origin;
  } catch (_error) {
    return false;
  }
}

async function fetchImageViaBackground(url, requestId = null) {
  if (!url) return null;

  try {
    const fetchResponse = await safeSendMessage({
      action: 'FETCH_IMAGE',
      payload: { url, requestId }
    });

    if (fetchResponse?.cancelled) {
      return null;
    }

    if (fetchResponse?.ok && fetchResponse.dataUrl) {
      return fetchResponse.dataUrl;
    }

    console.warn('[VisionTranslate] Background fetch failed:', fetchResponse?.error || 'Unknown error');
  } catch (fetchError) {
    const errorMessage = fetchError?.message || String(fetchError);
    if (isExtensionContextInvalidated(fetchError)) {
      console.warn('[VisionTranslate] Background fetch cancelled:', errorMessage);
      throw fetchError;
    }

    console.warn('[VisionTranslate] Background fetch error:', errorMessage);
  }

  return null;
}

/*
 * --------------------------------------------------------------------------
 * Utility: Extract background image URL from a DOM element
 * --------------------------------------------------------------------------
 * Some websites put text-containing images as CSS background-image instead
 * of <img> tags (common in hero sections, cards, etc.). We need to find
 * these too.
 *
 * @param {HTMLElement} element — Any DOM element
 * @returns {string|null} — The URL of the background image, or null
 */
function getBackgroundImageUrl(element) {
  /*
   * getComputedStyle() returns the ACTUAL rendered CSS values for an
   * element, including inherited and default styles. We look at the
   * 'background-image' property.
   *
   * The value looks like: url("https://example.com/image.jpg")
   * We need to extract just the URL part.
   */
  const style = window.getComputedStyle(element);
  const bgImage = style.backgroundImage;

  /* "none" means no background image is set */
  if (!bgImage || bgImage === 'none') {
    return null;
  }

  /*
   * Extract URL from the css value. The format is:
   *   url("https://example.com/image.jpg")
   * or
   *   url('https://example.com/image.jpg')
   * or
   *   url(https://example.com/image.jpg)
   *
   * The regex captures everything between url( and ) , removing optional
   * quotes.
   */
  const urlMatch = bgImage.match(/url\(["']?(.*?)["']?\)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  return null;
}

/*
 * --------------------------------------------------------------------------
 * Utility: Load an image URL into an HTMLImageElement
 * --------------------------------------------------------------------------
 * Returns a Promise that resolves with the loaded image element, or
 * rejects if loading fails. We set crossOrigin = 'anonymous' to attempt
 * CORS loading, which allows us to draw the image onto a canvas and
 * read its pixels (needed for base64 conversion).
 *
 * @param {string} url — The image URL to load
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    /*
     * Setting crossOrigin BEFORE setting src is critical. If you set
     * src first, the browser may start loading without CORS headers,
     * and changing crossOrigin afterward won't help.
     *
     * 'anonymous' means: send the request with CORS headers but
     * without cookies. If the server responds with appropriate
     * Access-Control-Allow-Origin headers, we can read the pixels.
     */
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`));

    img.src = url;
  });
}

/*
 * The image descriptor as it is *now*. Controls are created at discovery
 * time, but a page may later swap the element's src/srcset (lazy loading,
 * responsive sources, carousels), so every click and every job start
 * re-reads the live source instead of trusting the descriptor the control
 * was created with.
 */
function resolveLiveImageInfo(imageInfo) {
  const element = imageInfo?.element;
  const type = imageInfo?.type;

  if (!element) {
    return imageInfo;
  }

  if (type === 'img') {
    return { element, type, url: element.currentSrc || element.src || '' };
  }

  if (type === 'background') {
    let url = imageInfo.url;
    try {
      url = getBackgroundImageUrl(element) || imageInfo.url;
    } catch (_error) {
      /* detached or unstyled element: keep the last known URL */
    }
    return { element, type, url };
  }

  return { element, type, url: null };
}

function getImageSourceKey(imageInfo) {
  const { element, type, url } = imageInfo;

  if (type === 'canvas') {
    return [
      'canvas',
      element.width || 0,
      element.height || 0
    ].join('::');
  }

  return [
    type,
    url || '',
    element?.currentSrc || element?.src || '',
    element?.naturalWidth || element?.offsetWidth || 0,
    element?.naturalHeight || element?.offsetHeight || 0
  ].join('::');
}

function hasImageSourceChanged(imageState) {
  if (!imageState?.imageInfo?.element) {
    return false;
  }
  return getImageSourceKey(resolveLiveImageInfo(imageState.imageInfo)) !== imageState.sourceKey;
}

function getTranslationSettingsSignature(settings = currentSettings) {
  const configuredCredentials = settings?.configuredCredentials || {};
  return JSON.stringify({
    ocrEngine: settings?.ocrEngine || 'tesseract',
    translationProvider: settings?.translationProvider || 'libre',
    allowThirdPartyFallback: settings?.allowThirdPartyFallback === true,
    sourceLanguage: settings?.sourceLanguage || 'auto',
    targetLanguage: settings?.targetLanguage || 'en',
    backendUrl: settings?.backendUrl || '',
    googleCloudApiKey: Boolean(configuredCredentials.googleCloudApiKey),
    customOcrUrl: settings?.customOcrUrl || '',
    customOcrApiKey: Boolean(configuredCredentials.customOcrApiKey),
    openaiApiKey: Boolean(configuredCredentials.openaiApiKey),
    claudeApiKey: Boolean(configuredCredentials.claudeApiKey),
    geminiApiKey: Boolean(configuredCredentials.geminiApiKey),
    customApiKey: Boolean(configuredCredentials.customApiKey),
    customBaseUrl: settings?.customBaseUrl || '',
    customModelName: settings?.customModelName || '',
    llmModel: settings?.llmModel || ''
  });
}

function logImageLifecycle(eventName, imageInfo, extra = {}) {
  console.log(`[VisionTranslate] ${eventName}`, {
    type: imageInfo?.type,
    url: imageInfo?.url?.slice(0, 120) || '(canvas)',
    ...extra
  });
}

function setImageLifecycleState(imageState, nextState, extra = {}) {
  imageState.state = nextState;
  logImageLifecycle(`state -> ${nextState}`, imageState.imageInfo, extra);
}

function getImageState(imageElement) {
  return imageStates.get(imageElement) || null;
}

function resetTranslateControl(control) {
  if (!control?.icon) {
    return;
  }

  clearTranslationFailureNotice(control.element);
  setControlIconState(control.icon, 'idle');
  removeReadAloudButton(control);
}

function createImageState(imageInfo) {
  return {
    state: 'discovered',
    clicked: false,
    sourceKey: getImageSourceKey(imageInfo),
    settingsSignature: '',
    imageInfo,
    activeJob: null,
    prepared: null,
    preparePromise: null
  };
}

/*
 * Tells the service worker to abort the fetches a job started. Best
 * effort: the worker frees its connections, but an inference the backend
 * already began cannot be recalled from here.
 */
function cancelJobRequests(job) {
  if (!job?.requestIds?.size || !hasLiveExtensionContext()) {
    return;
  }
  const requestIds = [...job.requestIds];
  job.requestIds.clear();
  void safeSendMessage({ action: 'CANCEL_REQUESTS', payload: { requestIds } }).catch(() => undefined);
}

function registerJobRequest(job) {
  const requestId = `${job?.id || 'job'}-${Math.random().toString(36).slice(2)}`;
  job?.requestIds?.add(requestId);
  return requestId;
}

function cancelImageTranslationJob(imageState, reason = 'translation-cancelled') {
  const activeJob = imageState?.activeJob;

  if (!activeJob) {
    return;
  }

  if (!activeJob.controller.signal.aborted) {
    activeJob.controller.abort(reason);
  }
  cancelJobRequests(activeJob);
  activeJobs.delete(activeJob);

  if (imageState.activeJob === activeJob) {
    imageState.activeJob = null;
  }
}

function startImageTranslationJob(imageState, reason = 'translation-started') {
  cancelImageTranslationJob(imageState, reason);

  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    controller: new AbortController(),
    reason,
    generation: activationGeneration,
    requestIds: new Set()
  };

  imageState.activeJob = job;
  activeJobs.add(job);

  return job;
}

function isCurrentImageTranslationJob(imageState, job) {
  const element = imageState?.imageInfo?.element;

  return Boolean(
    job &&
    element &&
    imageState.activeJob === job &&
    !job.controller.signal.aborted &&
    job.generation === activationGeneration
  );
}

function cancelImageTranslationJobResult(imageState, job, reason = 'translation-cancelled') {
  if (job && !job.controller.signal.aborted) {
    job.controller.abort(reason);
  }
  cancelJobRequests(job);
  activeJobs.delete(job);

  if (imageState?.activeJob === job) {
    imageState.activeJob = null;
  }

  return { status: 'cancelled', reason };
}

function finalizeImageTranslationJob(imageState, job) {
  activeJobs.delete(job);

  if (isCurrentImageTranslationJob(imageState, job)) {
    imageState.activeJob = null;
  }
}

/*
 * Everything that makes a running job's result unwanted: the extension was
 * reloaded, the page removed the image, the user deactivated (generation
 * changed), a newer job superseded this one, or the image's source moved
 * on while we were fetching the old one.
 */
function shouldCancelImageTranslationJob(imageState, job) {
  return (
    !hasLiveExtensionContext() ||
    !isActive ||
    !isConnectedElement(imageState?.imageInfo?.element) ||
    !isCurrentImageTranslationJob(imageState, job) ||
    hasImageSourceChanged(imageState)
  );
}

function cancelAllImageJobs(reason) {
  for (const job of [...activeJobs]) {
    if (!job.controller.signal.aborted) {
      job.controller.abort(reason);
    }
    cancelJobRequests(job);
    activeJobs.delete(job);
  }
}

function ensureImageState(imageInfo) {
  const sourceKey = getImageSourceKey(imageInfo);
  let imageState = imageStates.get(imageInfo.element);

  if (!imageState) {
    imageState = createImageState(imageInfo);
    imageStates.set(imageInfo.element, imageState);
    logImageLifecycle('image discovered', imageInfo, { sourceKey });
  }

  if (imageState.sourceKey !== sourceKey) {
    invalidateImageState(imageInfo.element, 'image-source-changed');
    imageState = createImageState(imageInfo);
    imageStates.set(imageInfo.element, imageState);
    logImageLifecycle('image rediscovered after source change', imageInfo, { sourceKey });
  }

  imageState.imageInfo = imageInfo;
  if (imageState.state === 'discovered') {
    setImageLifecycleState(imageState, 'icon-ready');
  }

  return imageState;
}

function invalidateImageState(imageElement, reason = 'invalidated') {
  const imageState = imageStates.get(imageElement);
  const control = getTranslateControl(imageElement);

  if (imageState) {
    cancelImageTranslationJob(imageState, reason);
  }

  removeOverlayForElement(imageElement);

  if (control) {
    resetTranslateControl(control);
  }

  if (!imageState) {
    return;
  }

  imageState.clicked = false;
  imageState.prepared = null;
  imageState.preparePromise = null;
  imageState.settingsSignature = '';
  imageState.activeJob = null;
  setImageLifecycleState(imageState, 'icon-ready', { reason });
}

/*
 * Forgets an image the page removed: its job, control, overlay, style
 * record, pending load listener and queued work. The inline style is
 * dropped rather than restored — the host removed the element, so what it
 * had before is no longer ours to reinstate. Called only for elements
 * that are no longer connected at flush time; an element the extension or
 * the host merely re-parented is connected again by then and untouched.
 */
function releaseImageTarget(element, reason = 'image-removed') {
  const imageState = imageStates.get(element);
  const control = getTranslateControl(element);

  if (imageState) {
    cancelImageTranslationJob(imageState, reason);
    imageState.prepared = null;
    imageState.preparePromise = null;
  }
  dropQueuedImageWork(element);
  imageStates.delete(element);

  if (activeReadAloudSession?.imageElement === element) {
    stopActiveReadAloudPlayback();
  }
  const overlay = imageOverlays.get(element);
  if (overlay) {
    overlay.wrapper?.remove?.();
    overlay.canvas?.remove?.();
    imageOverlays.delete(element);
  }

  if (control) {
    control.iconContainer?.remove?.();
    control.icon?.remove?.();
    control.failureNotice?.remove?.();
    control.readAloudButton?.remove?.();
    translateIcons.delete(control);
  }

  mutatedElementStyles.delete(element);
  unwatchImageLoad(element);
  if (element?.dataset) {
    delete element.dataset.vtIconAdded;
  }

  logImageLifecycle('image released', imageState?.imageInfo || { element }, { reason });
}

/* Releases every tracked target the page has removed since the last flush. */
function releaseDisconnectedTargets() {
  let released = 0;
  for (const control of [...translateIcons]) {
    if (!isConnectedElement(control.element)) {
      releaseImageTarget(control.element, 'image-removed');
      released += 1;
    }
  }
  for (const element of [...mutatedElementStyles.keys()]) {
    if (!isConnectedElement(element)) {
      mutatedElementStyles.delete(element);
    }
  }
  for (const element of [...pendingLoadListeners.keys()]) {
    if (!isConnectedElement(element)) {
      unwatchImageLoad(element);
    }
  }
  return released;
}

/*
 * An <img> that has not finished loading has no natural size yet, so
 * discovery skips it; its later load fires no DOM mutation, so the
 * observer would never revisit it. Listen for that load (or a retry after
 * an error) and run the same debounced discovery the observer uses.
 */
function watchImageLoad(img) {
  if (!img || pendingLoadListeners.has(img)) {
    return;
  }

  const handler = () => {
    if (!isActive) {
      unwatchImageLoad(img);
      return;
    }
    if (img.complete && img.naturalWidth > 0) {
      unwatchImageLoad(img);
      scheduleDiscoveryRefresh('image-loaded');
    }
    /* On error keep listening: a src replacement will fire load again. */
  };

  img.addEventListener('load', handler);
  img.addEventListener('error', handler);
  pendingLoadListeners.set(img, handler);
}

function unwatchImageLoad(img) {
  const handler = pendingLoadListeners.get(img);
  if (!handler) {
    return;
  }
  img.removeEventListener('load', handler);
  img.removeEventListener('error', handler);
  pendingLoadListeners.delete(img);
}

/* True for nodes the extension created (wrappers, controls, overlays). */
function isExtensionNode(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (node.id && String(node.id).startsWith(CLASS_PREFIX)) {
    return true;
  }
  for (const className of node.classList || []) {
    if (className.startsWith(`${CLASS_PREFIX}-`)) {
      return true;
    }
  }
  return false;
}

function isInsideExtensionNode(node) {
  let current = node;
  while (current) {
    if (isExtensionNode(current)) {
      return true;
    }
    current = current.parentElement || null;
  }
  return false;
}

function blockOverlayRenderBecauseNoClick(imageState, reason) {
  logImageLifecycle('overlay render blocked because no click occurred', imageState.imageInfo, {
    reason,
    state: imageState.state
  });
}

/*
 * --------------------------------------------------------------------------
 * Core: Scan the page for images
 * --------------------------------------------------------------------------
 * Finds all images on the page that are large enough to potentially
 * contain text. Returns an array of objects describing each image.
 *
 * We look in three places:
 *   1. <img> tags — The most common way images appear on pages
 *   2. CSS background-image — Used by many modern websites
 *   3. <canvas> elements — Used by web apps, games, PDF viewers
 *
 * @returns {Array<{element: HTMLElement, type: string, url: string|null}>}
 */
function scanForImages() {
  const results = [];
  const { minWidth, minHeight } = getImageDiscoveryThresholds();

  /*
   * ---------- 1. Find all <img> tags ----------
   * document.querySelectorAll returns a static NodeList of all matching
   * elements. We use 'img' to find every image tag on the page.
   */
  const imgElements = document.querySelectorAll('img');

  for (const img of imgElements) {
    /*
     * Skip images that haven't loaded yet. naturalWidth/naturalHeight
     * are 0 for unloaded images or broken image links. Their eventual
     * load fires no DOM mutation, so watch for it explicitly.
     */
    if (!img.naturalWidth || !img.naturalHeight) {
      watchImageLoad(img);
      continue;
    }
    unwatchImageLoad(img);

    /* Skip images smaller than our minimum threshold */
    if (img.naturalWidth < minWidth || img.naturalHeight < minHeight) {
      continue;
    }

    /*
     * Skip images that are not visible. offsetParent is null for hidden
     * elements (display:none or inside a hidden ancestor). The exception
     * is <body>, which has offsetParent === null even when visible.
     */
    if (!img.offsetParent && img.parentElement !== document.body) {
      continue;
    }

    results.push({
      element: img,
      type: 'img',
      url: img.currentSrc || img.src
    });
  }

  /*
   * ---------- 2. Find elements with CSS background images ----------
   * We check common elements that often have background images:
   * divs, sections, headers, spans, and elements with certain roles.
   *
   * Checking EVERY element on the page would be too slow, so we limit
   * to elements that are large enough and commonly used for backgrounds.
   */
  const bgCandidates = document.querySelectorAll(
    'div, section, header, article, figure, span, a'
  );

  for (const el of bgCandidates) {
    /* Skip our own extension elements */
    if (el.classList?.contains(`${CLASS_PREFIX}-wrapper`) || el.classList?.contains(`${CLASS_PREFIX}-icon-wrapper`) || el.id?.startsWith(CLASS_PREFIX)) {
      continue;
    }

    /* Skip small elements */
    if (el.offsetWidth < minWidth || el.offsetHeight < minHeight) {
      continue;
    }

    const bgUrl = getBackgroundImageUrl(el);
    if (bgUrl) {
      results.push({
        element: el,
        type: 'background',
        url: bgUrl
      });
    }
  }

  /*
   * ---------- 3. Find <canvas> elements ----------
   * Canvas elements might contain rendered text (e.g., PDF.js viewers,
   * games, custom rendering). We can directly read their pixel data.
   */
  const canvasElements = document.querySelectorAll('canvas');

  for (const canvas of canvasElements) {
    /* Skip our own overlay canvases */
    if (canvas.classList?.contains(`${CLASS_PREFIX}-canvas`)) {
      continue;
    }

    if (canvas.width < minWidth || canvas.height < minHeight) {
      continue;
    }

    results.push({
      element: canvas,
      type: 'canvas',
      url: null  /* Canvas has no URL; we read pixels directly */
    });
  }

  console.log(`[VisionTranslate] Found ${results.length} qualifying images during discovery`);
  return results;
}

/*
 * --------------------------------------------------------------------------
 * Core: Create a canvas overlay on top of an image
 * --------------------------------------------------------------------------
 * For each image we want to translate, we create a <canvas> element that
 * is positioned EXACTLY on top of the original image. The canvas is where
 * we paint the translated text.
 *
 * The technique:
 *   1. Wrap the image in a <div> with position:relative (if not already).
 *   2. Create a <canvas> with position:absolute, same size as the image.
 *   3. Place the canvas on top of the image using z-index.
 *
 * @param {HTMLElement} imageElement — The image to overlay
 * @returns {{canvas: HTMLCanvasElement, wrapper: HTMLDivElement}}
 */
function createOverlay(imageElement) {
  removeOverlayForElement(imageElement);
  rememberOriginalInlineStyle(imageElement);

  /*
   * Get the image's displayed dimensions. These might differ from the
   * natural dimensions (e.g., if CSS scales the image). The overlay
   * must match the DISPLAYED size, not the natural size.
   */
  const rect = imageElement.getBoundingClientRect();
  const displayWidth = Math.round(rect.width);
  const displayHeight = Math.round(rect.height);

  /*
   * Create a wrapper div with position:relative. This becomes the
   * "positioning context" for the absolutely-positioned canvas.
   *
   * We insert the wrapper into the DOM in place of the image, then
   * move the image inside the wrapper. This preserves the image's
   * position in the page layout.
   */
  const wrapper = document.createElement('div');
  wrapper.className = `${CLASS_PREFIX}-wrapper`;

  /*
   * Detect standalone image pages (image opened in a new tab).
   * Browsers center images with display:block + margin:auto. Preserve
   * that centering on the wrapper instead of using inline-block.
   *
   * NOTE: getComputedStyle resolves 'auto' margins to pixel values,
   * so we check document.contentType and the element's inline style.
   */
  const isImageDocument = document.contentType &&
    document.contentType.startsWith('image/');
  const hasInlineAutoMargin = imageElement.tagName === 'IMG' &&
    /margin\s*:\s*auto/i.test(imageElement.style.cssText);
  const isCentered = isImageDocument || hasInlineAutoMargin;

  wrapper.style.cssText = isCentered
    ? `position: relative; display: block; margin: auto; width: ${displayWidth}px; height: ${displayHeight}px;`
    : `position: relative; display: inline-block; width: ${displayWidth}px; height: ${displayHeight}px;`;

  /*
   * Insert the wrapper where the image is, then move the image inside it.
   *
   * parentNode.insertBefore(newNode, referenceNode) inserts newNode
   * right before referenceNode in the parent's children.
   *
   * wrapper.appendChild(imageElement) moves the image from its current
   * position into the wrapper (DOM elements can only be in one place).
   *
   * IMPORTANT: For background-image elements, we don't move the element.
   * Instead we create the wrapper as a sibling overlay.
   */
  if (imageElement.tagName === 'IMG' || imageElement.tagName === 'CANVAS') {
    imageElement.parentNode.insertBefore(wrapper, imageElement);
    wrapper.appendChild(imageElement);

    /* Make the image fill the wrapper */
    imageElement.style.display = 'block';
    imageElement.style.width = '100%';
    imageElement.style.height = '100%';
  } else {
    /*
     * For background-image elements, we cannot move them (it would break
     * the page layout). Instead, we position the wrapper as an overlay
     * on top using absolute positioning relative to the element.
     *
     * We need the element to have position:relative so our overlay
     * can be positioned absolutely within it.
     */
    const existingPosition = window.getComputedStyle(imageElement).position;
    if (existingPosition === 'static') {
      imageElement.style.position = 'relative';
    }
    imageElement.appendChild(wrapper);
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
  }

  /*
   * Create the canvas overlay. The canvas sits on top of the image
   * and is where we'll paint the translated text.
   *
   * The canvas has TWO sets of dimensions:
   *   - CSS dimensions (style.width/height): how big it appears on screen
   *   - Canvas dimensions (canvas.width/height): the internal pixel grid
   *
   * For sharp rendering, the canvas pixel grid should match the
   * device pixel ratio. On a 2x Retina display, we make the canvas
   * 2x the CSS dimensions and scale the drawing context down.
   */
  const canvas = document.createElement('canvas');
  canvas.className = `${CLASS_PREFIX}-canvas`;

  /* Add toggle logic for translation visibility */
  function toggleTranslationOverlay(e) {
    const overlay = imageOverlays.get(imageElement);
    if (!overlay || !overlay.translations || overlay.translations.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    overlay.showingTranslation = !overlay.showingTranslation;
    setOverlayVisibility(canvas, overlay.showingTranslation);

    /* Update icon if present */
    const control = getTranslateControl(imageElement);
    if (control?.icon) {
      if (overlay.showingTranslation) {
        control.icon.innerHTML = "✓";
        control.icon.style.background = "rgba(34, 197, 94, 0.9)";
      } else {
        control.icon.innerHTML = "文A";
        control.icon.style.background = "rgba(59, 130, 246, 0.9)";
      }
    }
  }

  canvas.addEventListener("click", toggleTranslationOverlay);
  wrapper.addEventListener("click", (e) => {
    if (e.target.closest(`.${CLASS_PREFIX}-translate-icon-container`)) return;
    const overlay = imageOverlays.get(imageElement);
    if (overlay && !overlay.showingTranslation && overlay.translations?.length > 0) {
      toggleTranslationOverlay(e);
    }
  });

  /*
   * Device pixel ratio: On Retina/HiDPI screens this is 2 or 3,
   * meaning each CSS pixel corresponds to 2 or 3 physical pixels.
   * We scale the canvas to match for sharp text rendering.
   */
  const dpr = window.devicePixelRatio || 1;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;

  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: ${displayWidth}px;
    height: ${displayHeight}px;
    z-index: 1;
    pointer-events: auto;
    cursor: default;
  `;

  /*
   * Scale the canvas drawing context to account for device pixel ratio.
   * After this, drawing at (10, 10) means 10 CSS pixels, not 10 canvas
   * pixels. This makes all our drawing code resolution-independent.
   */
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  /*
   * Start with the canvas fully transparent so the original image
   * shows through. We only paint over regions where we have translated
   * text.
   */
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  wrapper.appendChild(canvas);

  return { canvas, wrapper };
}

function removeOverlayForElement(imageElement) {
  const existingOverlay = imageOverlays.get(imageElement);
  if (!existingOverlay) {
    return;
  }

  if (activeReadAloudSession?.imageElement === imageElement) {
    stopActiveReadAloudPlayback();
  }

  const { wrapper, canvas } = existingOverlay;
  if (imageElement.tagName === 'IMG' || imageElement.tagName === 'CANVAS') {
    if (wrapper.parentNode) {
      const children = Array.from(wrapper.children);
      for (const child of children) {
        if (child !== canvas && !child.classList?.contains(`${CLASS_PREFIX}-canvas`)) {
          wrapper.parentNode.insertBefore(child, wrapper);
        }
      }
    }
    wrapper.remove();
  } else {
    wrapper.remove();
  }

  imageOverlays.delete(imageElement);
}

function removeOverlay(imageElement) {
  removeOverlayForElement(imageElement);
}

/*
 * --------------------------------------------------------------------------
 * Core: Prepare a single image through the OCR + Translation pipeline
 * --------------------------------------------------------------------------
 * Preparation performs OCR and translation work without creating a visible
 * overlay. Rendering is handled separately behind an explicit click gate.
 *
 * @param {{element: HTMLElement, type: string, url: string|null}} imageInfo
 *        The image descriptor from scanForImages()
 */
/*
 * The image's pixels as a data URL, by whichever route this element allows:
 * a canvas exports itself, a cross-origin <img> goes through the service
 * worker (which has host permissions the page does not), a CSS background
 * tries a CORS load first. Same-origin content and anything whose canvas
 * read failed fall back to the worker once, and only once.
 *
 * Returns { bytes } or { bytes: null, reason, message } — a tainted canvas
 * is reported separately from "no route worked" because the user can do
 * nothing about the former.
 */
async function acquireImageBytes(imageInfo, { job, prefersBackgroundFetch, throwIfStopped }) {
  const { element, type, url } = imageInfo;
  let bytes = null;

  if (type === 'canvas') {
    try {
      return { bytes: element.toDataURL('image/png') };
    } catch (error) {
      console.warn('[VisionTranslate] Cannot export canvas (tainted):', error.message);
      return { bytes: null, reason: 'canvas-tainted', message: error.message };
    }
  }

  if (prefersBackgroundFetch) {
    throwIfStopped('background-fetch-cancelled');
    bytes = await fetchImageViaBackground(url, registerJobRequest(job));
    throwIfStopped('background-fetch-cancelled');

    /*
     * The background fetch is cookieless, so an image behind a login comes
     * back 401/403 even though the page itself displays it. If the page
     * loaded it with a crossorigin attribute and the host answered with
     * CORS headers, the pixels can still be read straight off the element.
     * Without the attribute the canvas is tainted for certain, so skip the
     * full-resolution draw that would only throw.
     */
    if (!bytes && type === 'img' && element.crossOrigin) {
      bytes = imageToBase64(element);
    }
  } else if (type === 'background') {
    try {
      throwIfStopped('background-image-load-cancelled');
      const loadedImg = await loadImage(url);
      throwIfStopped('background-image-load-cancelled');
      bytes = imageToBase64(loadedImg);
    } catch (error) {
      /* A cancelled job is not a failed load: it must not be retried. */
      if (error instanceof JobStoppedError) {
        throw error;
      }
      console.warn('[VisionTranslate] Could not load background image via CORS, trying background fetch:', url?.substring(0, 80));
    }
  } else {
    bytes = imageToBase64(element);
  }

  /*
   * Last resort for same-origin images and CSS backgrounds whose canvas
   * read failed (SVG with foreignObject, a failed CORS load). Cross-origin
   * <img> elements already tried this exact fetch above, so do not repeat a
   * request that just failed.
   */
  if (!bytes && url && !prefersBackgroundFetch) {
    throwIfStopped('fallback-background-fetch-cancelled');
    bytes = await fetchImageViaBackground(url, registerJobRequest(job));
    throwIfStopped('fallback-background-fetch-cancelled');
  }

  return bytes ? { bytes } : { bytes: null, reason: 'image-unreadable' };
}

async function prepareImageForTranslation(discoveredImageInfo, options = { reason: 'click' }) {
  /*
   * Work from the element's current source, not the one the control was
   * created with: ensureImageState() then invalidates any state (and any
   * running job) that belonged to a previous source.
   */
  const imageInfo = resolveLiveImageInfo(discoveredImageInfo);
  const { element, type, url } = imageInfo;
  const imageState = ensureImageState(imageInfo);
  const isPrefetch = options.reason === 'prefetch';

  if (!isActive) {
    return { status: 'cancelled', reason: 'inactive' };
  }
  const settingsSnapshot = { ...(currentSettings || {}) };
  const settingsSignature = getTranslationSettingsSignature(settingsSnapshot);
  let currentJob = null;

  if (
    imageState.prepared &&
    imageState.settingsSignature === settingsSignature &&
    imageState.sourceKey === getImageSourceKey(imageInfo)
  ) {
    logImageLifecycle(
      isPrefetch
        ? 'background preprocessing reused cached result'
        : 'click-triggered translation reused cached result',
      imageInfo,
      {
        blockCount: imageState.prepared.mergedOcrResults.length,
        usedCachedResult: true
      }
    );

    if (isPrefetch && !imageState.clicked) {
      blockOverlayRenderBecauseNoClick(imageState, 'cached-prefetch-result');
    }

    return { status: 'prepared', reason: 'cached', prepared: imageState.prepared };
  }

  if (imageState.preparePromise) {
    return imageState.preparePromise;
  }

  logImageLifecycle(
    isPrefetch ? 'background preprocessing started' : 'click-triggered translation started',
    imageInfo,
    { sourceKey: imageState.sourceKey }
  );

  imageState.settingsSignature = settingsSignature;
  let preparePromise = null;
  preparePromise = (async () => {
    let imageBase64 = null;
    const prefersBackgroundFetch = isCrossOriginHttpUrl(url);
    /*
     * Ends the job without a rendered result. `status` distinguishes the
     * neutral outcomes (no text in the image, every block already in the
     * target language) from a real failure, so the control can show "—"
     * instead of a red ✗ for an image that simply had nothing to do.
     */
    /* Ends the job with no rendered result, reporting why. */
    const endWithout = (outcome) => {
      finalizeImageTranslationJob(imageState, currentJob);
      return outcome;
    };
    /*
     * Raised after an await when the job's result is no longer wanted. It
     * unwinds to the single catch arm below, which turns it into the
     * cancelled outcome — rather than each of the nineteen checkpoints
     * repeating that conversion inline.
     */
    const throwIfJobStopped = (reason) => {
      if (shouldCancelImageTranslationJob(imageState, currentJob)) {
        throw new JobStoppedError(reason);
      }
    };

    currentJob = startImageTranslationJob(
      imageState,
      isPrefetch ? 'background-preprocess-started' : 'click-translation-started'
    );

    throwIfJobStopped('translation-start-cancelled');

    const acquired = await acquireImageBytes(imageInfo, {
      job: currentJob,
      prefersBackgroundFetch,
      throwIfStopped: throwIfJobStopped
    });

    if (!acquired.bytes) {
      const message =
        acquired.reason === 'canvas-tainted'
          ? acquired.message
          : 'the image pixels could not be read (cross-origin image without CORS access)';
      console.warn('[VisionTranslate] Failed to convert image to base64. Skipping.');
      if (!isPrefetch && acquired.reason !== 'canvas-tainted') {
        showTranslationFailureNotice(element, `Translation failed: ${message}.`);
      }
      return endWithout({ status: 'failed', reason: acquired.reason, message: acquired.message || '' });
    }

    imageBase64 = acquired.bytes;

    throwIfJobStopped('ocr-request-cancelled');

    const ocrResponse = await safeSendMessage({
      action: 'OCR_REQUEST',
      payload: {
        imageBase64,
        sourceLang: settingsSnapshot.sourceLanguage || 'auto',
        requestId: registerJobRequest(currentJob)
      }
    });

    if (ocrResponse?.cancelled) {
      return cancelImageTranslationJobResult(imageState, currentJob, 'ocr-request-cancelled');
    }

    throwIfJobStopped('ocr-response-stale');

    if (!ocrResponse || !ocrResponse.ok) {
      console.warn('[VisionTranslate] OCR request failed:', ocrResponse?.body?.error || 'Unknown error');
      if (!isPrefetch) {
        showTranslationFailureNotice(
          element,
          `Translation failed: ${ocrResponse?.body?.error || 'OCR request failed.'}`
        );
      }
      return endWithout({ status: 'failed', reason: 'ocr-failed', message: ocrResponse?.body?.error || '' });
    }

    let rawOcrResults = ocrResponse.body?.blocks || [];
    if (ocrResponse.body?.useClientOCR) {
      const sourceLang = ocrResponse.body?.source_lang || settingsSnapshot.sourceLanguage || 'auto';
      console.log('[VisionTranslate] Running bundled Tesseract OCR in content script.');
      try {
        throwIfJobStopped('client-ocr-cancelled');
        rawOcrResults = await runBundledTesseractOCR(imageBase64, sourceLang);
        throwIfJobStopped('client-ocr-cancelled');
      } catch (tessError) {
        if (tessError instanceof JobStoppedError) {
          throw tessError;
        }
        console.warn('[VisionTranslate] Bundled Tesseract.js OCR failed:', tessError.message);
        if (!isPrefetch) {
          showTranslationFailureNotice(element, `Translation failed: ${tessError.message}`);
        }
        return endWithout({ status: 'failed', reason: 'ocr-failed', message: tessError.message });
      }
    }

    if (rawOcrResults.length === 0) {
      console.log('[VisionTranslate] No text found in image. Skipping.');
      return endWithout({ status: 'no-text', reason: 'no-text' });
    }

    console.log(`[VisionTranslate] OCR found ${rawOcrResults.length} raw text boxes`);

    const ocrSourceLanguage = ocrResponse.body?.source_lang || settingsSnapshot.sourceLanguage || 'auto';
    console.log('[VisionTranslate Content] OCR text detected', {
      sourceLang: ocrSourceLanguage,
      blockCount: rawOcrResults.length
    });

    throwIfJobStopped('overlay-module-load-cancelled');

    const overlayModule = await import(chrome.runtime.getURL('overlay.js'));
    throwIfJobStopped('overlay-module-load-cancelled');

    const mergedOcrResults = overlayModule.groupTextBlocks(rawOcrResults);

    if (mergedOcrResults.length === 0) {
      console.log('[VisionTranslate] OCR merge step produced no renderable text blocks. Skipping.');
      return endWithout({ status: 'no-text', reason: 'no-renderable-blocks' });
    }

    console.log(
      `[VisionTranslate] Reconstructed ${mergedOcrResults.length} merged text blocks from ${rawOcrResults.length} raw OCR boxes`
    );

    const textsToTranslate = mergedOcrResults.map((block) => block.text);
    const requestedTargetLanguage = settingsSnapshot.targetLanguage || 'en';

    console.log('[VisionTranslate Content] Grouped text sent to translator', {
      sourceLang: ocrSourceLanguage,
      targetLang: requestedTargetLanguage,
      textCount: textsToTranslate.length,
      characterCount: textsToTranslate.reduce((total, text) => total + text.length, 0)
    });

    throwIfJobStopped('translation-request-cancelled');

    const translateResponse = await safeSendMessage({
      action: 'TRANSLATE_REQUEST',
      payload: {
        texts: textsToTranslate,
        sourceLang: ocrSourceLanguage,
        targetLang: requestedTargetLanguage,
        requestId: registerJobRequest(currentJob)
      }
    });

    if (translateResponse?.cancelled) {
      return cancelImageTranslationJobResult(imageState, currentJob, 'translation-request-cancelled');
    }

    throwIfJobStopped('translation-response-stale');

    console.log('[VisionTranslate Content] Raw translation response', {
      ok: Boolean(translateResponse?.ok),
      providerRequested: settingsSnapshot.translationProvider || 'libre',
      sourceLang: translateResponse?.body?.source_lang || ocrSourceLanguage,
      targetLang: translateResponse?.body?.target_lang || requestedTargetLanguage,
      providerUsed: translateResponse?.body?.provider || null,
      fallbackUsed: Boolean(translateResponse?.body?.fallback_used),
      diagnostics: translateResponse?.body?.diagnostics || null,
      translationCount: translateResponse?.body?.translations?.length || 0,
      error: translateResponse?.body?.error || null
    });

    if (!translateResponse || !translateResponse.ok) {
      const failureMessage = translateResponse?.body?.error || 'Unknown translation error.';
      console.warn('[VisionTranslate] Translation request failed:', failureMessage);
      if (!isPrefetch) {
        showTranslationFailureNotice(element, `Translation failed: ${failureMessage}`);
      }
      return endWithout({ status: 'failed', reason: 'translation-failed', message: failureMessage });
    }

    const translations = translateResponse.body?.translations || [];
    const translatedSourceLanguage = translateResponse.body?.source_lang || ocrSourceLanguage;
    const targetLanguage = translateResponse.body?.target_lang || requestedTargetLanguage;

    if (translations.length !== mergedOcrResults.length) {
      const failureMessage =
        `Provider returned ${translations.length} translations for ` +
        `${mergedOcrResults.length} text blocks.`;
      console.error('[VisionTranslate Content] Translation count mismatch', {
        sourceLang: translatedSourceLanguage,
        targetLang: targetLanguage,
        providerRequested: settingsSnapshot.translationProvider || 'libre',
        providerUsed: translateResponse.body?.provider || null,
        diagnostics: translateResponse.body?.diagnostics || null,
        failureMessage
      });
      if (!isPrefetch) {
        showTranslationFailureNotice(element, 'Translation failed: incomplete provider response.');
      }
      return endWithout({ status: 'failed', reason: 'translation-count-mismatch', message: failureMessage });
    }

    const verdictDetail = {
      sourceLang: translatedSourceLanguage,
      targetLang: targetLanguage,
      providerRequested: settingsSnapshot.translationProvider || 'libre',
      providerUsed: translateResponse.body?.provider || null,
      fallbackUsed: Boolean(translateResponse.body?.fallback_used),
      diagnostics: translateResponse.body?.diagnostics || null
    };
    const classified = translationOutcomes.classifyTranslations({
      blocks: mergedOcrResults,
      translations,
      reportedOutcomes: translateResponse.body?.outcomes,
      sourceLanguage: translatedSourceLanguage,
      targetLanguage
    });
    const translationEntries = classified.entries;

    if (classified.failed.length > 0) {
      console.warn('[VisionTranslate Content] Some blocks came back without a translation and stay untouched', {
        failedIndices: classified.failed.map((entry) => entry.index),
        reasons: classified.failed.map((entry) => entry.reason)
      });
    }

    if (classified.verdict) {
      const { status, reason } = classified.verdict;
      const notice =
        reason === 'identical-output'
          ? 'Translation failed: output matched the source text.'
          : 'Translation failed: provider returned no translated text.';

      if (status === 'skipped') {
        console.log('[VisionTranslate Content] Nothing to translate: every block was skipped', {
          ...verdictDetail,
          reasons: classified.skipped.map((entry) => entry.reason)
        });
      } else {
        console.error(`[VisionTranslate Content] Blocking overlay render (${reason})`, verdictDetail);
        if (!isPrefetch) {
          showTranslationFailureNotice(element, notice);
        }
      }

      return endWithout(classified.verdict);
    }

    console.log('[VisionTranslate Content] Final text passed to overlay rendering', {
      ...verdictDetail,
      textCount: translationEntries.length
    });

    const speechText = overlayModule.buildSpeechText(mergedOcrResults, translations);
    throwIfJobStopped('translation-hash-cancelled');

    const imageFingerprint = await sha256Hex(stripDataUrlPrefix(imageBase64));
    throwIfJobStopped('translation-hash-cancelled');

    const translationHash = await sha256Hex(`${targetLanguage}::${speechText}`);
    throwIfJobStopped('translation-hash-cancelled');

    await syncReadAloudTranslationCache(imageFingerprint, translationHash);
    throwIfJobStopped('read-aloud-cache-sync-cancelled');

    const prepared = {
      imageBase64,
      rawOcrResults,
      mergedOcrResults,
      translations,
      outcomes: translationEntries.map((entry) => ({ status: entry.status, reason: entry.reason })),
      speechText,
      imageFingerprint,
      translationHash,
      targetLanguage
    };

    imageState.prepared = prepared;
    setImageLifecycleState(imageState, isPrefetch ? 'prefetched' : 'clicked', {
      reason: isPrefetch ? 'background-preprocess-complete' : 'click-preparation-complete'
    });

    logImageLifecycle(
      isPrefetch ? 'background preprocessing completed' : 'click-triggered translation completed',
      imageInfo,
      {
        blockCount: mergedOcrResults.length,
        usedCachedResult: false
      }
    );

    if (isPrefetch && !imageState.clicked) {
      blockOverlayRenderBecauseNoClick(imageState, 'background-preprocess-finished');
    }

    return {
      status: 'prepared',
      reason: '',
      prepared,
      translated: classified.translated.length,
      skipped: classified.skipped.length,
      failed: classified.failed.length
    };
  })()
    .catch((error) => {
      if (error instanceof JobStoppedError) {
        return cancelImageTranslationJobResult(imageState, currentJob, error.reason);
      }

      if (isLifecycleCancellationError(error) || !hasLiveExtensionContext()) {
        console.warn('[VisionTranslate] Image translation preparation cancelled:', error?.message || String(error));
        return cancelImageTranslationJobResult(imageState, currentJob, 'translation-preparation-cancelled');
      }

      console.error('[VisionTranslate] Error preparing image translation:', error);

      if (!isPrefetch) {
        const errorMessage = error?.message || String(error) || 'Unexpected error.';

        if (isConnectedElement(element)) {
          showTranslationFailureNotice(
            element,
            `Translation failed: ${errorMessage}`
          );
        }

        void safeSendMessage({
          action: 'FATAL_ERROR',
          payload: {
            errorMessage: `Failed to translate image: ${errorMessage}`
          }
        }).catch((reportError) => {
          if (!isExtensionContextInvalidated(reportError)) {
            console.warn('[VisionTranslate] Fatal error report failed:', reportError?.message || String(reportError));
          }
        });
      }

      finalizeImageTranslationJob(imageState, currentJob);
      return { status: 'failed', reason: 'unexpected-error', message: error?.message || String(error) };
    })
    .finally(() => {
      if (imageState.preparePromise === preparePromise) {
        imageState.preparePromise = null;
      }
    });

  imageState.preparePromise = preparePromise;
  return preparePromise;
}

async function renderPreparedImage(imageInfo, prepared, options = {}) {
  const imageState = ensureImageState(imageInfo);
  const renderJob = options.job || null;

  if (!imageState.clicked) {
    blockOverlayRenderBecauseNoClick(imageState, 'render-request-without-click');
    return { status: 'cancelled', reason: 'render-without-click' };
  }

  if (!prepared) {
    return { status: 'failed', reason: 'nothing-prepared' };
  }

  /* A null job is fine here: the helper tolerates it and still reports. */
  if (!isConnectedElement(imageInfo.element)) {
    return cancelImageTranslationJobResult(imageState, renderJob, 'render-target-disconnected');
  }

  if (!hasLiveExtensionContext()) {
    return cancelImageTranslationJobResult(imageState, renderJob, 'render-context-invalidated');
  }

  try {
    if (renderJob && shouldCancelImageTranslationJob(imageState, renderJob)) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-job-stale');
    }

    const existingOverlay = imageOverlays.get(imageInfo.element);
    const shouldShowTranslation = options.preserveVisibility
      ? existingOverlay?.showingTranslation !== false
      : true;

    setImageLifecycleState(imageState, 'rendering');
    logImageLifecycle('click-triggered render started', imageInfo, {
      blockCount: prepared.mergedOcrResults.length
    });

    if (renderJob && shouldCancelImageTranslationJob(imageState, renderJob)) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-module-load-cancelled');
    }

    const overlayModule = await import(chrome.runtime.getURL('overlay.js'));
    if (renderJob && shouldCancelImageTranslationJob(imageState, renderJob)) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-module-load-cancelled');
    }

    const sourceImage = await loadImage(prepared.imageBase64);
    if (renderJob && shouldCancelImageTranslationJob(imageState, renderJob)) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-image-load-cancelled');
    }

    if (!isConnectedElement(imageInfo.element)) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-target-disconnected');
    }

    const { canvas, wrapper } = createOverlay(imageInfo.element);

    setOverlayVisibility(canvas, shouldShowTranslation);
    canvas.style.transition = 'opacity 0.2s ease';

    imageOverlays.set(imageInfo.element, {
      canvas,
      wrapper,
      ocrResults: prepared.mergedOcrResults,
      rawOcrResults: prepared.rawOcrResults,
      translations: prepared.translations,
      showingTranslation: shouldShowTranslation,
      speechText: prepared.speechText,
      imageFingerprint: prepared.imageFingerprint,
      translationHash: prepared.translationHash,
      targetLanguage: prepared.targetLanguage,
      readAloud: {
        state: 'stopped',
        errorMessage: '',
        audioDataUrl: '',
        settingsSignature: '',
        audio: null
      }
    });

    const renderReport = overlayModule.renderTranslation(
      canvas,
      sourceImage,
      prepared.mergedOcrResults,
      prepared.translations,
      currentSettings
    );

    /*
     * A block whose translation cannot be laid out inside its region at
     * the minimum font size is left untouched by the renderer (the source
     * text stays visible). If that happened to every block there is no
     * overlay worth showing, so report it instead of a blank success.
     */
    if (renderReport && renderReport.rendered === 0 && renderReport.unfit > 0) {
      removeOverlayForElement(imageInfo.element);
      const message = 'Translation could not be displayed: the translated text does not fit any text region at the minimum font size.';
      showTranslationFailureNotice(imageInfo.element, message);
      finalizeImageTranslationJob(imageState, renderJob);
      return { status: 'failed', reason: 'no-fit', message };
    }

    if (renderReport?.unfit) {
      console.warn(`[VisionTranslate] ${renderReport.unfit} text block(s) were left untranslated because the translation does not fit.`);
    }

    ensureReadAloudButton(imageInfo.element);
    clearTranslationFailureNotice(imageInfo.element);

    setImageLifecycleState(imageState, 'rendered');
    logImageLifecycle('click-triggered render completed', imageInfo, {
      blockCount: prepared.mergedOcrResults.length
    });

    finalizeImageTranslationJob(imageState, renderJob);
    return { status: 'rendered', reason: '', unfit: renderReport?.unfit || 0 };
  } catch (error) {
    if (isLifecycleCancellationError(error) || !hasLiveExtensionContext() || !isConnectedElement(imageInfo.element)) {
      console.warn('[VisionTranslate] Image render cancelled:', error?.message || String(error));
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-cancelled');
    }

    console.error('[VisionTranslate] Error rendering prepared image:', error);
    if (isConnectedElement(imageInfo.element)) {
      const errorMessage = error?.message || String(error) || 'Unexpected render error.';
      showTranslationFailureNotice(
        imageInfo.element,
        `Translation failed: ${errorMessage}`
      );
    }

    finalizeImageTranslationJob(imageState, renderJob);

    return { status: 'failed', reason: 'render-failed', message: error?.message || String(error) };
  }
}

/*
 * Runs the click pipeline for one image and reports how it ended:
 *   { status: 'rendered' }                 an overlay is showing
 *   { status: 'skipped' | 'no-text', … }   nothing to translate (neutral)
 *   { status: 'failed', reason, message }  a real error
 *   { status: 'cancelled' }                deactivated / superseded / removed
 */
async function translateImageOnClick(discoveredImageInfo) {
  const imageInfo = resolveLiveImageInfo(discoveredImageInfo);
  const imageState = ensureImageState(imageInfo);

  if (!isActive) {
    return { status: 'cancelled', reason: 'inactive' };
  }

  imageState.clicked = true;
  setImageLifecycleState(imageState, 'clicked');
  clearTranslationFailureNotice(imageInfo.element);

  const existingOverlay = imageOverlays.get(imageInfo.element);
  if (existingOverlay?.translations?.length) {
    existingOverlay.showingTranslation = true;
    setOverlayVisibility(existingOverlay.canvas, true);
    ensureReadAloudButton(imageInfo.element);
    return { status: 'rendered', reason: 'existing-overlay' };
  }

  const prepareOutcome = await prepareImageForTranslation(imageInfo, { reason: 'click' });
  if (prepareOutcome.status !== 'prepared') {
    return prepareOutcome;
  }

  const renderJob =
    imageState.activeJob || startImageTranslationJob(imageState, 'render-prepared-image');
  return renderPreparedImage(imageInfo, prepareOutcome.prepared, { job: renderJob });
}

/*
 * --------------------------------------------------------------------------
 * Per-Image Translate Icons
 * --------------------------------------------------------------------------
 * When the extension is activated, we add a small translate icon to the
 * corner of each qualifying image. The user can:
 *   - Click the icon to translate just that one image
 *   - Or use "Translate This Page" to do them all at once
 *
 * The icon is a small circular button with a translate symbol (文/A) that
 * appears on hover in the top-right corner of the image.
 */

function createIconWrapper(element) {
  const wrapper = document.createElement('div');
  wrapper.className = `${CLASS_PREFIX}-icon-wrapper`;

  /*
   * Detect standalone image pages (image opened in a new tab). Browsers
   * center these with display:block + margin:auto. If we wrap with
   * inline-block, the centering is lost. Preserve it by using
   * display:block + width:fit-content + margin:auto.
   *
   * NOTE: getComputedStyle resolves 'auto' margins to pixel values, so we
   * check document.contentType and the element's inline style.
   */
  const isImageDocument = document.contentType &&
    document.contentType.startsWith('image/');
  const hasInlineAutoMargin = /margin\s*:\s*auto/i.test(element.style.cssText);
  const isCentered = isImageDocument || hasInlineAutoMargin;

  wrapper.style.cssText = isCentered
    ? `position: relative; display: block; width: fit-content; margin: auto;`
    : `position: relative; display: inline-block;`;

  element.parentNode.insertBefore(wrapper, element);
  wrapper.appendChild(element);
  return wrapper;
}

function resolveControlAnchor(element, parent) {
  if (element.tagName === 'IMG' || element.tagName === 'CANVAS') {
    if (parent.classList?.contains(`${CLASS_PREFIX}-icon-wrapper`)) {
      return parent;
    }

    const parentPosition = window.getComputedStyle(parent).position;
    const isPositioned = parentPosition && parentPosition !== 'static';
    const soleChild = parent.children?.length === 1 && parent.children[0] === element;

    if (isPositioned && soleChild) {
      return parent;
    }

    return createIconWrapper(element);
  }

  /* Background-image elements are containers themselves. */
  const position = window.getComputedStyle(element).position;
  if (position === 'static' || position === '') {
    rememberOriginalInlineStyle(element);
    element.style.position = 'relative';
  }
  return element;
}

const CONTROL_ICON_STATES = {
  idle: { label: '文A', background: 'rgba(59, 130, 246, 0.9)', title: 'Translate this image' },
  working: { label: '⟳', background: 'rgba(59, 130, 246, 0.9)', title: 'Translating…' },
  rendered: { label: '✓', background: 'rgba(34, 197, 94, 0.9)', title: 'Translated. Click to show or hide.' },
  skipped: { label: '—', background: 'rgba(100, 116, 139, 0.9)', title: 'Nothing to translate: the text is already in the target language.' },
  'no-text': { label: '—', background: 'rgba(100, 116, 139, 0.9)', title: 'Nothing to translate: no text was found in this image.' },
  failed: { label: '✗', background: 'rgba(239, 68, 68, 0.9)', title: 'Translation failed. Click to retry.' }
};

function setControlIconState(icon, state, detail = '') {
  if (!icon) return;
  const next = CONTROL_ICON_STATES[state] || CONTROL_ICON_STATES.idle;
  icon.innerHTML = next.label;
  icon.style.background = next.background;
  icon.style.animation = state === 'working' ? `${CLASS_PREFIX}-spin 1s linear infinite` : 'none';
  icon.style.opacity = '1';
  icon.title = detail ? `${next.title} ${detail}` : next.title;
  icon.dataset.vtState = state;
  if (state === 'working') {
    icon.dataset.translating = 'true';
  } else {
    delete icon.dataset.translating;
  }
}

/**
 * Add translate icons to all qualifying images on the page.
 * Called during activation to give users per-image control.
 */
function addTranslateIcons() {
  const images = scanForImages();

  for (const imageInfo of images) {
    const { element } = imageInfo;
    ensureImageState(imageInfo);

    /* Skip if icon already added */
    if (element.dataset.vtIconAdded) continue;
    element.dataset.vtIconAdded = 'true';
    logImageLifecycle('icon added', imageInfo);

    /*
     * The control is absolutely positioned inside an anchor. The anchor
     * must belong to *this* image alone:
     *
     *   - a positioned parent whose only element child is the image can
     *     serve as-is (no layout change);
     *   - otherwise the image (or canvas) gets its own inline-block
     *     wrapper. Sharing a positioned parent between several images used
     *     to put every control at the parent's top-right corner, and a
     *     <canvas> in a static parent used to receive the control as its
     *     fallback content, where it is never rendered;
     *   - a background-image element is itself the container, so it is
     *     positioned and used directly, as before.
     */
    const parent = element.parentElement;
    if (!parent) continue;

    const iconAnchor = resolveControlAnchor(element, parent);
    if (!iconAnchor) continue;

    /* Create the translate icon container */
    const iconContainer = document.createElement("div");
    iconContainer.className = `${CLASS_PREFIX}-translate-icon-container`;
    iconContainer.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483646;
      display: flex;
      flex-direction: row-reverse;
      gap: 8px;
      opacity: 1;
      transition: opacity 0.2s ease;
      pointer-events: auto;
    `;

    const icon = document.createElement("button");
    icon.className = `${CLASS_PREFIX}-translate-icon`;
    icon.title = "Translate this image";
    icon.innerHTML = "文A";
    icon.style.cssText = `
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.8);
      background: rgba(59, 130, 246, 0.9);
      color: white;
      font-size: 11px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      line-height: 1;
      padding: 0;
      transition: transform 0.15s ease;
    `;

    const translateAllBtn = document.createElement("button");
    translateAllBtn.className = `${CLASS_PREFIX}-translate-all-btn`;
    translateAllBtn.title = "Translate all images on this page";
    translateAllBtn.innerHTML = "Translate All";
    translateAllBtn.style.cssText = `
      height: 36px;
      border-radius: 18px;
      border: 2px solid rgba(255,255,255,0.8);
      background: rgba(100, 116, 139, 0.9);
      color: white;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      padding: 0 12px;
      opacity: 0;
      transform: translateX(10px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    `;

    iconContainer.appendChild(icon);
    iconContainer.appendChild(translateAllBtn);

    iconContainer.addEventListener("mouseenter", () => {
      translateAllBtn.style.opacity = "1";
      translateAllBtn.style.transform = "translateX(0)";
    });
    iconContainer.addEventListener("mouseleave", () => {
      translateAllBtn.style.opacity = "0";
      translateAllBtn.style.transform = "translateX(10px)";
    });

    translateAllBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      translateAllBtn.innerHTML = "Translating...";
      await processAllImages();
      translateAllBtn.innerHTML = "Done ✓";
      setTimeout(() => { translateAllBtn.innerHTML = "Translate All"; }, 2000);
    });

    /* Click handler: translate just this image */
    icon.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!isActive) {
        return;
      }

      /*
       * Resolve the element's *current* source: the page may have swapped
       * src/srcset since this control was created. ensureImageState()
       * discards any state and job that belonged to the previous source.
       */
      const liveInfo = resolveLiveImageInfo(imageInfo);
      const imageState = ensureImageState(liveInfo);
      const overlay = imageOverlays.get(liveInfo.element);

      if (overlay && overlay.translations && overlay.translations.length > 0) {
        imageState.clicked = true;
        setImageLifecycleState(imageState, 'clicked', { reason: 'reveal-existing-overlay' });
        overlay.showingTranslation = true;
        setOverlayVisibility(overlay.canvas, true);
        ensureReadAloudButton(liveInfo.element);
        setControlIconState(icon, 'rendered');
        return;
      }

      setControlIconState(icon, 'working');

      /*
       * Add the spin animation if not already present. The keyframes are
       * namespaced: a bare "@keyframes spin" injected into the host page
       * would override any "spin" animation the page defines for itself.
       */
      if (!document.getElementById(`${CLASS_PREFIX}-spin-style`)) {
        const style = document.createElement('style');
        style.id = `${CLASS_PREFIX}-spin-style`;
        style.textContent = `@keyframes ${CLASS_PREFIX}-spin { to { transform: rotate(360deg); } }`;
        (document.head || document.documentElement).appendChild(style);
      }

      try {
        const outcome = await scheduleImageWork(liveInfo, 'render', PRIORITY_CLICK, () =>
          translateImageOnClick(liveInfo)
        );
        applyOutcomeToControl(getTranslateControl(liveInfo.element) || { icon, element: liveInfo.element }, outcome);
      } catch (err) {
        if (isLifecycleCancellationError(err) || !hasLiveExtensionContext()) {
          console.warn('[VisionTranslate] Single image translation cancelled:', err?.message || String(err));
          resetTranslateControl(getTranslateControl(liveInfo.element));
          return;
        }

        setControlIconState(icon, 'failed');
        console.error('[VisionTranslate] Single image translation failed:', err);
      }
    });

    iconAnchor.appendChild(iconContainer);
    translateIcons.add({
      element,
      icon,
      iconContainer,
      anchor: iconAnchor,
      translateAllBtn,
      readAloudButton: null,
      failureNotice: null
    });

    ensureReadAloudButton(element);
  }
}

/* Reflects a finished job on its control. */
function applyOutcomeToControl(control, outcome) {
  const icon = control?.icon;
  if (!icon) return;

  const status = outcome?.status || 'failed';
  if (status === 'cancelled' || outcome === null || outcome === undefined) {
    /*
     * A superseded job must not wipe the result of the job that replaced
     * it. Swapping an image's src cancels the in-flight job for the old
     * source, and that cancellation can land after the new source has
     * already rendered; resetting here would blank a live translation.
     */
    if (!imageOverlays.get(control.element)?.translations?.length) {
      resetTranslateControl(getTranslateControl(control.element) || control);
    }
    return;
  }

  if (status === 'rendered') {
    setControlIconState(icon, 'rendered', outcome.unfit ? `${outcome.unfit} block(s) did not fit.` : '');
    return;
  }

  if (status === 'skipped' || status === 'no-text') {
    clearTranslationFailureNotice(control.element);
    setControlIconState(icon, status);
    return;
  }

  setControlIconState(icon, 'failed', outcome?.message || '');
}

/**
 * Remove all translate icons from the page.
 */
function removeTranslateIcons() {
  for (const { icon, iconContainer } of translateIcons) {
    if (iconContainer) iconContainer.remove(); else icon.remove();
  }
  translateIcons.clear();

  for (const img of [...pendingLoadListeners.keys()]) {
    unwatchImageLoad(img);
  }

  /* Remove data attributes */
  document.querySelectorAll(`[data-vt-icon-added]`).forEach(el => {
    delete el.dataset.vtIconAdded;
  });
}

/*
 * --------------------------------------------------------------------------
 * Core: Process all images on the page
 * --------------------------------------------------------------------------
 * Scans for images, then processes them with concurrency control. We limit
 * the number of images processed simultaneously to avoid overwhelming
 * the OCR backend and the browser.
 */
async function processAllImages(options = { mode: 'render' }) {
  const mode = options.mode || 'render';

  if (!isActive) {
    return;
  }

  /*
   * The batch belongs to the activation it started under. Deactivating
   * bumps the generation and the scheduler drops every queued entry, so
   * no image dequeues after the user turned the extension off.
   */
  const generation = activationGeneration;
  const images = scanForImages();

  if (images.length === 0) {
    console.log('[VisionTranslate] No qualifying images found on this page.');
    return;
  }

  const shouldReportProgress = mode === 'render';
  const reportProgress = (completed) => {
    if (!shouldReportProgress || generation !== activationGeneration) {
      return;
    }
    void safeSendMessage({
      action: 'UPDATE_PROGRESS',
      payload: { total: images.length, completed }
    }).catch((error) => {
      if (!isExtensionContextInvalidated(error)) {
        console.warn('[VisionTranslate] Progress update failed:', error?.message || String(error));
      }
    });
  };

  reportProgress(0);

  /*
   * Every image goes through the page-wide scheduler, which enforces the
   * parallel-image limit across this batch, individual clicks and the
   * observer-triggered prefetch together, and deduplicates an image that
   * is already queued or running.
   */
  let completedCount = 0;
  const priority = mode === 'prefetch' ? PRIORITY_PREFETCH : PRIORITY_CLICK;
  const results = await Promise.all(
    images.map((discovered) => {
      /* Key the work on the source the element carries right now. */
      const liveInfo = resolveLiveImageInfo(discovered);
      return scheduleImageWork(liveInfo, mode, priority, async () => {
        if (generation !== activationGeneration || !isActive) {
          return { status: 'cancelled', reason: 'deactivated' };
        }
        const outcome =
          mode === 'prefetch'
            ? await prepareImageForTranslation(liveInfo, { reason: 'prefetch' })
            : await translateImageOnClick(liveInfo);
        if (mode !== 'prefetch') {
          applyOutcomeToControl(getTranslateControl(liveInfo.element), outcome);
        }
        completedCount++;
        reportProgress(completedCount);
        return outcome;
      }).catch((error) => {
        if (!isLifecycleCancellationError(error)) {
          console.error('[VisionTranslate] Image job failed:', error);
        }
        return null;
      });
    })
  );

  if (generation !== activationGeneration) {
    console.log('[VisionTranslate] Batch abandoned: the page was deactivated while it ran.');
    return;
  }

  console.log(
    `[VisionTranslate] Finished ${mode === 'prefetch' ? 'background preprocessing' : 'click-triggered translation'} for ${completedCount} of ${images.length} images`,
    { outcomes: results.map((result) => result?.status || 'none') }
  );
}

/*
 * --------------------------------------------------------------------------
 * Core: Set up MutationObserver for dynamically loaded images
 * --------------------------------------------------------------------------
 * Many modern websites load images lazily (as you scroll) or dynamically
 * (after JavaScript runs). A MutationObserver watches for DOM changes
 * and lets us process new images as they appear.
 *
 * HOW MUTATIONOBSERVER WORKS:
 *   1. You create an observer with a callback function.
 *   2. You tell it what to watch (child nodes added, attributes changed).
 *   3. Whenever a matching change happens, your callback is called with
 *      a list of "mutation records" describing what changed.
 */
/*
 * Debounced discovery refresh shared by the MutationObserver and the
 * image-load listeners. Images whose src/srcset changed since the last
 * flush are accumulated in a Set (the debounce restarts on every batch, so
 * a callback-local list would only ever see the final batch), and images
 * the page removed are released before new controls are added.
 */
let discoveryDebounceTimer = null;
const imagesPendingInvalidation = new Set();
let removalsPending = false;

function scheduleDiscoveryRefresh(reason = 'mutation') {
  clearTimeout(discoveryDebounceTimer);
  discoveryDebounceTimer = setTimeout(() => {
    discoveryDebounceTimer = null;

    if (!isActive) {
      imagesPendingInvalidation.clear();
      removalsPending = false;
      return;
    }

    for (const imageElement of imagesPendingInvalidation) {
      if (isConnectedElement(imageElement)) {
        invalidateImageState(imageElement, 'img-src-updated');
      }
    }
    imagesPendingInvalidation.clear();

    if (removalsPending) {
      removalsPending = false;
      const released = releaseDisconnectedTargets();
      if (released) {
        console.log(`[VisionTranslate] Released state for ${released} removed image(s).`);
      }
    }

    console.log(`[VisionTranslate] Refreshing image discovery (${reason}).`);
    addTranslateIcons();

    if (currentSettings.prefetchTranslations) {
      processAllImages({ mode: 'prefetch' });
    }
  }, 500);
}

function cancelDiscoveryRefresh() {
  clearTimeout(discoveryDebounceTimer);
  discoveryDebounceTimer = null;
  imagesPendingInvalidation.clear();
  removalsPending = false;
}

function setupMutationObserver() {
  pageObserver = new MutationObserver((mutationsList) => {
    /*
     * Quick check: do any of the mutations involve image-related changes?
     * Mutations the extension caused itself (wrapping an image, adding a
     * control, painting an overlay) are ignored, otherwise every refresh
     * would schedule the next one forever.
     */
    let hasRelevantChanges = false;

    for (const mutation of mutationsList) {
      if (isInsideExtensionNode(mutation.target) && mutation.type !== 'childList') {
        continue;
      }

      if (mutation.type === 'childList') {
        /*
         * Removals cannot skip extension nodes the way additions do: an
         * image the extension wrapped is removed by the page *as that
         * wrapper*, so ignoring our own nodes here misses the removal of
         * every wrapped image — which is most of them. Releasing state
         * adds no nodes, so this cannot feed itself.
         */
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) {
            continue;
          }
          if (
            imageStates.has(node) ||
            node.tagName === 'IMG' ||
            node.tagName === 'CANVAS' ||
            node.querySelector?.('img, canvas')
          ) {
            removalsPending = true;
            hasRelevantChanges = true;
          }
        }

        /*
         * childList mutations mean nodes were added or removed.
         * Check if any added nodes are images or contain images.
         */
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && !isExtensionNode(node)) {
            if (
              node.tagName === 'IMG' ||
              node.tagName === 'CANVAS' ||
              node.querySelector?.('img, canvas')
            ) {
              hasRelevantChanges = true;
              break;
            }
          }
        }
      } else if (mutation.type === 'attributes') {
        if (
          mutation.target.tagName === 'IMG' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')
        ) {
          imagesPendingInvalidation.add(mutation.target);
        }

        /*
         * Attribute mutations: an image's src might have changed
         * (lazy loading often sets src from data-src). We also watch
         * style changes so background-image swaps get re-discovered.
         */
        if (
          (
            mutation.target.tagName === 'IMG' &&
            (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')
          ) ||
          (
            mutation.attributeName === 'style' &&
            (
              mutation.target.style?.backgroundImage ||
              /background-image\s*:/i.test(mutation.oldValue || '')
            ) &&
            !isExtensionNode(mutation.target)
          )
        ) {
          hasRelevantChanges = true;
        }
      }

      if (hasRelevantChanges && !removalsPending) break;
    }

    if (!hasRelevantChanges) return;

    scheduleDiscoveryRefresh('mutation');
  });

  /*
   * Start observing the entire document body. The options specify what
   * kinds of DOM changes to watch for:
   *
   * childList: true — Watch for nodes being added or removed
   * subtree: true — Watch the ENTIRE subtree, not just direct children
   * attributes: true — Watch for attribute changes (like src changing)
   * attributeFilter: [...] — Only watch these specific attributes
   *     (performance optimization to avoid firing on every attribute change)
   */
  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style'],
    attributeOldValue: true
  });

  console.log('[VisionTranslate] MutationObserver active — watching for new images');
}

/*
 * --------------------------------------------------------------------------
 * Core: Clean up all overlays and state
 * --------------------------------------------------------------------------
 * Called when deactivating. Removes all canvases, wrappers, and
 * restores the original page layout.
 */
function cleanupAll() {
  /*
   * Order matters: first make every running or queued job stale, then
   * tear the DOM down. A job that wakes up after this finds a new
   * generation and bails instead of painting into a cleaned page.
   */
  activationGeneration += 1;
  cancelDiscoveryRefresh();
  dropQueuedImageWork();
  cancelAllImageJobs('deactivated');
  stopActiveReadAloudPlayback();

  /*
   * Remove all wrapper divs and restore images to their original
   * position in the DOM.
   */
  const wrappers = document.querySelectorAll(`.${CLASS_PREFIX}-wrapper`);

  for (const wrapper of wrappers) {
    /*
     * Move child elements (the original image) back out of the wrapper,
     * then remove the wrapper.
     *
     * wrapper.parentNode.insertBefore(child, wrapper) moves the child
     * to just before the wrapper in the parent, then we remove the
     * wrapper.
     */
    const children = Array.from(wrapper.children);
    for (const child of children) {
      /* Skip our canvas overlays — they'll be removed with the wrapper */
      if (child.classList?.contains(`${CLASS_PREFIX}-canvas`)) {
        continue;
      }

      /* Move original image back to the wrapper's position */
      wrapper.parentNode.insertBefore(child, wrapper);
    }

    wrapper.remove();
  }

  /* Remove any stray canvases that might not be in wrappers */
  const canvases = document.querySelectorAll(`.${CLASS_PREFIX}-canvas`);
  for (const canvas of canvases) {
    canvas.remove();
  }

  /* Remove per-image translate icons */
  removeTranslateIcons();

  /* Also remove icon wrappers */
  const iconWrappers = document.querySelectorAll(`.${CLASS_PREFIX}-icon-wrapper`);
  for (const wrapper of iconWrappers) {
    const children = Array.from(wrapper.children);
    for (const child of children) {
      if (!child.classList?.contains(`${CLASS_PREFIX}-translate-icon`)) {
        wrapper.parentNode.insertBefore(child, wrapper);
      }
    }
    wrapper.remove();
  }

  restoreOriginalInlineStyles();

  /* Disconnect the MutationObserver */
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  imageOverlays = new WeakMap();
  imageStates = new WeakMap();

  /*
   * Note: We cannot clear WeakMap entries explicitly, but
   * since they use weak references, entries will be garbage-collected
   * when the image elements are no longer referenced.
   */

  console.log('[VisionTranslate] All overlays and state cleaned up');
}

/*
 * --------------------------------------------------------------------------
 * Core: Activate translation on the current page
 * --------------------------------------------------------------------------
 * Called when we receive an ACTIVATE message from the background script.
 */
async function activate(settings) {
  if (isActive) {
    console.log('[VisionTranslate] Already active, refreshing settings only.');
    currentSettings = settings || currentSettings || {};
    return;
  }

  isActive = true;
  activationGeneration += 1;
  currentSettings = settings || {};

  /* Every path below runs only while active, so these are ready. */
  await ensureSharedModules();

  console.log('[VisionTranslate] Activating', {
    ocrEngine: currentSettings.ocrEngine || 'tesseract',
    translationProvider: currentSettings.translationProvider || 'libre',
    sourceLanguage: currentSettings.sourceLanguage || 'auto',
    targetLanguage: currentSettings.targetLanguage || 'en'
  });

  /* Set up the MutationObserver to catch dynamically loaded images */
  setupMutationObserver();

  /*
   * Add translate icons to all qualifying images. Users can click
   * individual icons to translate specific images, or use the
   * "Translate All" button in the toolbar to do them all at once.
   */
  addTranslateIcons();

  if (currentSettings.prefetchTranslations) {
    processAllImages({ mode: 'prefetch' });
  }
}

async function translateCurrentPage(settings) {
  const nextSettings = settings || currentSettings || {};

  if (!isActive) {
    await activate(nextSettings);
  } else {
    currentSettings = nextSettings;
    addTranslateIcons();
  }

  await processAllImages({ mode: 'render' });
}

/*
 * --------------------------------------------------------------------------
 * Core: Deactivate translation on the current page
 * --------------------------------------------------------------------------
 * Called when we receive a DEACTIVATE message from the background script.
 */
function deactivate() {
  if (!isActive) {
    console.log('[VisionTranslate] Already inactive, ignoring duplicate deactivation');
    return;
  }

  isActive = false;
  currentSettings = {};
  cleanupAll();

  console.log('[VisionTranslate] Deactivated');
}

/*
 * ==========================================================================
 * MESSAGE LISTENER
 * ==========================================================================
 * Listen for messages from the background script. This is how the
 * background script tells us to activate, deactivate, or update.
 *
 * Just like in background.js, we return `true` from the listener to
 * keep the message channel open for async responses.
 * ==========================================================================
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  console.log(`[VisionTranslate Content] Message received: ${action}`);

  switch (action) {
    /*
     * ACTIVATE: Start scanning and translating images on this page.
     * The payload contains the current settings (target language, etc.)
     */
    case 'ACTIVATE': {
      /*
       * The payload may carry settings directly or nested under
       * payload.settings.
       */
      const settings = payload?.settings || message.settings || payload;
      activate(settings)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          /*
           * Without this the promise rejection left sendResponse uncalled,
           * the background saw a closed port, and the tab was recorded as
           * not activated with no indication of why.
           */
          console.error('[VisionTranslate] Activation failed:', error);
          sendResponse({ success: false, error: error?.message || String(error) });
        });
      /* Return true because activate() is async */
      return true;
    }

    case 'TRANSLATE_ALL_IMAGES': {
      translateCurrentPage(currentSettings)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error('[VisionTranslate] TRANSLATE_ALL_IMAGES failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    /*
     * DEACTIVATE: Stop translation and clean up all overlays.
     */
    case 'DEACTIVATE': {
      deactivate();
      sendResponse({ success: true });
      break;
    }

    /*
     * SETTINGS_UPDATED: The user changed settings in the popup.
     * Update our local copy without silently rendering overlays.
     */
    case 'SETTINGS_UPDATED': {
      (async () => {
        const previousSettings = currentSettings || {};
        currentSettings = payload?.settings || currentSettings;

        const visualSettingsChanged =
          previousSettings.overlayFontFamily !== currentSettings.overlayFontFamily ||
          previousSettings.overlayMinFontSize !== currentSettings.overlayMinFontSize ||
          previousSettings.overlayTextAlign !== currentSettings.overlayTextAlign ||
          previousSettings.showConfidenceBorders !== currentSettings.showConfidenceBorders;

        const overlayOpacityChanged =
          previousSettings.overlayOpacity !== currentSettings.overlayOpacity;

        const discoverySettingsChanged =
          previousSettings.minImageWidth !== currentSettings.minImageWidth ||
          previousSettings.minImageHeight !== currentSettings.minImageHeight;

        const readAloudSettingsChanged =
          previousSettings.enableReadAloud !== currentSettings.enableReadAloud ||
          previousSettings.elevenLabsVoiceId !== currentSettings.elevenLabsVoiceId ||
          previousSettings.elevenLabsModelId !== currentSettings.elevenLabsModelId ||
          previousSettings.elevenLabsOutputFormat !== currentSettings.elevenLabsOutputFormat ||
          previousSettings.elevenLabsStability !== currentSettings.elevenLabsStability ||
          previousSettings.elevenLabsSimilarityBoost !== currentSettings.elevenLabsSimilarityBoost ||
          previousSettings.elevenLabsStyle !== currentSettings.elevenLabsStyle ||
          previousSettings.elevenLabsSpeed !== currentSettings.elevenLabsSpeed;

        const translationSettingsChanged =
          getTranslationSettingsSignature(previousSettings) !==
          getTranslationSettingsSignature(currentSettings);

        if (translationSettingsChanged) {
          for (const control of translateIcons) {
            invalidateImageState(control.element, 'translation-settings-changed');
          }
        }

        if (visualSettingsChanged && !translationSettingsChanged) {
          const rerenderTasks = [];

          for (const control of translateIcons) {
            const imageState = getImageState(control.element);
            if (imageState?.clicked && imageState?.prepared) {
              rerenderTasks.push(
                renderPreparedImage(imageState.imageInfo, imageState.prepared, {
                  preserveVisibility: true
                })
              );
            }
          }

          await Promise.all(rerenderTasks);
        }

        if (overlayOpacityChanged) {
          for (const control of translateIcons) {
            const overlay = imageOverlays.get(control.element);
            if (overlay) {
              setOverlayVisibility(overlay.canvas, overlay.showingTranslation);
            }
          }
        }

        if (discoverySettingsChanged) {
          addTranslateIcons();
        }

        if (readAloudSettingsChanged) {
          stopActiveReadAloudPlayback();
          refreshReadAloudButtons();
        }

        if (currentSettings.prefetchTranslations) {
          processAllImages({ mode: 'prefetch' });
        }

        sendResponse({ success: true });
      })().catch((error) => {
        console.error('[VisionTranslate] SETTINGS_UPDATED refresh failed:', error);
        sendResponse({ success: false, error: error.message });
      });

      return true;
    }

    default: {
      console.warn(`[VisionTranslate Content] Unknown action: ${action}`);
      sendResponse({ error: `Unknown action: ${action}` });
    }
  }

  /* For synchronous responses, we don't need to return true */
  return false;
});

/*
 * --------------------------------------------------------------------------
 * Initialization
 * --------------------------------------------------------------------------
 * When the content script first loads, we just log that we're ready.
 * We don't scan for images until the user activates the extension.
 * This keeps the content script lightweight on pages where the user
 * doesn't need translation.
 */
console.log('[VisionTranslate] Content script loaded and ready. Waiting for activation.');
