export function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) return Promise.reject(new Error('Open lensmu from the browser toolbar.'));
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(response);
  }));
}

export function queryActiveTab() {
  return new Promise((resolve, reject) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(tabs?.[0] ?? null);
  }));
}

export function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, message, (response) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error('This page cannot be reached. Reload it and try again.')); else resolve(response);
  }));
}
