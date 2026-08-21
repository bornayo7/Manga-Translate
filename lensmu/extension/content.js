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

let imageProcessIds = new WeakMap();

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
 *   lastJobResult: 'idle' | 'running' | 'prepared' | 'rendered' | 'failed' | 'cancelled' | 'skipped',
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

/* Reference to the toolbar shadow DOM container */
let toolbarContainer = null;

/*
 * Set of translate-icon buttons we've added to images, so we can
 * remove them on deactivate.
 */
const translateIcons = new Set();
let activeReadAloudSession = null;

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

function previewText(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function normalizeForComparison(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isEffectivelyIdenticalTranslation(sourceText, translatedText) {
  return normalizeForComparison(sourceText) === normalizeForComparison(translatedText);
}

function languagesClearlyDiffer(sourceLang, targetLang) {
  const normalizedSource = normalizeForComparison(sourceLang);
  const normalizedTarget = normalizeForComparison(targetLang);

  if (!normalizedSource || !normalizedTarget || normalizedSource === 'auto') {
    return false;
  }

  return normalizedSource !== normalizedTarget;
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

function stopActiveReadAloudPlayback() {
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

  stopActiveReadAloudPlayback();
  updateOverlayReadAloudState(imageElement, 'generating');

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

    if (!currentSettings.enableReadAloud || imageOverlays.get(imageElement) !== overlay) {
      updateOverlayReadAloudState(imageElement, 'stopped');
      return;
    }

    if (!audioDataUrl) {
      throw new Error('No audio was returned for this translation.');
    }

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
     * Draw the image onto our temporary canvas. This copies the pixel
     * data. If the image is from a different origin and the server
     * didn't set appropriate CORS headers, this will "taint" the canvas,
     * and toDataURL() below will throw a SecurityError.
     */
    ctx.drawImage(imageElement, 0, 0, width, height);

    /*
     * Export as PNG data URL. PNG is lossless so we don't degrade the
     * image quality. The result is a string like:
     * "data:image/png;base64,iVBORw0KGgo..."
     *
     * For very large images, we use JPEG with 0.85 quality to reduce
     * the payload size sent to the OCR backend.
     */
    if (width * height > 2000000) {
      /* Images over 2 megapixels: use JPEG to save bandwidth */
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

async function fetchImageViaBackground(url) {
  if (!url) return null;

  try {
    const fetchResponse = await safeSendMessage({
      action: 'FETCH_IMAGE',
      payload: { url }
    });

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

function getTranslationSettingsSignature(settings = currentSettings) {
  return JSON.stringify({
    ocrEngine: settings?.ocrEngine || 'tesseract',
    translationProvider: settings?.translationProvider || 'libre',
    sourceLanguage: settings?.sourceLanguage || 'auto',
    targetLanguage: settings?.targetLanguage || 'en',
    backendUrl: settings?.backendUrl || '',
    googleCloudApiKey: Boolean(settings?.googleCloudApiKey),
    customOcrUrl: settings?.customOcrUrl || '',
    customOcrApiKey: Boolean(settings?.customOcrApiKey),
    openaiApiKey: Boolean(settings?.openaiApiKey),
    claudeApiKey: Boolean(settings?.claudeApiKey),
    geminiApiKey: Boolean(settings?.geminiApiKey),
    customApiKey: Boolean(settings?.customApiKey),
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
  control.icon.innerHTML = '文A';
  control.icon.style.background = 'rgba(59, 130, 246, 0.9)';
  control.icon.style.animation = 'none';
  control.icon.style.opacity = '1';
  delete control.icon.dataset.translating;
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
    lastJobResult: 'idle',
    prepared: null,
    preparePromise: null
  };
}

function cancelImageTranslationJob(imageState, reason = 'translation-cancelled') {
  const activeJob = imageState?.activeJob;
  const element = imageState?.imageInfo?.element;

  if (!activeJob) {
    return;
  }

  if (!activeJob.controller.signal.aborted) {
    activeJob.controller.abort(reason);
  }

  if (element && imageProcessIds.get(element) === activeJob.id) {
    imageProcessIds.delete(element);
  }

  if (imageState.activeJob === activeJob) {
    imageState.activeJob = null;

    if (imageState.lastJobResult === 'running') {
      imageState.lastJobResult = 'cancelled';
    }
  }
}

function startImageTranslationJob(imageState, reason = 'translation-started') {
  cancelImageTranslationJob(imageState, reason);

  const job = {
    id: `${Date.now()}-${Math.random()}`,
    controller: new AbortController(),
    reason
  };

  imageState.activeJob = job;
  imageState.lastJobResult = 'running';

  if (imageState.imageInfo?.element) {
    imageProcessIds.set(imageState.imageInfo.element, job.id);
  }

  return job;
}

function isCurrentImageTranslationJob(imageState, job) {
  const element = imageState?.imageInfo?.element;

  return Boolean(
    job &&
    element &&
    imageState.activeJob === job &&
    imageProcessIds.get(element) === job.id &&
    !job.controller.signal.aborted
  );
}

function cancelImageTranslationJobResult(imageState, job, reason = 'translation-cancelled') {
  if (job && !job.controller.signal.aborted) {
    job.controller.abort(reason);
  }

  if (imageState) {
    imageState.lastJobResult = 'cancelled';
  }

  if (imageState?.activeJob === job) {
    const element = imageState.imageInfo?.element;

    if (element && imageProcessIds.get(element) === job.id) {
      imageProcessIds.delete(element);
    }

    imageState.activeJob = null;
    imageState.lastJobResult = 'cancelled';
  }

  return null;
}

function finalizeImageTranslationJob(imageState, job, result) {
  if (!isCurrentImageTranslationJob(imageState, job)) {
    return;
  }

  const element = imageState.imageInfo?.element;

  if (element) {
    imageProcessIds.delete(element);
  }

  imageState.activeJob = null;
  imageState.lastJobResult = result;
}

function shouldCancelImageTranslationJob(imageState, job) {
  return (
    !hasLiveExtensionContext() ||
    !isConnectedElement(imageState?.imageInfo?.element) ||
    !isCurrentImageTranslationJob(imageState, job)
  );
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
  } else {
    imageProcessIds.delete(imageElement);
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
  imageState.lastJobResult = 'idle';
  setImageLifecycleState(imageState, 'icon-ready', { reason });
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
     * are 0 for unloaded images or broken image links.
     */
    if (!img.naturalWidth || !img.naturalHeight) {
      continue;
    }

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
async function prepareImageForTranslation(imageInfo, options = { reason: 'click' }) {
  const { element, type, url } = imageInfo;
  const imageState = ensureImageState(imageInfo);
  const isPrefetch = options.reason === 'prefetch';
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

    imageState.lastJobResult = 'prepared';
    return imageState.prepared;
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
    const createFailureResult = (result = 'failed') => {
      finalizeImageTranslationJob(imageState, currentJob, result);
      return null;
    };
    const bailIfJobStopped = (reason) => {
      if (shouldCancelImageTranslationJob(imageState, currentJob)) {
        return cancelImageTranslationJobResult(imageState, currentJob, reason);
      }

      return undefined;
    };

    currentJob = startImageTranslationJob(
      imageState,
      isPrefetch ? 'background-preprocess-started' : 'click-translation-started'
    );

    if (bailIfJobStopped('translation-start-cancelled') === null) {
      return null;
    }

    if (type === 'canvas') {
      try {
        imageBase64 = element.toDataURL('image/png');
      } catch (e) {
        console.warn('[VisionTranslate] Cannot export canvas (tainted):', e.message);
        return createFailureResult();
      }
    } else if (prefersBackgroundFetch) {
      if (bailIfJobStopped('background-fetch-cancelled') === null) {
        return null;
      }
      imageBase64 = await fetchImageViaBackground(url);
      if (bailIfJobStopped('background-fetch-cancelled') === null) {
        return null;
      }
    } else if (type === 'background') {
      try {
        if (bailIfJobStopped('background-image-load-cancelled') === null) {
          return null;
        }
        const loadedImg = await loadImage(url);
        if (bailIfJobStopped('background-image-load-cancelled') === null) {
          return null;
        }
        imageBase64 = imageToBase64(loadedImg);
      } catch (e) {
        console.warn('[VisionTranslate] Could not load background image via CORS, trying background fetch:', url?.substring(0, 80));
      }
    } else {
      imageBase64 = imageToBase64(element);
    }

    if (!imageBase64 && url) {
      if (bailIfJobStopped('fallback-background-fetch-cancelled') === null) {
        return null;
      }
      imageBase64 = await fetchImageViaBackground(url);
      if (bailIfJobStopped('fallback-background-fetch-cancelled') === null) {
        return null;
      }
    }

    if (!imageBase64) {
      console.warn('[VisionTranslate] Failed to convert image to base64. Skipping.');
      return createFailureResult();
    }

    if (bailIfJobStopped('ocr-request-cancelled') === null) {
      return null;
    }

    const ocrResponse = await safeSendMessage({
      action: 'OCR_REQUEST',
      payload: {
        imageBase64,
        sourceLang: settingsSnapshot.sourceLanguage || 'auto',
        settings: settingsSnapshot
      }
    });

    if (bailIfJobStopped('ocr-response-stale') === null) {
      return null;
    }

    if (!ocrResponse || !ocrResponse.ok) {
      console.warn('[VisionTranslate] OCR request failed:', ocrResponse?.body?.error || 'Unknown error');
      if (!isPrefetch) {
        showTranslationFailureNotice(
          element,
          `Translation failed: ${ocrResponse?.body?.error || 'OCR request failed.'}`
        );
      }
      return createFailureResult();
    }

    let rawOcrResults = ocrResponse.body?.blocks || [];
    if (ocrResponse.body?.useClientOCR) {
      const sourceLang = ocrResponse.body?.source_lang || settingsSnapshot.sourceLanguage || 'auto';
      console.log('[VisionTranslate] Running bundled Tesseract OCR in content script.');
      try {
        if (bailIfJobStopped('client-ocr-cancelled') === null) {
          return null;
        }
        rawOcrResults = await runBundledTesseractOCR(imageBase64, sourceLang);
        if (bailIfJobStopped('client-ocr-cancelled') === null) {
          return null;
        }
      } catch (tessError) {
        console.warn('[VisionTranslate] Bundled Tesseract.js OCR failed:', tessError.message);
        if (!isPrefetch) {
          showTranslationFailureNotice(element, `Translation failed: ${tessError.message}`);
        }
        return createFailureResult();
      }
    }

    if (rawOcrResults.length === 0) {
      console.log('[VisionTranslate] No text found in image. Skipping.');
      return createFailureResult('skipped');
    }

    console.log(`[VisionTranslate] OCR found ${rawOcrResults.length} raw text boxes`);

    const ocrSourceLanguage = ocrResponse.body?.source_lang || settingsSnapshot.sourceLanguage || 'auto';
    console.log('[VisionTranslate Content] OCR text detected', {
      sourceLang: ocrSourceLanguage,
      blocks: rawOcrResults.map((block, index) => ({
        index,
        text: previewText(block.text),
        bbox: block.bbox
      }))
    });

    if (bailIfJobStopped('overlay-module-load-cancelled') === null) {
      return null;
    }

    const overlayModule = await import(chrome.runtime.getURL('overlay.js'));
    if (bailIfJobStopped('overlay-module-load-cancelled') === null) {
      return null;
    }

    const mergedOcrResults = overlayModule.groupTextBlocks(rawOcrResults);

    if (mergedOcrResults.length === 0) {
      console.log('[VisionTranslate] OCR merge step produced no renderable text blocks. Skipping.');
      return createFailureResult('skipped');
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
      texts: textsToTranslate.map((text, index) => ({
        index,
        sourcePreview: previewText(text)
      }))
    });

    if (bailIfJobStopped('translation-request-cancelled') === null) {
      return null;
    }

    const translateResponse = await safeSendMessage({
      action: 'TRANSLATE_REQUEST',
      payload: {
        texts: textsToTranslate,
        sourceLang: ocrSourceLanguage,
        targetLang: requestedTargetLanguage,
        settings: settingsSnapshot
      }
    });

    if (bailIfJobStopped('translation-response-stale') === null) {
      return null;
    }

    console.log('[VisionTranslate Content] Raw translation response', {
      ok: Boolean(translateResponse?.ok),
      providerRequested: settingsSnapshot.translationProvider || 'libre',
      sourceLang: translateResponse?.body?.source_lang || ocrSourceLanguage,
      targetLang: translateResponse?.body?.target_lang || requestedTargetLanguage,
      providerUsed: translateResponse?.body?.provider || null,
      fallbackUsed: Boolean(translateResponse?.body?.fallback_used),
      diagnostics: translateResponse?.body?.diagnostics || null,
      translations: (translateResponse?.body?.translations || []).map((text, index) => ({
        index,
        text: previewText(text)
      })),
      error: translateResponse?.body?.error || null
    });

    if (!translateResponse || !translateResponse.ok) {
      const failureMessage = translateResponse?.body?.error || 'Unknown translation error.';
      console.warn('[VisionTranslate] Translation request failed:', failureMessage);
      if (!isPrefetch) {
        showTranslationFailureNotice(element, `Translation failed: ${failureMessage}`);
      }
      return createFailureResult();
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
      return createFailureResult();
    }

    const translationEntries = mergedOcrResults.map((block, index) => {
      const translation = String(translations[index] || '').trim();
      return {
        index,
        sourceText: block.text,
        translation,
        identical: isEffectivelyIdenticalTranslation(block.text, translation)
      };
    });

    const allTranslationsEmpty = translationEntries.every((entry) => entry.translation.length === 0);
    const allTranslationsMatchSource =
      translationEntries.length > 0 &&
      translationEntries.every((entry) => entry.translation.length > 0 && entry.identical);

    if (allTranslationsEmpty) {
      console.error('[VisionTranslate Content] Blocking overlay render because provider returned no translated text', {
        sourceLang: translatedSourceLanguage,
        targetLang: targetLanguage,
        providerRequested: settingsSnapshot.translationProvider || 'libre',
        providerUsed: translateResponse.body?.provider || null,
        diagnostics: translateResponse.body?.diagnostics || null
      });
      if (!isPrefetch) {
        showTranslationFailureNotice(element, 'Translation failed: provider returned no translated text.');
      }
      return createFailureResult();
    }

    if (languagesClearlyDiffer(translatedSourceLanguage, targetLanguage) && allTranslationsMatchSource) {
      console.error('[VisionTranslate Content] Blocking overlay render because every translation matches the source text', {
        sourceLang: translatedSourceLanguage,
        targetLang: targetLanguage,
        providerRequested: settingsSnapshot.translationProvider || 'libre',
        providerUsed: translateResponse.body?.provider || null,
        fallbackUsed: Boolean(translateResponse.body?.fallback_used),
        diagnostics: translateResponse.body?.diagnostics || null,
        translations: translationEntries.map((entry) => ({
          index: entry.index,
          sourcePreview: previewText(entry.sourceText),
          translationPreview: previewText(entry.translation)
        }))
      });
      if (!isPrefetch) {
        showTranslationFailureNotice(element, 'Translation failed: output matched the source text.');
      }
      return createFailureResult();
    }

    console.log('[VisionTranslate Content] Final text passed to overlay rendering', {
      sourceLang: translatedSourceLanguage,
      targetLang: targetLanguage,
      providerRequested: settingsSnapshot.translationProvider || 'libre',
      providerUsed: translateResponse.body?.provider || null,
      fallbackUsed: Boolean(translateResponse.body?.fallback_used),
      diagnostics: translateResponse.body?.diagnostics || null,
      texts: translationEntries.map((entry) => ({
        index: entry.index,
        sourcePreview: previewText(entry.sourceText),
        translationPreview: previewText(entry.translation),
        identicalToSource: entry.identical
      }))
    });

    const speechText = overlayModule.buildSpeechText(mergedOcrResults, translations);
    if (bailIfJobStopped('translation-hash-cancelled') === null) {
      return null;
    }

    const imageFingerprint = await sha256Hex(stripDataUrlPrefix(imageBase64));
    if (bailIfJobStopped('translation-hash-cancelled') === null) {
      return null;
    }

    const translationHash = await sha256Hex(`${targetLanguage}::${speechText}`);
    if (bailIfJobStopped('translation-hash-cancelled') === null) {
      return null;
    }

    await syncReadAloudTranslationCache(imageFingerprint, translationHash);
    if (bailIfJobStopped('read-aloud-cache-sync-cancelled') === null) {
      return null;
    }

    const prepared = {
      imageBase64,
      rawOcrResults,
      mergedOcrResults,
      translations,
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

    if (isCurrentImageTranslationJob(imageState, currentJob)) {
      imageState.lastJobResult = 'prepared';
    }

    if (isPrefetch && !imageState.clicked) {
      blockOverlayRenderBecauseNoClick(imageState, 'background-preprocess-finished');
    }

    return prepared;
  })()
    .catch((error) => {
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

      finalizeImageTranslationJob(imageState, currentJob, 'failed');
      return null;
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
    return false;
  }

  if (!prepared) {
    return false;
  }

  if (!isConnectedElement(imageInfo.element)) {
    if (renderJob) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-target-disconnected');
    }

    imageState.lastJobResult = 'cancelled';
    return null;
  }

  if (!hasLiveExtensionContext()) {
    if (renderJob) {
      return cancelImageTranslationJobResult(imageState, renderJob, 'render-context-invalidated');
    }

    imageState.lastJobResult = 'cancelled';
    return null;
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
      if (renderJob) {
        return cancelImageTranslationJobResult(imageState, renderJob, 'render-target-disconnected');
      }

      imageState.lastJobResult = 'cancelled';
      return null;
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

    overlayModule.renderTranslation(
      canvas,
      sourceImage,
      prepared.mergedOcrResults,
      prepared.translations,
      currentSettings
    );
    ensureReadAloudButton(imageInfo.element);
    clearTranslationFailureNotice(imageInfo.element);

    setImageLifecycleState(imageState, 'rendered');
    logImageLifecycle('click-triggered render completed', imageInfo, {
      blockCount: prepared.mergedOcrResults.length
    });

    if (renderJob) {
      finalizeImageTranslationJob(imageState, renderJob, 'rendered');
    } else {
      imageState.lastJobResult = 'rendered';
    }

    return true;
  } catch (error) {
    if (isLifecycleCancellationError(error) || !hasLiveExtensionContext() || !isConnectedElement(imageInfo.element)) {
      console.warn('[VisionTranslate] Image render cancelled:', error?.message || String(error));
      if (renderJob) {
        return cancelImageTranslationJobResult(imageState, renderJob, 'render-cancelled');
      }

      imageState.lastJobResult = 'cancelled';
      return null;
    }

    console.error('[VisionTranslate] Error rendering prepared image:', error);
    if (isConnectedElement(imageInfo.element)) {
      const errorMessage = error?.message || String(error) || 'Unexpected render error.';
      showTranslationFailureNotice(
        imageInfo.element,
        `Translation failed: ${errorMessage}`
      );
    }

    if (renderJob) {
      finalizeImageTranslationJob(imageState, renderJob, 'failed');
    } else {
      imageState.lastJobResult = 'failed';
    }

    return false;
  }
}

async function translateImageOnClick(imageInfo) {
  const imageState = ensureImageState(imageInfo);
  imageState.clicked = true;
  setImageLifecycleState(imageState, 'clicked');
  clearTranslationFailureNotice(imageInfo.element);

  const existingOverlay = imageOverlays.get(imageInfo.element);
  if (existingOverlay?.translations?.length) {
    existingOverlay.showingTranslation = true;
    setOverlayVisibility(existingOverlay.canvas, true);
    ensureReadAloudButton(imageInfo.element);
    return true;
  }

  const prepared = await prepareImageForTranslation(imageInfo, { reason: 'click' });
  if (!prepared) {
    return imageState.lastJobResult === 'cancelled' ? null : false;
  }

  const renderJob =
    imageState.activeJob || startImageTranslationJob(imageState, 'render-prepared-image');
  const didRender = await renderPreparedImage(imageInfo, prepared, { job: renderJob });

  if (!didRender) {
    return imageState.lastJobResult === 'cancelled' ? null : false;
  }

  return true;
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
     * We need the image's parent to be position:relative so we can
     * absolutely position the icon. Check if it already is.
     */
    const parent = element.parentElement;
    if (!parent) continue;

    const parentPosition = window.getComputedStyle(parent).position;

    /* Create a wrapper if the parent isn't already positioned */
    let iconAnchor;
    if (parentPosition === 'static' || parentPosition === '') {
      /* For <img> elements, wrap them in a positioned div */
      if (element.tagName === 'IMG') {
        const wrapper = document.createElement('div');
        wrapper.className = `${CLASS_PREFIX}-icon-wrapper`;

        /*
         * Detect standalone image pages (image opened in a new tab).
         * Browsers center these with display:block + margin:auto. If we
         * wrap with inline-block, the centering is lost. Preserve it by
         * using display:block + width:fit-content + margin:auto.
         *
         * NOTE: getComputedStyle resolves 'auto' margins to pixel values,
         * so we check document.contentType and the element's inline style.
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
        iconAnchor = wrapper;
      } else {
        /* For other elements (background, canvas), set position on the element itself */
        element.style.position = 'relative';
        iconAnchor = element;
      }
    } else {
      iconAnchor = parent;
    }

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

    /* Show icon on hover over the image area */
    const showIcon = () => { /* iconContainer is always visible */ };
    const hideIcon = () => { /* iconContainer is always visible */ };

    /* Click handler: translate just this image */
    icon.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const imageState = ensureImageState(imageInfo);
      const overlay = imageOverlays.get(imageInfo.element);

      if (overlay && overlay.translations && overlay.translations.length > 0) {
        imageState.clicked = true;
        setImageLifecycleState(imageState, 'clicked', { reason: 'reveal-existing-overlay' });
        overlay.showingTranslation = true;
        setOverlayVisibility(overlay.canvas, true);
        ensureReadAloudButton(imageInfo.element);

        icon.innerHTML = "✓";
        icon.style.background = "rgba(34, 197, 94, 0.9)";
        return;
      }

      icon.dataset.translating = 'true';
      icon.innerHTML = '⟳';
      icon.style.opacity = '1';
      icon.style.animation = 'spin 1s linear infinite';

      /* Add spin animation if not already present */
      if (!document.getElementById(`${CLASS_PREFIX}-spin-style`)) {
        const style = document.createElement('style');
        style.id = `${CLASS_PREFIX}-spin-style`;
        style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
      }

      try {
        const translationResult = await translateImageOnClick(imageInfo);
        if (translationResult) {
          icon.innerHTML = '✓';
          icon.style.background = 'rgba(34, 197, 94, 0.9)';
        } else if (translationResult === null) {
          resetTranslateControl(getTranslateControl(imageInfo.element));
        } else {
          icon.innerHTML = '✗';
          icon.style.background = 'rgba(239, 68, 68, 0.9)';
        }
        icon.style.animation = 'none';
      } catch (err) {
        if (isLifecycleCancellationError(err) || !hasLiveExtensionContext()) {
          console.warn('[VisionTranslate] Single image translation cancelled:', err?.message || String(err));
          resetTranslateControl(getTranslateControl(imageInfo.element));
          return;
        }

        /* Show error state */
        icon.innerHTML = '✗';
        icon.style.background = 'rgba(239, 68, 68, 0.9)';
        icon.style.animation = 'none';
        console.error('[VisionTranslate] Single image translation failed:', err);
      }

      delete icon.dataset.translating;
    });

    iconAnchor.appendChild(iconContainer);
    translateIcons.add({
      element,
      icon,
      iconContainer,
      anchor: iconAnchor,
      showIcon,
      hideIcon,
      translateAllBtn,
      readAloudButton: null,
      failureNotice: null
    });

    ensureReadAloudButton(element);
  }
}

/**
 * Remove all translate icons from the page.
 */
function removeTranslateIcons() {
  for (const { icon, iconContainer, anchor, showIcon, hideIcon } of translateIcons) {
    anchor.removeEventListener('mouseenter', showIcon);
    anchor.removeEventListener('mouseleave', hideIcon);
    if (iconContainer) iconContainer.remove(); else icon.remove();
  }
  translateIcons.clear();

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
  const images = scanForImages();

  if (images.length === 0) {
    console.log('[VisionTranslate] No qualifying images found on this page.');
    return;
  }

  const shouldReportProgress = mode === 'render';

  if (shouldReportProgress) {
    void safeSendMessage({
      action: 'UPDATE_PROGRESS',
      payload: { total: images.length, completed: 0 }
    }).catch((error) => {
      if (!isExtensionContextInvalidated(error)) {
        console.warn('[VisionTranslate] Progress update failed:', error?.message || String(error));
      }
    });
  }

  /*
   * Process images with concurrency control. We use a simple "pool"
   * pattern: start up to MAX_CONCURRENT_IMAGES tasks, and as each
   * finishes, start the next one.
   *
   * This is like a queue: we keep N workers busy at all times until
   * the queue is empty.
   */
  let completedCount = 0;
  let nextIndex = 0;

  async function processNext() {
    while (nextIndex < images.length) {
      const currentIndex = nextIndex;
      nextIndex++;

      const imageInfo = images[currentIndex];

      if (mode === 'prefetch') {
        await prepareImageForTranslation(imageInfo, { reason: 'prefetch' });
      } else {
        await translateImageOnClick(imageInfo);
      }

      completedCount++;

      if (shouldReportProgress) {
        void safeSendMessage({
          action: 'UPDATE_PROGRESS',
          payload: { total: images.length, completed: completedCount }
        }).catch((error) => {
          if (!isExtensionContextInvalidated(error)) {
            console.warn('[VisionTranslate] Progress update failed:', error?.message || String(error));
          }
        });
      }
    }
  }

  /*
   * Start MAX_CONCURRENT_IMAGES "workers" running in parallel.
   * Each worker calls processNext(), which grabs the next image from
   * the shared queue (nextIndex) and processes it. When the queue is
   * empty, the worker returns.
   *
   * Promise.all waits for all workers to finish.
   */
  const workers = [];
  const workerCount = Math.min(getMaxConcurrentImages(), images.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(processNext());
  }

  await Promise.all(workers);

  console.log(
    `[VisionTranslate] Finished ${mode === 'prefetch' ? 'background preprocessing' : 'click-triggered translation'} for ${completedCount} images`
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
function setupMutationObserver() {
  /*
   * Debounce timer. When many mutations happen rapidly (e.g., a
   * framework re-rendering a large list), we don't want to scan for
   * images on every single mutation. Instead, we wait for mutations
   * to stop for 500ms, then scan once.
   */
  let debounceTimer = null;

  pageObserver = new MutationObserver((mutationsList) => {
    /*
     * Quick check: do any of the mutations involve image-related changes?
     * If not, skip the debounced scan entirely.
     */
    let hasRelevantChanges = false;

    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        /*
         * childList mutations mean nodes were added or removed.
         * Check if any added nodes are images or contain images.
         */
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
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
            !mutation.target.classList?.contains(`${CLASS_PREFIX}-wrapper`) &&
            !mutation.target.classList?.contains(`${CLASS_PREFIX}-icon-wrapper`) &&
            !mutation.target.classList?.contains(`${CLASS_PREFIX}-canvas`)
          )
        ) {
          hasRelevantChanges = true;
        }
      }

      if (hasRelevantChanges) break;
    }

    if (!hasRelevantChanges) return;

    /*
     * Debounce: clear any pending timer and set a new one. The scan
     * will only happen after 500ms of no new relevant mutations.
     */
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!isActive) {
        return;
      }

      for (const mutation of mutationsList) {
        if (
          mutation.type === 'attributes' &&
          mutation.target?.tagName === 'IMG' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')
        ) {
          invalidateImageState(mutation.target, 'img-src-updated');
        }
      }

      console.log('[VisionTranslate] New or updated images detected. Refreshing discovery only.');
      addTranslateIcons();

      if (currentSettings.prefetchTranslations) {
        processAllImages({ mode: 'prefetch' });
      }
    }, 500);
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
    attributeFilter: ['src', 'srcset', 'style']
  });

  console.log('[VisionTranslate] MutationObserver active — watching for new images');
}

