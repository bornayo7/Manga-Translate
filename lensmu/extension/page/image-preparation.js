import { classifyTranslations } from '../shared/translation-outcomes.js';
import { buildSpeechText } from '../render/text-regions.js';
import { preparationSettingsKey } from './image-session.js';

const abortError = () => new DOMException('Image work cancelled.', 'AbortError');
const assertLive = (signal) => { if (signal?.aborted) throw abortError(); };

export function createPageTransport(chrome) {
  let serial = 0;
  return async function send(action, payload = {}, signal) {
    assertLive(signal);
    if (!chrome.runtime?.id) throw abortError();
    const requestId = `${Date.now()}-${++serial}`;
    const cancel = () => {
      void chrome.runtime.sendMessage({ action: 'CANCEL_REQUESTS', payload: { requestIds: [requestId] } }).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await chrome.runtime.sendMessage({ action, payload: { ...payload, requestId } });
      assertLive(signal);
      if (response?.cancelled) throw abortError();
      return response;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
}

export function createImageReader({ document, window, Image, send, timers = globalThis }) {
  function decode(url, signal) {
    assertLive(signal);
    return new Promise((resolve, reject) => {
      const img = new Image();
      let finished = false;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        timers.clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        img.onload = img.onerror = null;
        if (error) { img.src = ''; reject(error); } else resolve(img);
      };
      const cancel = () => finish(abortError());
      const timer = timers.setTimeout(() => finish(new Error('Image loading timed out.')), 15000);
      img.crossOrigin = 'anonymous';
      img.onload = () => finish();
      img.onerror = () => finish(new Error('The image could not be loaded.'));
      signal?.addEventListener('abort', cancel, { once: true });
      img.src = url;
    });
  }

  function capture(element) {
    const width = element.naturalWidth || element.width;
    const height = element.naturalHeight || element.height;
    if (!(width > 0 && height > 0) || width * height > 32_000_000) {
      throw new Error('Image dimensions are unavailable or exceed the 32 megapixel capture limit.');
    }
    if (element.tagName === 'CANVAS') return element.toDataURL('image/png');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const jpeg = width * height > 2_000_000;
    if (jpeg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(element, 0, 0, width, height);
    return jpeg ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png');
  }

  async function fetchImage(url, signal) {
    const response = await send('FETCH_IMAGE', { url }, signal);
    if (!response?.ok || !response.dataUrl) throw new Error(response?.error || 'Image pixels could not be read.');
    return response.dataUrl;
  }

  return {
    decode,
    async read(source, signal) {
      assertLive(signal);
      if (source.type === 'canvas') return capture(source.element);
      const url = new URL(source.url, window.location.href);
      const crossOrigin = ['http:', 'https:'].includes(url.protocol) && url.origin !== window.location.origin;
      if (crossOrigin) {
        try { return await fetchImage(url.href, signal); }
        catch (error) {
          assertLive(signal);
          if (source.type === 'img' && source.element.crossOrigin) return capture(source.element);
          throw error;
        }
      }
      try {
        const element = source.type === 'background' ? await decode(source.url, signal) : source.element;
        return capture(element);
      } catch (error) {
        assertLive(signal);
        if (!['http:', 'https:'].includes(url.protocol)) throw error;
        return fetchImage(url.href, signal);
      }
    }
  };
}

export async function hashText(crypto, text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createImagePreparation({ reader, send, cache, crypto }) {
  return async function prepare(source, settings, signal) {
    const imageBase64 = await reader.read(source, signal);
    assertLive(signal);
    const imageFingerprint = await hashText(crypto, imageBase64);
    assertLive(signal);
    return cache.acquire(`${imageFingerprint}::${preparationSettingsKey(settings)}`, async (producerSignal) => {
      const response = await send('PREPARE_IMAGE', {
        imageBase64,
        sourceLang: settings.sourceLanguage || 'auto',
        targetLang: settings.targetLanguage || 'en',
        preparationRevision: settings.preparationRevision
      }, producerSignal);
      if (!response?.ok) throw new Error(response?.body?.error || response?.error || 'Image translation failed.');
      const body = response.body;
      const warnings = Array.isArray(body?.warnings) ? body.warnings.filter((warning) => typeof warning === 'string').slice(0, 10) : [];
      if (!Array.isArray(body?.rawOcrResults) || !Array.isArray(body?.mergedOcrResults) || !Array.isArray(body?.translations)) {
        throw new Error('The translation pipeline returned an invalid response.');
      }
      if (!body.rawOcrResults.length || !body.mergedOcrResults.length) return { status: 'no-text', warnings };
      if (body.translations.length !== body.mergedOcrResults.length) throw new Error('The provider returned incomplete translations.');
      const classified = classifyTranslations({
        blocks: body.mergedOcrResults,
        translations: body.translations,
        reportedOutcomes: body.outcomes,
        sourceLanguage: body.sourceLanguage || settings.sourceLanguage,
        targetLanguage: body.targetLanguage || settings.targetLanguage
      });
      if (classified.verdict) return { ...classified.verdict, warnings };
      return { status: 'prepared', prepared: {
        imageBase64,
        imageFingerprint,
        mergedOcrResults: body.mergedOcrResults,
        translations: classified.entries.map((entry) => entry.status === 'translated' ? entry.translation : ''),
        warnings,
        outcomes: classified.entries.map(({ status, reason }) => ({ status, reason })),
        speechText: buildSpeechText(body.mergedOcrResults, classified.entries.map((entry) => entry.status === 'translated' ? entry.translation : '')),
        targetLanguage: body.targetLanguage || settings.targetLanguage || 'en'
      } };
    }, signal);
  };
}
