import { readTargetGeometry } from './target-geometry.js';
const PREFIX = 'vt-lensmu';
const STATES = {
  idle: ['文A', '#3157c8', 'Translate this image'],
  working: ['⟳', '#3157c8', 'Translating…'],
  rendered: ['✓', '#176f67', 'Show translated image'],
  skipped: ['—', '#566176', 'The text is already in the target language.'],
  'no-text': ['—', '#566176', 'No text found in this image.'],
  failed: ['✗', '#b33a43', 'Translation failed. Click to retry.']
};

// Owns the target's controls, canvas and reversible host DOM changes.
// Render prepares a detached canvas; accepts() is the single commit gate.
export function createOverlaySession(target, environment, handlers) {
  const { document, window, reader, paint, speech } = environment;
  let disposed = false;
  let settings = {};
  let canvas = null;
  let visible = true;
  let speechData = null;
  const isReplacedElement = ['IMG', 'CANVAS'].includes(target.tagName);
  const parent = target.parentElement;
  const originalStyle = target.getAttribute('style');
  const originalPosition = target.style.position;
  let changedPosition = false;
  let wrapper = null;
  let anchor = target;

  if (isReplacedElement) {
    const positioned = window.getComputedStyle(parent).position !== 'static';
    if (positioned && parent.children.length === 1) anchor = parent;
    else {
      wrapper = document.createElement('div');
      wrapper.className = `${PREFIX}-icon-wrapper`;
      const centered = document.contentType?.startsWith('image/') || /margin\s*:\s*auto/i.test(target.style.cssText);
      wrapper.style.cssText = centered
        ? 'position:relative;display:block;width:fit-content;max-width:100%;margin:auto'
        : 'position:relative;display:inline-block;max-width:100%';
      parent.insertBefore(wrapper, target);
      wrapper.appendChild(target);
      anchor = wrapper;
    }
  } else if (window.getComputedStyle(target).position === 'static') {
    target.style.position = 'relative';
    changedPosition = true;
  }

  const controls = document.createElement('div');
  controls.className = `${PREFIX}-translate-icon-container`;
  controls.style.cssText = 'position:absolute;top:8px;right:8px;z-index:2147483646;display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;max-width:calc(100% - 16px);font:600 12px system-ui';
  const button = (label, title, onClick) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.title = title;
    el.setAttribute('aria-label', title);
    el.style.cssText = 'min-width:36px;min-height:36px;padding:6px 10px;border:2px solid white;border-radius:18px;background:#3157c8;color:white;font:600 12px system-ui;cursor:pointer;box-shadow:0 2px 8px #0004';
    el.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void onClick(); });
    controls.appendChild(el);
    return el;
  };
  const icon = button('文A', 'Translate this image', () => handlers.translate());
  icon.className = `${PREFIX}-translate-icon`;
  icon.dataset.vtState = 'idle';
  const all = button('Translate All', 'Translate all images on this page', () => handlers.translateAll());
  all.className = `${PREFIX}-translate-all-btn`;
  const read = button('Read', 'Read translated text aloud', () => speechData && speech.play(api, speechData));
  read.className = `${PREFIX}-read-aloud-btn`;
  read.hidden = true;
  const notice = document.createElement('div');
  notice.className = `${PREFIX}-translation-notice`;
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'max-width:240px;padding:8px 10px;border-radius:10px;background:#fff;color:#20304a;font:600 12px/1.4 system-ui;box-shadow:0 2px 8px #0004';
  notice.hidden = true;
  controls.appendChild(notice);
  anchor.appendChild(controls);
  target.dataset.vtIconAdded = 'true';

  function show(nextVisible) {
    visible = nextVisible;
    if (!canvas) return;
    canvas.style.opacity = visible ? String(settings.overlayOpacity ?? 1) : '0';
    canvas.style.pointerEvents = visible ? 'auto' : 'none';
  }
  const reveal = (event) => {
    if (canvas && !visible && event.target === target) {
      event.preventDefault(); event.stopPropagation(); show(true);
    }
  };
  target.addEventListener('click', reveal);
  let geometryKey = JSON.stringify(readTargetGeometry(target, anchor, window));
  const resizeObserver = environment.ResizeObserver ? new environment.ResizeObserver(() => api.refreshGeometry()) : null;
  resizeObserver?.observe(target);

  const api = {
    connected: () => !disposed && target.isConnected && (anchor === target || anchor.contains(target)),
    refreshGeometry() {
      if (disposed) return;
      const next = JSON.stringify(readTargetGeometry(target, anchor, window));
      if (next !== geometryKey) { geometryKey = next; void handlers.resize(); }
    },
    reveal: () => show(true),
    speechState(state, error = '') {
      if (disposed) return;
      read.textContent = ({ stopped: 'Read', generating: 'Cancel', playing: 'Stop', error: 'Retry speech' })[state];
      read.title = error || 'Read translated text aloud';
      read.dataset.state = state;
    },
    settings(next) {
      settings = next;
      read.hidden = !settings.enableReadAloud || !speechData?.speechText;
      if (read.hidden) speech.stop(api);
      show(visible);
      api.refreshGeometry();
    },
    status(result) {
      if (disposed) return;
      const state = result.status;
      const [label, color, title] = STATES[state] || STATES.idle;
      icon.textContent = label;
      icon.style.background = color;
      icon.title = title;
      icon.setAttribute('aria-label', title);
      icon.dataset.vtState = state;
      const missing = result.unfit || result.undisplayed || 0;
      notice.textContent = [result.message || (missing ? `${missing} region(s) could not be displayed.` : ''),
        ...(result.warnings || [])].filter(Boolean).join(' ');
      if (state === 'failed' && !notice.textContent) notice.textContent = result.reason === 'identical-output'
        ? 'Translation failed: output matched the source text.' : 'Translation failed: provider returned no translated text.';
      notice.hidden = !notice.textContent;
    },
    clear() {
      canvas?.remove();
      canvas = null;
      speech.stop(api);
      speechData = null;
      read.hidden = true;
    },
    async render(prepared, transaction) {
      const image = await reader.decode(prepared.imageBase64, transaction.signal);
      if (!transaction.accepts() || disposed) return { status: 'cancelled' };
      const geometry = readTargetGeometry(target, anchor, window);
      geometryKey = JSON.stringify(geometry);
      const next = document.createElement('canvas');
      next.className = `${PREFIX}-canvas`;
      const { width, height, dpr, left, top, imagePlacement } = geometry;
      next.width = Math.round(width * dpr); next.height = Math.round(height * dpr);
      next.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:1;cursor:pointer`;
      next.getContext('2d').scale(dpr, dpr);
      const report = paint(next, image, prepared.mergedOcrResults, prepared.translations, { ...settings, imagePlacement });
      if (!transaction.accepts() || disposed) return { status: 'cancelled' };
      if (!report || report.rendered === 0) {
        api.clear();
        return { status: 'failed', reason: 'no-visible-regions', message: 'Translation could not be displayed: every text region is too small, outside the image, or does not fit.' };
      }
      const keepVisible = transaction.preserveVisibility ? visible : true;
      api.clear();
      canvas = next;
      speechData = { speechText: prepared.speechText, imageFingerprint: prepared.imageFingerprint, targetLanguage: prepared.targetLanguage };
      canvas.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); show(!visible); });
      anchor.appendChild(canvas);
      api.settings(settings);
      show(keepVisible);
      return { status: 'rendered', rendered: report.rendered,
        undisplayed: report.outcomes.filter((entry) => entry.status !== 'rendered' && prepared.outcomes[entry.index]?.status !== 'skipped').length,
        warnings: prepared.warnings, outcomes: report.outcomes };
    },
    dispose() {
      if (disposed) return;
      api.clear();
      disposed = true;
      resizeObserver?.disconnect();
      controls.remove();
      target.removeEventListener('click', reveal);
      delete target.dataset.vtIconAdded;
      if (wrapper) {
        if (wrapper.parentNode && target.parentNode === wrapper) wrapper.parentNode.insertBefore(target, wrapper);
        wrapper.remove();
      }
      // Restore only the property this owner changed, preserving host edits.
      if (changedPosition && target.style.position === 'relative') {
        target.style.position = originalPosition;
        if (originalStyle === null && !target.style.cssText.trim()) target.removeAttribute('style');
      }
    }
  };
  return api;
}
