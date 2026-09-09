import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationSession } from './translation-session.js';

const result = () => ({ blob: new Blob(['image']), blocks: [{text:'source'}], rendered:1 });
test('cancellation prevents late progress, result publication, and URL allocation', async () => {
  const states=[]; let resolve; let options; let urls=0;
  const session=createTranslationSession({translate:(input)=>{options=input; return new Promise(done=>{resolve=done;});},publish:(state)=>states.push(state),createUrl:()=>{urls++; return 'blob:test';}});
  const request=session.run({});
  session.cancel();
  assert.equal(options.signal.aborted,true);
  options.onProgress('rendering','late');
  resolve(result()); await request;
  assert.equal(states.at(-1).phase,'idle'); assert.equal(urls,0);
});
test('new request owns the display and disposal revokes the accepted URL', async () => {
  const requests=[]; const states=[]; const revoked=[];
  const session=createTranslationSession({translate:()=>new Promise(resolve=>requests.push(resolve)),publish:(state)=>states.push(state),createUrl:()=> 'blob:accepted',revokeUrl:(url)=>revoked.push(url)});
  const first=session.run({}); const second=session.run({});
  requests[1](result()); await second;
  requests[0](result()); await first;
  assert.equal(states.filter((state)=>state.phase==='done').length,1);
  session.dispose(); assert.deepEqual(revoked,['blob:accepted']);
});
test('failure preserves the provider message without a successful result',async()=>{
  const states=[];
  const session=createTranslationSession({translate:async()=>{throw new Error('quota exceeded');},publish:(state)=>states.push(state)});
  await session.run({});
  assert.equal(states.at(-1).phase,'error'); assert.equal(states.at(-1).error,'quota exceeded'); assert.equal(states.at(-1).result,null);
});
