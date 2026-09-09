// Owns voice-list and preview lifetimes independently of React rendering.
const PREVIEW_KEYS = ['enableReadAloud', 'elevenLabsApiKey', 'elevenLabsVoiceId', 'elevenLabsModelId', 'elevenLabsOutputFormat', 'elevenLabsStability', 'elevenLabsSimilarityBoost', 'elevenLabsStyle', 'elevenLabsSpeed', 'elevenLabsUseSpeakerBoost', 'targetLanguage'];
export function createSpeechPreviewSession({sendMessage, ensureSaved, updateSetting, createAudio = (url) => new Audio(url)}) {
  let settings = {};
  let active = true;
  let generation = 0;
  let loadRevision = 0;
  let testRevision = 0;
  let audio = null;
  let state = {voices: [], status: '', loading: false, testing: false};
  const listeners = new Set();
  const publish = (patch) => { state = {...state, ...patch}; if (active) listeners.forEach((listener) => listener(state)); };
  const stopAudio = () => { if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio = null; } };
  function setSettings(next) {
    const changed = PREVIEW_KEYS.some((key) => !Object.is(settings[key], next[key]));
    const keyChanged = settings.elevenLabsApiKey !== next.elevenLabsApiKey;
    settings = {...next};
    if (!changed) return;
    generation += 1;
    stopAudio();
    publish({status: '', loading: false, testing: false, ...(keyChanged ? {voices: []} : {})});
  }
  async function loadVoices() {
    const request = ++loadRevision;
    const epoch = generation;
    const isCurrent = () => active && epoch === generation && request === loadRevision;
    publish({loading: true, status: ''});
    try {
      await ensureSaved();
      if (!isCurrent()) return;
      const answer = await sendMessage({action: 'LOAD_ELEVENLABS_VOICES'});
      if (!isCurrent()) return;
      if (!answer?.ok) throw new Error(answer?.body?.error || 'Voices could not be loaded.');
      const voices = answer.body?.voices;
      if (!Array.isArray(voices) || voices.some((voice) => typeof voice?.voiceId !== 'string' || typeof voice?.name !== 'string')) throw new Error('The provider returned an invalid voice list.');
      publish({voices, status: voices.length ? `${voices.length} voices loaded.` : 'No voices are available for this account.'});
      if (!settings.elevenLabsVoiceId && voices[0]?.voiceId) updateSetting('elevenLabsVoiceId', voices[0].voiceId);
    } catch (error) { if (isCurrent()) publish({status: error.message}); }
    finally { if (isCurrent()) publish({loading: false}); }
  }
  async function testVoice() {
    const request = ++testRevision;
    const epoch = generation;
    const isCurrent = () => active && epoch === generation && request === testRevision;
    stopAudio(); publish({testing: true, status: 'Preparing preview…'});
    try {
      await ensureSaved();
      if (!isCurrent()) return;
      const answer = await sendMessage({action: 'TEST_ELEVENLABS_VOICE', payload: {text: 'This is a lensmu read aloud test.', language: settings.targetLanguage}});
      if (!isCurrent()) return;
      if (!answer?.ok || typeof answer.body?.audioDataUrl !== 'string') throw new Error(answer?.body?.error || 'Audio could not be generated.');
      const preview = createAudio(answer.body.audioDataUrl);
      audio = preview;
      preview.onended = () => { if (isCurrent()) publish({status: 'Preview finished.', testing: false}); };
      preview.onerror = () => { if (isCurrent()) publish({status: 'Preview playback failed.', testing: false}); };
      await preview.play();
      if (isCurrent()) publish({status: 'Playing preview…'}); else preview.pause();
    } catch (error) { if (isCurrent()) publish({status: error.message, testing: false}); }
  }
  return {
    get state() { return state; }, setSettings, loadVoices, testVoice,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    activate() { active = true; },
    dispose() { active = false; generation += 1; stopAudio(); listeners.clear(); },
  };
}
