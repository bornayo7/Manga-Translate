// A deliberately small DOM double for running content.js inside a vm
// context. It models only what the content script touches: a tree with
// parent/child links and isConnected, class lists, inline styles, data
// attributes, the query selectors content.js actually uses, events, and
// enough of <img>/<canvas> to drive discovery. Layout is faked: every
// element reports a fixed bounding box, and getComputedStyle reports the
// inline `position` (or "static").

export class FakeClassList {
  constructor(element) {
    this.element = element;
    this.set = new Set();
  }
  add(...names) {
    names.forEach((name) => this.set.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.set.delete(name));
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const next = force === undefined ? !this.set.has(name) : force;
    if (next) this.set.add(name); else this.set.delete(name);
    return next;
  }
  [Symbol.iterator]() {
    return this.set.values();
  }
}

class FakeStyle {
  constructor() {
    this._props = {};
  }
  get cssText() {
    return Object.entries(this._props)
      .filter(([, value]) => value !== '' && value !== undefined)
      .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value}`)
      .join('; ');
  }
  set cssText(text) {
    this._props = {};
    for (const declaration of String(text).split(';')) {
      const [rawKey, ...rest] = declaration.split(':');
      const key = rawKey?.trim();
      if (!key) continue;
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this._props[camel] = rest.join(':').trim();
    }
  }
}

const styleHandler = {
  get(target, prop) {
    if (prop in target) return target[prop];
    return target._props[prop] ?? '';
  },
  set(target, prop, value) {
    if (prop === 'cssText') {
      target.cssText = value;
    } else {
      target._props[prop] = value;
    }
    return true;
  }
};

let elementCounter = 0;

export class FakeElement {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.nodeName = this.tagName;
    this.uid = ++elementCounter;
    this.children = [];
    this.parentNode = null;
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = new Proxy(new FakeStyle(), styleHandler);
    this.attributes = new Map();
    this.listeners = new Map();
    this.id = '';
    this.title = '';
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.rect = { x: 0, y: 0, width: 300, height: 200, top: 0, left: 0 };
    this.naturalWidth = this.tagName === 'IMG' ? 300 : undefined;
    this.naturalHeight = this.tagName === 'IMG' ? 200 : undefined;
    this.complete = true;
    this._src = '';
    this._currentSrc = '';
    this.crossOrigin = null;
    if (this.tagName === 'CANVAS') {
      this.width = 300;
      this.height = 200;
    }
  }

  get className() {
    return [...this.classList].join(' ');
  }
  set className(value) {
    this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument.documentElement) return true;
      node = node.parentNode;
    }
    return false;
  }

  get src() {
    return this._src;
  }
  set src(value) {
    this._src = String(value);
    this._currentSrc = String(value);
  }
  get currentSrc() {
    return this._currentSrc || this._src;
  }
  set currentSrc(value) {
    this._currentSrc = String(value);
  }

  get offsetParent() {
    return this.isConnected ? this.parentElement : null;
  }
  get offsetWidth() {
    return this.rect.width;
  }
  get offsetHeight() {
    return this.rect.height;
  }
  getBoundingClientRect() {
    return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index === -1) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  closest(selector) {
    let current = this;
    while (current && current.nodeType === 1) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  getAttribute(name) {
    if (name === 'style') return this.style.cssText || null;
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  setAttribute(name, value) {
    if (name === 'style') {
      this.style.cssText = value;
      return;
    }
    if (name === 'class') {
      this.className = value;
      return;
    }
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    if (name === 'style') {
      this.style.cssText = '';
      return;
    }
    this.attributes.delete(name);
  }

  matches(selector) {
    return selector.split(',').some((part) => this._matchesSimple(part.trim()));
  }
  _matchesSimple(selector) {
    if (!selector) return false;
    if (selector.startsWith('[')) {
      const attr = selector.slice(1, -1);
      if (attr.startsWith('data-')) {
        const key = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return key in this.dataset;
      }
      return this.attributes.has(attr);
    }
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName === selector.toUpperCase();
  }
  descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }
  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
  dispatch(type, event = {}) {
    const payload = {
      type,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...event
    };
    for (const handler of [...(this.listeners.get(type) || [])]) {
      handler(payload);
    }
    return payload;
  }

  // Minimal canvas surface for createOverlay()/imageToBase64().
  getContext() {
    const canvas = this;
    return {
      scale() {},
      clearRect() {},
      /*
       * Record whose pixels landed here. imageToBase64() draws an image
       * onto an offscreen canvas and sends toDataURL()'s output onward, so
       * a fake that forgets the source makes every image's payload
       * identical — and any test that asks "which image was sent to OCR?"
       * silently passes or fails for the wrong reason.
       */
      drawImage(source) {
        canvas.drawnFrom =
          source?.currentSrc || source?.src || source?._src || canvas.drawnFrom || '';
      },
      fillRect() {},
      getImageData() {
        return { data: new Uint8ClampedArray(4) };
      }
    };
  }
  toDataURL(type = 'image/png') {
    return `data:${type};base64,${this.tagName}-${this.uid}-${this.currentSrc || this.drawnFrom || 'canvas'}`;
  }
}

export class FakeDocument {
  constructor() {
    this.contentType = 'text/html';
    this.documentElement = new FakeElement(this, 'html');
    this.documentElement.parentNode = null;
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }
  getElementById(id) {
    return this.documentElement.descendants().find((node) => node.id === id) || null;
  }
}

export class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    FakeMutationObserver.instances.push(this);
  }
  observe(target, options) {
    this.targets.push({ target, options });
  }
  disconnect() {
    this.targets = [];
  }
  // Test hook: deliver synthetic records.
  emit(records) {
    this.callback(records, this);
  }
}

/* Controllable timers so the 500 ms discovery debounce is deterministic. */
export function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay = 0, ...args) {
      const id = nextId++;
      pending.set(id, { at: now + Math.max(0, Number(delay) || 0), callback, args });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...pending.entries()].filter(([, entry]) => entry.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, entry] = due[0];
        pending.delete(id);
        now = entry.at;
        entry.callback(...entry.args);
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = target;
    },
    get pendingCount() {
      return pending.size;
    }
  };
}
