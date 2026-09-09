// The background owns durable intent; failed reads must never become defaults
// that a subsequent write can persist over the user's existing settings.
import { DEFAULT_EXTENSION_SETTINGS, SETTINGS_STORAGE_KEY, PREPARATION_SETTING_KEYS, mergeWithDefaults } from '../shared/preferences.js';

const LEGACY_KEYS = Object.keys(DEFAULT_EXTENSION_SETTINGS);
const REVISION_KEY = 'vt_settings_revision';
const PREPARATION_KEY = 'vt_preparation_revision';
const DOMAINS_KEY = 'vt_disabled_domains';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createSettingsStore(storage, newRevision = () => crypto.randomUUID()) {
  let chain = Promise.resolve();
  const serialize = work => {
    const result = chain.then(work);
    chain = result.catch(() => undefined);
    return result;
  };

  async function read() {
    const snapshot = await storage.get([SETTINGS_STORAGE_KEY, REVISION_KEY, PREPARATION_KEY, ...LEGACY_KEYS]);
    if (snapshot[SETTINGS_STORAGE_KEY] !== undefined && !isRecord(snapshot[SETTINGS_STORAGE_KEY])) {
      throw new Error('Saved settings are invalid. Restore or repair them before saving changes.');
    }
    const legacyKeys = LEGACY_KEYS.filter(key => Object.hasOwn(snapshot, key));
    let settings = snapshot[SETTINGS_STORAGE_KEY];
    let revision = snapshot[REVISION_KEY] || 'initial';
    let preparationRevision = snapshot[PREPARATION_KEY] || revision;
    if (!settings && legacyKeys.length) {
      settings = mergeWithDefaults(Object.fromEntries(legacyKeys.map(key => [key, snapshot[key]])));
      revision = newRevision();
      preparationRevision = revision;
      await storage.set({ [SETTINGS_STORAGE_KEY]: settings, [REVISION_KEY]: revision, [PREPARATION_KEY]: preparationRevision });
    }
    if (settings && legacyKeys.length) await storage.remove(legacyKeys);
    return { ...mergeWithDefaults(settings), settingsRevision: revision, preparationRevision };
  }

  async function domains() {
    const value = (await storage.get(DOMAINS_KEY))[DOMAINS_KEY];
    if (value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
      throw new Error('Saved disabled-site preferences are invalid.');
    }
    return value || [];
  }

  return {
    load: () => serialize(read),
    applyPatch: patch => serialize(async () => {
      if (!isRecord(patch)) throw new TypeError('Settings patch must be an object.');
      const current = await read();
      const settings = mergeWithDefaults({ ...current, ...patch });
      const changed = LEGACY_KEYS.some(key => current[key] !== settings[key]);
      const preparationChanged = PREPARATION_SETTING_KEYS.some(key => current[key] !== settings[key]);
      const revision = changed || current.settingsRevision === 'initial' ? newRevision() : current.settingsRevision;
      const preparationRevision = preparationChanged || current.preparationRevision === 'initial' ? revision : current.preparationRevision;
      await storage.set({ [SETTINGS_STORAGE_KEY]: settings, [REVISION_KEY]: revision, [PREPARATION_KEY]: preparationRevision });
      return { ...settings, settingsRevision: revision, preparationRevision };
    }),
    disabledDomains: () => serialize(domains),
    setDomainDisabled: (hostname, disabled) => serialize(async () => {
      if (typeof hostname !== 'string' || !hostname) throw new TypeError('A hostname is required.');
      const next = new Set(await domains());
      if (disabled) next.add(hostname); else next.delete(hostname);
      await storage.set({ [DOMAINS_KEY]: [...next] });
    })
  };
}

let store;
const currentStore = () => store ||= createSettingsStore(chrome.storage.local);
export const getSettings = () => currentStore().load();
export const saveSettings = patch => currentStore().applyPatch(patch);
export const getDisabledDomains = () => currentStore().disabledDomains();
export const addDisabledDomain = hostname => currentStore().setDomainDisabled(hostname, true);
export const removeDisabledDomain = hostname => currentStore().setDomainDisabled(hostname, false);
