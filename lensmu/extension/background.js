// MV3 composition: live page state, trusted settings, and request/resource
// ownership live behind small modules. Register every listener synchronously.
import { getSettings, saveSettings, getDisabledDomains, addDisabledDomain, removeDisabledDomain } from './utils/storage.js';
import { toContentScriptSettings } from './shared/preferences.js';
import { fetchWithTimeout } from './shared/fetch-with-timeout.js';
import { toErrorMessage } from './shared/text.js';
import { translateTexts } from './translate/translate-manager.js';
import { createOcrService } from './ocr/providers.js';
import { createPreparationPipeline } from './background/preparation.js';
import { createRequestRegistry } from './background/requests.js';
import { createPageSessions } from './background/pages.js';
import { createOffscreenOcr, OFFSCREEN_TARGET } from './background/offscreen.js';
import { login, logout, getAuthState } from './auth/auth0.js';
import { generateReadAloudAudio, loadElevenLabsVoices, syncReadAloudTranslation } from './tts/elevenlabs.js';

const requests = createRequestRegistry();
const offscreen = createOffscreenOcr(chrome);
const recognize = createOcrService({ runTesseract: offscreen.recognize });
const prepare = createPreparationPipeline({ loadSettings: getSettings, recognize, translate: translateTexts });
const pages = createPageSessions(chrome, { load: getSettings, disabledDomains: getDisabledDomains,
  setDomainDisabled: (hostname, disabled) => disabled ? addDisabledDomain(hostname) : removeDisabledDomain(hostname) });
const trusted = sender => sender?.url
  ? sender.url.startsWith(chrome.runtime.getURL(''))
  : !sender?.tab;
const requireTrusted = sender => { if (!trusted(sender)) throw new Error('This action is only available from an extension page.'); };
const report = error => { if (error?.name !== 'AbortError') console.warn('[lensmu]', toErrorMessage(error)); };
const ok = body => ({ ok: true, body });

async function fetchImage(url, signal) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) image URLs are supported.');
  const response = await fetchWithTimeout(parsed.href, { credentials: 'omit', redirect: 'follow', signal },
    { timeoutMs: 15000, maxResponseBytes: 10 * 1024 * 1024, as: 'bytes' });
  if (!response.ok) throw new Error(`Image request failed (HTTP ${response.status}).`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error('Fetched resource is not an image.');
  let binary = '';
  for (let offset = 0; offset < response.bytes.length; offset += 8192) {
    binary += String.fromCharCode(...response.bytes.subarray(offset, offset + 8192));
  }
  return { ok: true, dataUrl: `data:${type};base64,${btoa(binary)}` };
}