/*
 * --------------------------------------------------------------------------
 * UI: Create the floating toolbar (in Shadow DOM)
 * --------------------------------------------------------------------------
 * The toolbar gives the user controls to:
 *   - Toggle translations on/off
 *   - See translation progress
 *   - Quick-toggle individual images
 *
 * We use Shadow DOM so our CSS is completely isolated from the page.
 *
 * SHADOW DOM EXPLAINER:
 * Shadow DOM creates an encapsulated DOM subtree. The page's CSS
 * cannot style elements inside the shadow, and our CSS cannot leak
 * out to the page. This is crucial because every website has different
 * CSS that would break our toolbar layout.
 *
 * Structure:
 *   <div id="vt-lensmu-toolbar-host">   (in the page DOM)
 *     #shadow-root                       (shadow boundary)
 *       <style>...</style>               (our isolated CSS)
 *       <div class="toolbar">            (our toolbar HTML)
 *         ...
 *       </div>
 */
function createToolbar() { /* Toolbar removed */ }

/*
 * --------------------------------------------------------------------------
 * UI: Update toolbar status text
 * --------------------------------------------------------------------------
 */
function updateToolbarStatus(text) { /* Toolbar removed */ }

/*
 * --------------------------------------------------------------------------
 * Core: Toggle all overlays visibility
 * --------------------------------------------------------------------------
 * Shows or hides all canvas overlays on the page. When hidden, the
 * original images are visible. When shown, the translated text is visible.
 *
 * We do this by toggling the canvas element's display style. We also
 * call the overlay module's restore/render functions if available.
 */
