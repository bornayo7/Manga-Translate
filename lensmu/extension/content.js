// Classic MV3 entry: lazy module loading is itself an activation transaction.
let pageController = null;
let pageLoading = null;
let pageGeneration = 0;

async function loadPageController() {
  if (!pageLoading) {
    pageLoading = import(chrome.runtime.getURL('page/controller.js')).then(({ createPageController }) => {
      pageController = createPageController({
        document, window, chrome, crypto, Image, Audio, MutationObserver,
        ResizeObserver: typeof ResizeObserver === 'function' ? ResizeObserver : null,
        timers: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (id) => clearTimeout(id) }
      });
      return pageController;
    }).catch((error) => { pageLoading = null; throw error; });
  }
  return pageLoading;
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  const action = message?.action;
  if (action === 'GET_PAGE_STATE') {
    reply(pageController?.getState() || { active: false, imageCount: 0, translatedCount: 0, pendingCount: 0 });
    return false;
  }
  if (action === 'DEACTIVATE') {
    pageGeneration += 1;
    pageController?.deactivate();
    reply({ success: true });
    return false;
  }
  if (!['ACTIVATE', 'SETTINGS_UPDATED', 'TRANSLATE_ALL_IMAGES'].includes(action)) return false;
  const generation = action === 'ACTIVATE' ? ++pageGeneration : pageGeneration;
  const settings = message.payload?.settings || message.settings || message.payload || {};
  (async () => {
    const page = await loadPageController();
    if (generation !== pageGeneration) return { success: false, cancelled: true };
    if (action === 'ACTIVATE') return page.activate(settings);
    if (action === 'SETTINGS_UPDATED') return page.updateSettings(settings);
    return page.translateAll();
  })().then(reply, (error) => reply({ success: false, error: error?.message || String(error) }));
  return true;
});
