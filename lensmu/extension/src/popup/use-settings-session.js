import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_EXTENSION_SETTINGS, mergeWithDefaults } from '../../shared/preferences.js';
import { DEFAULT_LLM_MODELS, describeModelMigration, resolveProviderModel } from '../../shared/llm-models.js';
import { createSettingsPersister } from './settings-persistence.js';
import { sendRuntimeMessage } from './runtime.js';

export function useSettingsSession() {
  const persister = useRef(null);
  if (!persister.current) persister.current = createSettingsPersister({ sendMessage: sendRuntimeMessage });
  const [settings, setSettings] = useState(DEFAULT_EXTENSION_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState(persister.current.state);
  const [migrationNotices, setMigrationNotices] = useState([]);
  const [reload, setReload] = useState(0);

  useEffect(() => persister.current.subscribe(setSaveState), []);
  useEffect(() => {
    let active = true;
    setLoadError('');
    sendRuntimeMessage({ action: 'GET_SETTINGS' }).then((answer) => {
      if (!active) return;
      if (!answer?.settings || answer.success === false) throw new Error(answer?.error || 'Settings could not be loaded.');
      const next = mergeWithDefaults(answer.settings);
      const patch = {};
      const notices = [];
      if (next.translationProvider === 'google') {
        next.translationProvider = 'libre';
        patch.translationProvider = 'libre';
        notices.push('Google Cloud Translation was removed; MyMemory is selected.');
      }
      const migration = describeModelMigration(next.translationProvider, next.llmModel);
      if (migration) {
        next.llmModel = resolveProviderModel(next.translationProvider, next.llmModel);
        patch.llmModel = next.llmModel;
        notices.push(`The saved model ${migration.from} is replaced by ${next.llmModel} for this provider.`);
      }
      setSettings(next);
      setMigrationNotices(notices);
      if (Object.keys(patch).length) persister.current.queuePatch(patch);
      setLoaded(true);
    }).catch((error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => { document.documentElement.classList.toggle('dark', settings.darkMode); }, [settings.darkMode]);
  const updatePatch = useCallback((patch) => {
    setSettings((previous) => ({ ...previous, ...patch }));
    persister.current.queuePatch(patch);
  }, []);
  const updateSetting = (key, value) => updatePatch({ [key]: value });
  const updateProvider = (provider) => {
    updatePatch({ translationProvider: provider, llmModel: DEFAULT_LLM_MODELS[provider] || settings.llmModel });
    setMigrationNotices([]);
  };
  return {
    settings, loaded, loadError, saveState, migrationNotices, updateSetting, updatePatch, updateProvider,
    clearNotices: () => setMigrationNotices([]),
    retryLoad: () => setReload((count) => count + 1),
    ensureSaved: () => persister.current.saveNow(),
  };
}
