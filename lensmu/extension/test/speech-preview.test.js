import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechPreviewSession} from '../src/popup/speech-preview.js';
const deferred = () => { let resolve; const promise = new Promise((accept) => {resolve=accept;}); return {promise,resolve}; };
function harness() {
 const pending=[]; const writes=[]; const sounds=[];
 const session=createSpeechPreviewSession({ensureSaved:async()=>{},sendMessage:()=>{const request=deferred();pending.push(request);return request.promise;},updateSetting:(...args)=>writes.push(args),createAudio:()=>{const sound={play:async()=>{},pause(){this.paused=true;}};sounds.push(sound);return sound;}});
 const settings={enableReadAloud:true,elevenLabsApiKey:'synthetic-a',elevenLabsVoiceId:'',targetLanguage:'en'};
 session.setSettings(settings); return {session,pending,writes,sounds,settings};
}
test('late voice-list result cannot overwrite a newer manual voice choice',async()=>{
 const {session,pending,writes,settings}=harness();
 const request=session.loadVoices();await Promise.resolve();
 session.setSettings({...settings,elevenLabsVoiceId:'user-choice'});
 pending[0].resolve({ok:true,body:{voices:[{voiceId:'old-default',name:'Old'}]}});await request;
 assert.deepEqual(writes,[]);assert.equal(session.state.loading,false);
});
test('account changes invalidate the previous voice list and preview request',async()=>{
 const {session,pending,sounds,settings}=harness();
 const voices=session.loadVoices();await Promise.resolve();pending[0].resolve({ok:true,body:{voices:[{voiceId:'first',name:'First'}]}});await voices;
 assert.equal(session.state.voices.length,1);
 const preview=session.testVoice();await Promise.resolve();session.setSettings({...settings,elevenLabsApiKey:'synthetic-b'});
 pending[1].resolve({ok:true,body:{audioDataUrl:'data:audio/mpeg;base64,AA=='}});await preview;
 assert.equal(sounds.length,0);assert.deepEqual(session.state.voices,[]);assert.equal(session.state.testing,false);
});
test('each synthesis setting change stops playing audio and disposal rejects late audio',async()=>{
 for(const key of ['elevenLabsModelId','elevenLabsOutputFormat','elevenLabsStability','elevenLabsSimilarityBoost','elevenLabsStyle','elevenLabsSpeed','targetLanguage']){
  const {session,pending,sounds,settings}=harness();
  const request=session.testVoice();await Promise.resolve();pending[0].resolve({ok:true,body:{audioDataUrl:'data:audio/mpeg;base64,AA=='}});await request;
  session.setSettings({...settings,[key]:'changed'});assert.equal(sounds[0].paused,true,key);
 }
 const {session,pending,sounds}=harness();const request=session.testVoice();await Promise.resolve();session.dispose();pending[0].resolve({ok:true,body:{audioDataUrl:'data:audio/mpeg;base64,AA=='}});await request;assert.equal(sounds.length,0);
});
