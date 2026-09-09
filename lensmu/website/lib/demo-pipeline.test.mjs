import test from 'node:test';
import assert from 'node:assert/strict';
import { importProduction } from './test-import.mjs';

const { recognizeImage } = await importProduction('demo-ocr.ts');
const { renderTranslatedImage } = await importProduction('image-renderer.ts');
const { translateImage } = await importProduction('translator.ts');
const { translateTexts } = await importProduction('demo-translation.ts');
const { validateImageDimensions } = await importProduction('image-input.ts');

test('demo dimension boundaries match the backend before image upload',()=>{
  assert.doesNotThrow(()=>validateImageDimensions(4000,4000));
  assert.doesNotThrow(()=>validateImageDimensions(16384,1));
  for (const [width,height] of [[4001,4000],[16385,1],[1,16385],[0,100],[NaN,100]]) {
    assert.throws(()=>validateImageDimensions(width,height),/16 megapixels/);
  }
});

test('malformed HTTP 200 OCR responses are invalid responses, not empty images',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('{broken',{headers:{'Content-Type':'application/json'}}));
  await assert.rejects(()=>recognizeImage('pixels','paddleocr','http://localhost:8000','ja'),/response|JSON|object|detections/i);
});
test('MangaOCR mismatch and identical language choices fail before file/network work',async()=>{
  await assert.rejects(()=>recognizeImage('pixels','mangaocr','http://localhost:8000','fr'),/Japanese only/);
  const file=new File(['pixels'],'test.png',{type:'image/png'});
  await assert.rejects(()=>translateImage({file,ocrEngine:'paddleocr',sourceLang:'en',targetLang:'en'}),/different/);
});
function canvasAdapter() {
  const painted=[]; const erased=[];
  const canvas={width:0,height:0,toBlob(callback){callback(new Blob(['png']));}};
  const context={canvas,drawImage(){},measureText(text){return {width:[...text].length*5};},getImageData(){return {data:[255,255,255,255]};},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){erased.push(1);},strokeText(){},fillText(text){painted.push(text);}};
  canvas.getContext=()=>context;
  return {canvas,painted,erased};
}
test('all geometrically skipped regions reject instead of exporting the source image',async()=>{
  const adapter=canvasAdapter();
  await assert.rejects(()=>renderTranslatedImage({naturalWidth:100,naturalHeight:100},[{text:'元',bbox:[1,1,6,6]}],['Hello'],undefined,()=>adapter.canvas),/No translated regions/);
  assert.equal(adapter.erased.length,0);
});
test('mixed outcomes account for every region and preserve whole vertical graphemes',async()=>{
  const adapter=canvasAdapter();
  const result=await renderTranslatedImage({naturalWidth:400,naturalHeight:400},[{text:'元',bbox:[1,1,6,6]},{text:'text',bbox:[20,20,220,350],orientation:'vertical'}],['Hello','日😀本'],undefined,()=>adapter.canvas);
  assert.equal(result.rendered,1); assert.equal(result.skipped,1); assert.equal(result.regions.length,2);
  assert.ok(adapter.painted.includes('😀'));
  assert.equal(adapter.painted.some((text)=>/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(text)),false);
});
test('aborted rendering never erases pixels or exports an image',async()=>{
  const adapter=canvasAdapter();
  const controller=new AbortController(); controller.abort();
  await assert.rejects(()=>renderTranslatedImage({naturalWidth:400,naturalHeight:400},[{text:'a',bbox:[20,20,220,300]}],['Hello'],controller.signal,()=>adapter.canvas),{name:'AbortError'});
  assert.equal(adapter.erased.length,0);
});
test('mixed provider source echoes remain untranslated and never erase their pixels',async(t)=>{
  const responses=['Hello','世界'];
  t.mock.method(globalThis,'fetch',async()=>Response.json({responseStatus:200,responseData:{translatedText:responses.shift()}}));
  const translations=await translateTexts(['こんにちは','世界'],'ja','en');
  assert.deepEqual(translations,['Hello','']);
  const adapter=canvasAdapter();
  const result=await renderTranslatedImage({naturalWidth:400,naturalHeight:400},[{text:'こんにちは',bbox:[10,10,210,100]},{text:'世界',bbox:[10,150,210,250]}],translations,undefined,()=>adapter.canvas);
  assert.equal(result.rendered,1); assert.equal(adapter.erased.length,1);
  assert.deepEqual(result.regions[1],{index:1,status:'skipped',reason:'translation-failed'});
  assert.equal(adapter.painted.some(text=>text.includes('世界')),false);
});
test('malformed provider text cannot become a rendered object string',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({responseStatus:200,responseData:{translatedText:{unexpected:'object'}}}));
  await assert.rejects(()=>translateTexts(['こんにちは'],'ja','en'),/invalid|text|string/i);
});