async function handle(message, sender) {
  const action = message?.action;
  const payload = message?.payload || {};
  const tabId = trusted(sender) ? undefined : sender.tab?.id;
  const tracked = work => requests.run(sender, payload.requestId, work);
  switch (action) {
    case 'PREPARE_IMAGE': return tracked(async signal => ok(await prepare(payload, { signal })));
    case 'OCR_REQUEST': return tracked(async signal => ok(await recognize(payload.imageBase64, await getSettings(), { signal, sourceLanguage: payload.sourceLang })));
    case 'TRANSLATE_REQUEST': return tracked(async signal => {
      const settings = await getSettings();
      const result = await translateTexts(payload.texts, payload.sourceLang || 'auto', payload.targetLang || settings.targetLanguage, settings, { signal });
      return ok({ translations: result.translations, outcomes: result.outcomes, source_lang: result.sourceLang,
        target_lang: result.targetLang, provider: result.provider, fallback_used: Boolean(result.fallback),
        original_error: result.originalError || null, diagnostics: result.diagnostics || null });
    });
    case 'FETCH_IMAGE': return tracked(signal => fetchImage(payload.url, signal));
    case 'CANCEL_REQUESTS': return { success: true, cancelled: requests.cancel(sender, payload.requestIds) };
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { settings: trusted(sender) ? settings : toContentScriptSettings(settings) };
    }
    case 'SAVE_SETTINGS': {
      requireTrusted(sender);
      if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) throw new Error('A settings patch is required.');
      const settings = await saveSettings(payload.settings);
      // Persisted acknowledgment is independent of a page that cannot receive
      // its update; broadcasts preserve write order and never expose secrets.
      void pages.broadcast(settings).catch(report);
      return { success: true, settings, revision: settings.settingsRevision };
    }
    case 'GET_TAB_STATE': {
      const target = tabId ?? payload.tabId;
      if (tabId === undefined) requireTrusted(sender);
      return { state: target === undefined ? null : await pages.get(target) };
    }
    case 'TOGGLE_TRANSLATION': {
      const target = tabId ?? payload.tabId;
      if (tabId === undefined) requireTrusted(sender);
      if (target === undefined) throw new Error('No tab selected.');
      return { success: true, state: await pages.toggle(target) };
    }
    case 'UPDATE_PROGRESS': {
      if (tabId === undefined) throw new Error('Progress must come from a page.');
      await pages.progress(tabId);
      return { success: true };
    }
    case 'LOAD_ELEVENLABS_VOICES': {
      requireTrusted(sender);
      return tracked(async signal => ok({ voices: await loadElevenLabsVoices(await getSettings(), { signal }) }));
    }
    case 'TEST_ELEVENLABS_VOICE':
    case 'GENERATE_READ_ALOUD_AUDIO': {
      if (action === 'TEST_ELEVENLABS_VOICE') requireTrusted(sender);
      return tracked(async signal => {
        const settings = await getSettings();
        if (action === 'GENERATE_READ_ALOUD_AUDIO' && !settings.enableReadAloud) throw new Error('Enable read-aloud in settings first.');
        return ok(await generateReadAloudAudio({ ...payload,
          text: payload.text || (action === 'TEST_ELEVENLABS_VOICE' ? 'This is a lensmu read-aloud test.' : ''),
          language: payload.language || settings.targetLanguage, settings,
          cacheAudio: action === 'GENERATE_READ_ALOUD_AUDIO', signal }));
      });
    }
    case 'SYNC_READ_ALOUD_TRANSLATION': {
      if (!(await getSettings()).enableReadAloud) return ok({ skipped: true });
      return ok(await syncReadAloudTranslation(payload));
    }
    case 'OFFSCREEN_IDLE': {
      requireTrusted(sender);
      if (sender.url !== chrome.runtime.getURL('offscreen/ocr.html')) throw new Error('Invalid offscreen sender.');
      return { success: true, closed: await offscreen.closeIfIdle() };
    }
    case 'AUTH_LOGIN': requireTrusted(sender); return { success: true, user: (await login()).user };
    case 'AUTH_LOGOUT': requireTrusted(sender); await logout(); return { success: true };
    case 'GET_AUTH_STATE': requireTrusted(sender); return getAuthState();
    case 'FATAL_ERROR': {
      await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/VT_KD_128.png', title: 'lensmu', message: String(payload.errorMessage || 'Translation failed.').slice(0, 300) });
      return { success: true };
    }
    default: throw new Error(`Unknown action: ${String(action)}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === OFFSCREEN_TARGET) return false;
  handle(message, sender).then(sendResponse, error => {
    const cancelled = error?.name === 'AbortError';
    sendResponse({ ok: false, success: false, cancelled, error: toErrorMessage(error), body: { error: toErrorMessage(error) } });
  });
  return true;
});
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') void saveSettings({}).catch(report);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translation' && tab?.id !== undefined) void pages.toggle(tab.id).catch(report);
});
chrome.tabs.onRemoved.addListener(tabId => { requests.cancelTab(tabId); pages.remove(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading') { requests.cancelTab(tabId); void pages.navigate(tabId).catch(report); }
  if (change.status === 'complete') void pages.autoActivate({ ...tab, id: tabId }).catch(report);
});
void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(report);
