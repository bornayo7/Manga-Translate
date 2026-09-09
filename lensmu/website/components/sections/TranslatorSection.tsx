"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { translateImage, type OcrEngine } from '@/lib/translator';
import { validateImageFile } from '@/lib/image-input';
import { createTranslationSession, type DemoState } from '@/lib/translation-session.js';
import { PanelSample } from './PanelSample';

const LANGUAGES = [['ja','Japanese'],['en','English'],['es','Spanish'],['fr','French'],['zh','Chinese'],['ko','Korean'],['de','German']];
const INITIAL: DemoState = {phase:'idle',detail:'',error:'',result:null};

export function TranslatorSection() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [sourceLang, setSourceLang] = useState('ja');
  const [targetLang, setTargetLang] = useState('en');
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>('paddleocr');
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000');
  const [state, setState] = useState<DemoState>(INITIAL);
  const [inputError, setInputError] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const session = useRef<ReturnType<typeof createTranslationSession> | null>(null);
  useEffect(() => {
    session.current = createTranslationSession({translate: translateImage, publish: setState});
    return () => { session.current?.dispose(); session.current = null; };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (state.phase === 'done' || state.phase === 'error') resultHeading.current?.focus(); }, [state.phase]);
  const busy = !['idle','done','error'].includes(state.phase);
  const result = state.result;
  function selectFile(next: File) {
    try {
      validateImageFile(next);
      session.current?.cancel();
      setFile(next); setPreview(URL.createObjectURL(next)); setInputError(''); setState(INITIAL); setShowOriginal(false);
    } catch (error) { setInputError((error as Error).message); }
  }
  function reset() {
    session.current?.cancel(); setFile(null); setPreview(''); setState(INITIAL); setInputError('');
    if (fileInput.current) fileInput.current.value = '';
    fileInput.current?.focus();
  }
  return <section className="reading-section demo-section">
    <div className="section-shell">
      <header className="page-intro">
        <h1>Make the image readable.</h1>
        <p>Try an illustrated sample below, or translate a JPG, PNG, or WEBP with your local OCR backend. Extracted text is sent to MyMemory.</p>
        <Link href="/install#local-demo" className="text-link">Set up the local demo</Link>
      </header>
      <div className="demo-workspace">
        <div className="demo-image-column">
          {file && preview ? <figure className="image-sheet">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result && !showOriginal ? result.url : preview} alt={result && !showOriginal ? 'Image with translated text. Read the transcript below for text content.' : 'Original uploaded image'} />
            <figcaption>{result && !showOriginal ? `${result.rendered} regions redrawn; ${result.skipped} unchanged.` : file.name}</figcaption>
          </figure> : <PanelSample />}
          {result ? <div className="comparison-controls" role="group" aria-label="Image view">
            <button aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>Original</button>
            <button aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>Translation</button>
          </div> : null}
        </div>
        <div className="demo-controls">
          <div className="upload-field" onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{ event.preventDefault(); if (!busy && event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]); }}>
            <label htmlFor="image-file">Choose your image</label>
            <input id="image-file" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event)=>{ if (event.target.files?.[0]) selectFile(event.target.files[0]); }} aria-describedby="image-limits" />
            <p id="image-limits">Drop a file here, or browse. Up to 10 MB, 16 megapixels, and 16,384 pixels on either side.</p>
          </div>
          {inputError ? <p className="error-note" role="alert">{inputError}</p> : null}
          <fieldset disabled={busy} className="demo-settings">
            <legend>Translation direction</legend>
            <div className="language-pair">
              <label htmlFor="source-lang">Source<select id="source-lang" value={sourceLang} onChange={(event)=>setSourceLang(event.target.value)}>
                {LANGUAGES.map(([id,name])=><option key={id} value={id} disabled={ocrEngine==='mangaocr' && id!=='ja'}>{name}</option>)}
              </select></label>
              <label htmlFor="target-lang">Translate to<select id="target-lang" value={targetLang} onChange={(event)=>setTargetLang(event.target.value)}>
                {LANGUAGES.map(([id,name])=><option key={id} value={id}>{name}</option>)}
              </select></label>
            </div>
            <label htmlFor="ocr-engine">Read text with<select id="ocr-engine" value={ocrEngine} onChange={(event)=>setOcrEngine(event.target.value as OcrEngine)}>
              <option value="paddleocr">PaddleOCR</option>
              <option value="mangaocr" disabled={sourceLang!=='ja'}>MangaOCR · Japanese only</option>
            </select></label>
            <p className="field-note">OCR runs on your local backend (port 8000 by default). Translation uses the free MyMemory service, which has a limited daily quota. The extension also supports other engines and providers.</p>
            <details><summary>Local OCR server address</summary><label htmlFor="backend-address">Server URL<input id="backend-address" className="server-address" type="url" value={backendUrl} onChange={(event)=>setBackendUrl(event.target.value)} /></label><p className="field-note">Image pixels are sent to this address. Change it if your local backend uses another port.</p></details>
          </fieldset>
          {busy ? <button className="action-button secondary-action" onClick={()=>session.current?.cancel()}>Cancel translation</button> : <button className="action-button" disabled={!file} onClick={()=>{ if (file) { setShowOriginal(false); void session.current?.run({file,ocrEngine,sourceLang,targetLang,backendUrl}); } }}>Translate image</button>}
          <div className="request-status" role="status" aria-live="polite" aria-atomic="true">
            {busy ? <><span className="status-mark" aria-hidden="true" />{state.detail || 'Translating…'}</> : state.phase==='idle' ? state.detail : null}
          </div>
          {state.phase==='error' ? <div className="error-note"><h2 ref={resultHeading} tabIndex={-1}>Translation did not complete</h2><p>{state.error}</p><p>Check the language and local backend, then try again. Your image is still selected.</p></div> : null}
          {result ? <div className="result-summary">
            <h2 ref={resultHeading} tabIndex={-1}>{result.skipped ? 'Partially translated' : 'Translation ready'}</h2>
            <p>{state.detail}. {LANGUAGES.find(([id])=>id===result.sourceLang)?.[1]} → {LANGUAGES.find(([id])=>id===result.targetLang)?.[1]}.</p>
            {result.warnings.length ? <ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul> : null}
            <a className="action-button" href={result.url} download={`${file?.name.replace(/\.[^.]+$/,'') || 'image'}-translated.png`}>Download translated PNG</a>
          </div> : null}
          {file && !busy ? <button className="text-link plain-button" onClick={reset}>Choose another image</button> : null}
        </div>
      </div>
      {result ? <section className="transcript" aria-labelledby="transcript-heading">
        <h2 id="transcript-heading">Readable transcript</h2>
        <p>Every recognized region is included, including translations that could not fit in the image.</p>
        <ol>{result.blocks.map((block,index)=><li key={index}>
          <p lang={result.sourceLang} className="source-text">{block.text}</p>
          {result.translations[index] ? <p lang={result.targetLang}>{result.translations[index]}</p> : <p className="error-note">No usable translation returned.</p>}
          {result.regions[index]?.status==='skipped' ? <p className="field-note">Original image region kept: {result.regions[index].reason==='translation-failed' ? 'translation failed' : result.regions[index].reason==='too-small' ? 'region too small' : 'translation does not fit'}.</p> : null}
        </li>)}</ol>
      </section> : null}
    </div>
  </section>;
}
