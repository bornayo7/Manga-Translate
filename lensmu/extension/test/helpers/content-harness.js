// Loads content.js into a vm context wired to the fake DOM, a scripted
// chrome.runtime.sendMessage, fake timers and a recording Audio class.
// Module-level `let`/`const` bindings of a classic script live in the
// context's global lexical scope, so `context.eval('imageOverlays')` reaches
// them for assertions without exporting anything from production code.

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

import { FakeDocument, FakeElement, FakeMutationObserver, createFakeTimers } from './fake-dom.js';

const contentSource = await readFile(new URL('../../content.js', import.meta.url), 'utf8');
const toFileUrl = (url) => pathToFileURL(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
const overlayStubUrl = toFileUrl(new URL('./overlay-stub.mjs', import.meta.url));

/*
 * chrome.runtime.getURL() resolves to the real module on disk, so a
 * dynamic import in content.js loads the code that actually ships.
 * overlay.js is the one exception: it needs a canvas, so it is stubbed.
 */
const extensionUrl = (path) =>
  path === 'overlay.js' ? overlayStubUrl : toFileUrl(new URL(`../../${path}`, import.meta.url));

export class FakeAudio {
  static instances = [];
  constructor() {
    this.src = '';
    this.paused = true;
    this.currentTime = 0;
    this.playCount = 0;
    this.onended = null;
    this.onerror = null;
    FakeAudio.instances.push(this);
  }
  async play() {
    this.paused = false;
    this.playCount += 1;
  }
  pause() {
    this.paused = true;
  }
}

/*
 * Message script: a function (message) => response | Promise<response>.
 * `deferred(action)` creates a response the test resolves later.
 */
export async function loadContentScript({ messages, settings = {}, origin = 'http://page.test' } = {}) {
  const document = new FakeDocument();
  const timers = createFakeTimers();
  const sent = [];
  FakeMutationObserver.instances = [];
  FakeAudio.instances = [];

  const defaultHandler = (message) => {
    if (message.action === 'UPDATE_PROGRESS' || message.action === 'FATAL_ERROR' || message.action === 'SYNC_READ_ALOUD_TRANSLATION' || message.action === 'CANCEL_REQUESTS') {
      return { success: true, ok: true, body: {} };
    }
    return { ok: false, body: { error: `unscripted ${message.action}` } };
  };

  const chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener() {} },
      getURL: extensionUrl,
      sendMessage: async (message) => {
        sent.push(message);
        const handler = messages || defaultHandler;
        const response = await handler(message, sent);
        return response === undefined ? defaultHandler(message) : response;
      }
    }
  };

  const window = {
    location: { href: `${origin}/page`, origin },
    devicePixelRatio: 1,
    getComputedStyle: (element) => ({
      position: element.style.position || 'static',
      backgroundImage: element.style.backgroundImage || 'none'
    })
  };

  const sandbox = {
    chrome,
    document,
    window,
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: FakeMutationObserver,
    HTMLImageElement: class {},
    HTMLCanvasElement: class {},
    Image: class {
      set src(value) {
        this._src = value;
        Promise.resolve().then(() => this.onload?.());
      }
    },
    Audio: FakeAudio,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    crypto: globalThis.crypto,
    TextEncoder,
    URL,
    WeakMap,
    Map,
    Set,
    Promise,
    AbortController,
    DOMException,
    Math,
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Error
  };
  // instanceof checks in imageToBase64 must recognise fake elements.
  Object.defineProperty(sandbox.HTMLImageElement, Symbol.hasInstance, { value: (value) => value instanceof FakeElement && value.tagName === 'IMG' });
  Object.defineProperty(sandbox.HTMLCanvasElement, Symbol.hasInstance, { value: (value) => value instanceof FakeElement && value.tagName === 'CANVAS' });

  const context = vm.createContext(sandbox);
  vm.runInContext(contentSource, context, {
    filename: 'content.js',
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
  });

  const evalIn = (expression) => vm.runInContext(expression, context);

  return {
    document,
    timers,
    sent,
    context,
    evalIn,
    observer: () => FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1],
    async activate(extraSettings = {}) {
      await evalIn('activate')({ ocrEngine: 'paddleocr', translationProvider: 'libre', sourceLanguage: 'auto', targetLanguage: 'en', maxConcurrentImages: 5, ...settings, ...extraSettings });
    },
    deactivate: () => evalIn('deactivate')(),
    controls: () => [...evalIn('translateIcons')],
    controlFor(element) {
      return [...evalIn('translateIcons')].find((control) => control.element === element) || null;
    },
    trackedStateCount: () => evalIn('getTrackedStateCount')(),
    addImage({ src = 'http://page.test/a.png', parent = document.body, naturalWidth = 300, naturalHeight = 200, complete = true } = {}) {
      const img = document.createElement('img');
      img.src = src;
      img.naturalWidth = naturalWidth;
      img.naturalHeight = naturalHeight;
      img.complete = complete;
      parent.appendChild(img);
      return img;
    },
    /*
     * Flush a fixed number of microtask turns. Use this only to observe a
     * pipeline *mid-flight*; waiting for one to finish needs idle().
     */
    async settle(rounds = 20) {
      for (let index = 0; index < rounds; index++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    },

    /*
     * Drain until no image work is queued or running. A fixed number of
     * turns cannot express "the click finished": the pipeline's length
     * varies with the path it takes, so a magic number is a race that
     * passes on a fast machine and fails on a slow one. Bounded, so work
     * that genuinely never settles still fails the test rather than
     * hanging it.
     */
    async idle(maxRounds = 2000) {
      const isQuiet = () => {
        const queue = evalIn('imageWorkQueue');
        return !queue || (queue.running === 0 && queue.queued === 0);
      };
      for (let index = 0; index < maxRounds; index++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (isQuiet()) {
          /* One more turn for the settlement handlers to run. */
          await new Promise((resolve) => setImmediate(resolve));
          if (isQuiet()) {
            return;
          }
        }
      }
      throw new Error('image work did not settle within the allowed turns');
    }
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function ocrBlocks(text = 'こんにちは') {
  return [{ text, confidence: 0.9, bbox: { x: 10, y: 10, width: 120, height: 40 }, orientation: 'horizontal' }];
}

export function translated(translations, outcomes) {
  return {
    ok: true,
    body: {
      translations,
      outcomes: outcomes || translations.map((text) => ({ status: text ? 'translated' : 'skipped', reason: text ? '' : 'already-target-language' })),
      source_lang: 'ja',
      target_lang: 'en',
      provider: 'mymemory'
    }
  };
}
