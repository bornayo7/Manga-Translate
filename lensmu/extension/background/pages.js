import { toContentScriptSettings } from '../shared/preferences.js';

const inactive = () => ({ active: false, imageCount: 0, translatedCount: 0 });
const hostname = url => {
  try { const parsed = new URL(url); return ['http:', 'https:', 'file:'].includes(parsed.protocol) ? parsed.hostname : null; }
  catch { return null; }
};

// The page owns live state. Query it after worker restarts instead of restoring
// a stale _tabStates snapshot that can outlive the document it described.
export function createPageSessions(browser, settingsStore) {
  const sessions = new Map();
  let broadcasts = Promise.resolve();
  const send = async (tabId, action, payload = {}) => {
    let timer;
    try { return await Promise.race([browser.tabs.sendMessage(tabId, { action, payload }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]); }
    catch { return null; }
    finally { clearTimeout(timer); }
  };
  const get = async tabId => {
    const result = await send(tabId, 'GET_PAGE_STATE');
    return result && typeof result.active === 'boolean' ? result : inactive();
  };
  const badge = (tabId, state) => Promise.all([
    browser.action.setBadgeText({ tabId, text: state.active ?
      (state.imageCount > state.translatedCount ? `${state.translatedCount}/${state.imageCount}` : 'ON') : '' }),
    browser.action.setBadgeBackgroundColor({ tabId, color: state.active ? '#176F67' : '#20304A' })
  ]);
  const record = tabId => {
    if (!sessions.has(tabId)) sessions.set(tabId, { chain: Promise.resolve(), disposed: false });
    return sessions.get(tabId);
  };
  const serialized = (tabId, operation) => {
    const session = record(tabId);
    const assertCurrent = () => { if (session.disposed) throw new DOMException('Page changed.', 'AbortError'); };
    const result = session.chain.then(async () => { assertCurrent(); return operation(assertCurrent); });
    session.chain = result.catch(() => undefined);
    return result;
  };
  const retire = tabId => {
    const previous = sessions.get(tabId);
    if (previous) previous.disposed = true;
    sessions.delete(tabId);
  };
  return {
    get,
    toggle: tabId => serialized(tabId, async check => {
      const state = await get(tabId);
      const tab = await browser.tabs.get(tabId);
      check();
      const host = hostname(tab.url);
      const activate = !state.active;
      const settings = activate ? await settingsStore.load() : null;
      check();
      const response = await send(tabId, activate ? 'ACTIVATE' : 'DEACTIVATE', activate ? { settings: toContentScriptSettings(settings) } : {});
      check();
      if (response?.success !== true) throw new Error(response?.error || 'This page cannot be translated. Open a normal webpage and try again.');
      if (host) await settingsStore.setDomainDisabled(host, !activate);
      check();
      const current = await get(tabId);
      check();
      await badge(tabId, current);
      return current;
    }),
    autoActivate: tab => serialized(tab.id, async check => {
      const host = hostname(tab.url);
      if (!host) return;
      const settings = await settingsStore.load();
      const disabled = await settingsStore.disabledDomains();
      check();
      if (!settings.autoTranslate || disabled.includes(host) || (await get(tab.id)).active) return;
      check();
      const response = await send(tab.id, 'ACTIVATE', { settings: toContentScriptSettings(settings) });
      check();
      if (response?.success) {
        const current = await get(tab.id);
        check();
        await badge(tab.id, current);
      }
    }),
    navigate(tabId) { retire(tabId); return badge(tabId, inactive()); },
    remove: retire,
    progress: tabId => serialized(tabId, async check => {
      const current = await get(tabId);
      check();
      await badge(tabId, current);
    }),
    broadcast(settings) {
      const result = broadcasts.then(async () => {
        const tabs = await browser.tabs.query({});
        await Promise.all(tabs.map(tab => send(tab.id, 'SETTINGS_UPDATED', { settings: toContentScriptSettings(settings) })));
      });
      broadcasts = result.catch(() => undefined);
      return result;
    }
  };
}
