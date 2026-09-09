import { useEffect, useRef, useState } from 'react';
import { sendRuntimeMessage } from './runtime.js';
import { createSpeechPreviewSession } from './speech-preview.js';

export function useSpeechPreview(settings, ensureSaved, updateSetting) {
  const owner = useRef(null);
  if (!owner.current) owner.current = createSpeechPreviewSession({sendMessage: sendRuntimeMessage, ensureSaved, updateSetting});
  const [state, setState] = useState(owner.current.state);
  useEffect(() => {
    const session = owner.current;
    session.activate();
    const unsubscribe = session.subscribe(setState);
    return () => { unsubscribe(); session.dispose(); };
  }, []);
  useEffect(() => { owner.current.setSettings(settings); }, [settings]);
  return {...state, loadVoices: owner.current.loadVoices, testVoice: owner.current.testVoice};
}