function toggleAllOverlays() {
  const canvases = document.querySelectorAll(`.${CLASS_PREFIX}-canvas`);

  for (const canvas of canvases) {
    if (canvas.style.display === 'none') {
      canvas.style.display = 'block';
    } else {
      canvas.style.display = 'none';
    }
  }
}

/*
 * --------------------------------------------------------------------------
 * Core: Clean up all overlays and state
 * --------------------------------------------------------------------------
 * Called when deactivating. Removes all canvases, wrappers, and
 * restores the original page layout.
 */
function cleanupAll() {
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

  /* Remove the toolbar */
  if (toolbarContainer) {
    toolbarContainer.remove();
    toolbarContainer = null;
  }

  /* Disconnect the MutationObserver */
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  imageOverlays = new WeakMap();
  imageProcessIds = new WeakMap();
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
  currentSettings = settings || {};

  console.log('[VisionTranslate] Activating with settings:', currentSettings);

  /* Create the floating toolbar */
  createToolbar();

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

async function translateCurrentPage(settings, statusMessage = 'Translating all images...') {
  const nextSettings = settings || currentSettings || {};

  if (!isActive) {
    await activate(nextSettings);
  } else {
    currentSettings = nextSettings;
    addTranslateIcons();
  }

  updateToolbarStatus(statusMessage);
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
    case 'ACTIVATE':
    case 'TRANSLATE_PAGE': {
      /*
       * Both ACTIVATE (from background.js toggle) and TRANSLATE_PAGE
       * (from the popup's "Translate This Page" button) trigger the
       * same activation flow. The payload may contain settings directly
       * or nested under payload.settings.
       */
      const settings = payload?.settings || message.settings || payload;
      activate(settings).then(() => {
        sendResponse({ success: true });
      });
      /* Return true because activate() is async */
      return true;
    }

    case 'TRANSLATE_ALL_IMAGES': {
      const settings = payload?.settings || message.settings || currentSettings;
      translateCurrentPage(settings)
        .then(() => {
          updateToolbarStatus('Translation complete');
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
