const ownNode = (node) => node?.nodeType === 1 &&
  [...(node.classList || [])].some((name) => name.startsWith('vt-lensmu-'));

export function readImageSource(element, window) {
  const type = element.tagName === 'IMG' ? 'img' : element.tagName === 'CANVAS' ? 'canvas' : 'background';
  const url = type === 'img' ? element.currentSrc || element.src || '' : type === 'background'
    ? window.getComputedStyle(element).backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1] || '' : '';
  const width = element.naturalWidth || element.width || element.offsetWidth;
  const height = element.naturalHeight || element.height || element.offsetHeight;
  return { element, type, url, key: `${type}::${url}::${width}::${height}` };
}

// Aggregates the complete mutation delivery before one reconciliation. Host
// targets remain host targets even when an extension-owned wrapper contains them.
export function createImageDiscovery({ document, window, MutationObserver, timers = globalThis, reconcile }) {
  let active = false;
  let settings = {};
  let timer = null;
  let observer = null;
  const loads = new Map();

  function refresh() {
    timer = null;
    if (!active) return;
    const sources = [];
    for (const [image, handler] of loads) {
      if (!image.isConnected) {
        image.removeEventListener('load', handler);
        image.removeEventListener('error', handler);
        loads.delete(image);
      }
    }
    const minWidth = Math.max(1, Number(settings.minImageWidth) || 100);
    const minHeight = Math.max(1, Number(settings.minImageHeight) || 50);
    for (const element of document.querySelectorAll('img, canvas, div, section, header, article, figure, span, a')) {
      if (ownNode(element)) continue;
      if (element.tagName === 'IMG' && !loads.has(element)) {
        const handler = () => schedule();
        loads.set(element, handler);
        element.addEventListener('load', handler);
        element.addEventListener('error', handler);
      }
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) continue;
      const source = readImageSource(element, window);
      if (source.type === 'img' && (!element.naturalWidth || !element.naturalHeight)) continue;
      if (source.type !== 'canvas' && !source.url) continue;
      const width = element.naturalWidth || element.width || element.offsetWidth;
      const height = element.naturalHeight || element.height || element.offsetHeight;
      if (width >= minWidth && height >= minHeight) sources.push(source);
    }
    reconcile(sources);
  }

  function schedule() {
    if (!active) return;
    timers.clearTimeout(timer);
    timer = timers.setTimeout(refresh, 100);
  }

  return {
    start(nextSettings) {
      settings = nextSettings;
      if (active) return refresh();
      active = true;
      observer = new MutationObserver((records) => {
        const relevant = records.some((record) => {
          if (record.type === 'attributes') return !ownNode(record.target);
          return [...record.addedNodes, ...record.removedNodes].some((node) =>
            node.nodeType === 1 && (!ownNode(node) || Boolean(node.querySelector?.('img,canvas'))));
        });
        if (relevant) schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'srcset', 'style', 'class'] });
      refresh();
    },
    update(nextSettings) { settings = nextSettings; refresh(); },
    refresh,
    stop() {
      active = false;
      timers.clearTimeout(timer);
      timer = null;
      observer?.disconnect();
      observer = null;
      for (const [image, handler] of loads) {
        image.removeEventListener('load', handler);
        image.removeEventListener('error', handler);
      }
      loads.clear();
    }
  };
}
