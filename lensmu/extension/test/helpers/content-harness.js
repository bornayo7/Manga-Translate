// Runs the real content entry and all page/render modules. Tests use Chrome
// messages and DOM observations, never vm evaluation of private bindings.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { FakeDocument, FakeMutationObserver, createFakeTimers } from './fake-dom.js';
const source = await readFile(new URL('../../content.js', import.meta.url), 'utf8');

export class FakeAudio {
  static instances = [];
  constructor() { this.paused = true; this.src = ''; this.currentTime = 0; FakeAudio.instances.push(this); }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function ocrBlocks(text = 'こんにちは') {
  return [{ text, confidence: .9, bbox: { x: 10, y: 10, width: 120, height: 40 }, orientation: 'horizontal' }];
}
export function prepared({ blocks = ocrBlocks(), translations = ['Hello'], outcomes, targetLanguage = 'en' } = {}) {
  return { ok: true, body: { rawOcrResults: blocks, mergedOcrResults: blocks,
    translations: blocks.length ? translations : [], outcomes, sourceLanguage: 'ja', targetLanguage } };
}

export async function loadContentScript({ messages, settings: initial = {}, imageLoads, origin = 'http://page.test' } = {}) {
  const document = new FakeDocument();
  const timers = createFakeTimers();
  const sent = [];
  let listener;
  let settings = { ocrEngine: 'paddleocr', translationProvider: 'libre', sourceLanguage: 'auto',
    targetLanguage: 'en', maxConcurrentImages: 5, ...initial };
  FakeMutationObserver.instances = [];
  FakeAudio.instances = [];
  const chrome = { runtime: {
    id: 'test-extension',
    onMessage: { addListener(next) { listener = next; } },
    getURL: (path) => new URL('../../' + path, import.meta.url).href,
    async sendMessage(message) {
      sent.push(message);
      const response = await messages?.(message, sent);
      if (response !== undefined) return response;
      if (message.action === 'PREPARE_IMAGE') return prepared();
      if (message.action === 'FETCH_IMAGE') return { ok: true, dataUrl: 'data:image/png;base64,' + message.payload.url };
      return { success: true, ok: true, body: {} };
    }
  } };
  const window = {
    location: { href: origin + '/page', origin }, devicePixelRatio: 1,
    getComputedStyle: (element) => ({ position: element.style.position || 'static',
      backgroundImage: element.style.backgroundImage || 'none',
      display: element.style.display || 'block', visibility: element.style.visibility || 'visible' })
  };
  const Image = class {
    constructor() { this.naturalWidth = 300; this.naturalHeight = 200; }
    set src(value) {
      this._src = value;
      if (!value) return;
      Promise.resolve(imageLoads?.(value, this)).then(() => this.onload?.(), () => this.onerror?.());
    }
    get src() { return this._src; }
  };
  const context = vm.createContext({
    chrome, document, window, Image, Audio: FakeAudio, MutationObserver: FakeMutationObserver,
    console: { log() {}, warn() {}, error() {} }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    crypto: globalThis.crypto
  });
  vm.runInContext(source, context, { filename: 'content.js', importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  const request = (action, payload = {}) => new Promise((resolve) => listener({ action, payload }, {}, resolve));
  const controlFor = (element) => {
    const anchor = ['IMG', 'CANVAS'].includes(element.tagName) ? element.parentElement : element;
    const iconContainer = anchor?.querySelector('.vt-lensmu-translate-icon-container');
    if (!iconContainer) return null;
    return { element, iconContainer, anchor,
      icon: iconContainer.querySelector('.vt-lensmu-translate-icon'),
      readAloudButton: iconContainer.querySelector('.vt-lensmu-read-aloud-btn'),
      failureNotice: iconContainer.querySelector('.vt-lensmu-translation-notice') };
  };
  return {
    document, timers, sent, request,
    observer: () => FakeMutationObserver.instances.at(-1),
    activate: (extra = {}) => { settings = { ...settings, ...extra }; return request('ACTIVATE', { settings }); },
    update: (extra = {}) => { settings = { ...settings, ...extra }; return request('SETTINGS_UPDATED', { settings }); },
    deactivate: () => request('DEACTIVATE'),
    state: () => request('GET_PAGE_STATE'),
    translateAll: () => request('TRANSLATE_ALL_IMAGES'),
    controlFor,
    controls: () => document.querySelectorAll('[data-vt-icon-added]').map(controlFor).filter(Boolean),
    addImage({ src = origin + '/a.png', parent = document.body, naturalWidth = 300, naturalHeight = 200, complete = true } = {}) {
      const img = document.createElement('img'); Object.assign(img, { src, naturalWidth, naturalHeight, complete });
      parent.appendChild(img); return img;
    },
    async settle(rounds = 20) { for (let n = 0; n < rounds; n++) await new Promise((resolve) => setImmediate(resolve)); },
    async idle(maxRounds = 2000) {
      for (let n = 0; n < maxRounds; n++) {
        await new Promise((resolve) => setImmediate(resolve));
        if ((await request('GET_PAGE_STATE')).pendingCount === 0) return;
      }
      throw new Error('Image work did not settle.');
    }
  };
}
