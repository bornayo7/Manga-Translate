import { hashText } from './image-preparation.js';

// One audible selection across the page, including pending synthesis/play().
export function createReadAloud({ Audio, send, crypto }) {
  let selection = null;
  function stop(owner = null) {
    if (owner && selection?.owner !== owner) return;
    const previous = selection;
    selection = null;
    if (!previous) return;
    previous.controller.abort();
    previous.audio?.pause();
    previous.owner.speechState('stopped');
  }
  return {
    stop,
    async play(owner, data) {
      if (selection?.owner === owner) { stop(); return; }
      stop();
      const request = { owner, controller: new AbortController(), audio: null };
      selection = request;
      const accepted = () => selection === request && owner.connected();
      owner.speechState('generating');
      try {
        const translationHash = await hashText(crypto, `${data.targetLanguage}::${data.speechText}`);
        if (!accepted()) return;
        const response = await send('GENERATE_READ_ALOUD_AUDIO', {
          text: data.speechText,
          language: data.targetLanguage,
          imageFingerprint: data.imageFingerprint,
          translationHash
        }, request.controller.signal);
        if (!accepted()) return;
        if (!response?.ok || !response.body?.audioDataUrl) throw new Error(response?.body?.error || 'No speech audio was returned.');
        const audio = new Audio();
        request.audio = audio;
        audio.src = response.body.audioDataUrl;
        audio.onended = () => { if (accepted()) stop(); };
        audio.onerror = () => {
          if (accepted()) { stop(); owner.speechState('error', 'Playback failed.'); }
        };
        owner.speechState('playing');
        await audio.play();
        if (!accepted()) audio.pause();
      } catch (error) {
        if (!accepted()) return;
        stop();
        if (error?.name !== 'AbortError') owner.speechState('error', error?.message || String(error));
      }
    }
  };
}
