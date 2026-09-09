import { useEffect, useState } from 'react';
import { DEFAULT_EXTENSION_SETTINGS } from '../../shared/preferences.js';
import { trimTrailingSlashes } from '../../shared/text.js';
import { fetchWithTimeout } from '../../shared/fetch-with-timeout.js';
import { queryActiveTab, sendRuntimeMessage, sendTabMessage } from './runtime.js';

export function usePageSession(settings, loaded, ensureSaved) {
  const [tabId, setTabId] = useState(null);
  const [tabState, setTabState] = useState({ active: false });
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState('');
  const [serverStatus, setServerStatus] = useState('checking');
  const [healthAttempt, setHealthAttempt] = useState(0);
  const requiresServer = ['paddleocr', 'mangaocr'].includes(settings.ocrEngine);
  useEffect(() => {
    let active = true;
    queryActiveTab().then(async (tab) => {
      if (!active) return;
      if (!tab?.id || !/^(https?|file):/i.test(tab.url || '')) { setUnavailable(true); return; }
      setTabId(tab.id);
      const answer = await sendRuntimeMessage({ action: 'GET_TAB_STATE', payload: { tabId: tab.id } });
      if (active) setTabState(answer?.state || { active: false });
    }).catch((failure) => { if (active) { setError(failure.message); setUnavailable(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    if (!requiresServer) { setServerStatus('idle'); return; }
    const controller = new AbortController();
    setServerStatus('checking');
    const base = trimTrailingSlashes(settings.backendUrl) || DEFAULT_EXTENSION_SETTINGS.backendUrl;
    fetchWithTimeout(`${base}/health`, { signal: controller.signal }, { timeoutMs: 3000, maxResponseBytes: 64 * 1024 })
      .then((answer) => {
        if (controller.signal.aborted) return;
        if (!answer.ok || !answer.json) { setServerStatus('offline'); return; }
        const health = answer.json;
        const available = settings.ocrEngine === 'paddleocr' ? health.paddle_ocr_available
          : health.manga_full_available ?? (health.paddle_ocr_available && health.manga_ocr_available);
        setServerStatus(available ? 'online' : 'unavailable');
      }).catch(() => { if (!controller.signal.aborted) setServerStatus('offline'); });
    return () => controller.abort();
  }, [loaded, requiresServer, settings.backendUrl, settings.ocrEngine, healthAttempt]);

  async function run(action) {
    if (!tabId || busy) return;
    setError(''); setBusy(action);
    try {
      await ensureSaved();
      if (action === 'toggle' || !tabState.active) {
        const answer = await sendRuntimeMessage({ action: 'TOGGLE_TRANSLATION', payload: { tabId } });
        if (answer?.success === false || !answer?.state) throw new Error(answer?.error || 'Page controls could not be changed. Reload the page and try again.');
        setTabState(answer.state);
      }
      if (action === 'translate') {
        const answer = await sendTabMessage(tabId, { action: 'TRANSLATE_ALL_IMAGES', payload: {} });
        if (answer?.success === false || answer?.error) throw new Error(answer.error || 'Translation could not start.');
        window.close();
      }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  return {
    tabState, error, unavailable, serverStatus,
    isTranslating: busy === 'translate', isTogglingPage: busy === 'toggle',
    translateDisabled: !loaded || !tabId || unavailable || Boolean(busy) || (requiresServer && serverStatus !== 'online'),
    toggle: () => run('toggle'), translate: () => run('translate'),
    retryHealth: () => setHealthAttempt((attempt) => attempt + 1),
  };
}
