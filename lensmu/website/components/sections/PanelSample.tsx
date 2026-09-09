"use client";

import Image from 'next/image';
import { useState } from 'react';

export function PanelSample() {
  const [translated, setTranslated] = useState(false);
  return <div className="panel-sample">
    <figure className="sample-sheet">
      <Image src={translated ? '/sample-panel-translated.svg' : '/sample-panel.svg'} width={720} height={860} priority alt={translated ? 'Original comic with English dialogue: Let’s get off at the next station. I want to explore a new town.' : 'Original comic with Japanese dialogue: 次の駅で降りよう。新しい町を見てみたい。'} />
      <figcaption>The last train · an original lensmu illustration</figcaption>
    </figure>
    <div className="comparison-controls" role="group" aria-label="Illustrated example language">
      <button type="button" aria-pressed={!translated} onClick={()=>setTranslated(false)}>Original</button>
      <button type="button" aria-pressed={translated} onClick={()=>setTranslated(true)}>English</button>
    </div>
    <p className="sample-note">Illustrated example with a prepared translation. No OCR or translation request is made.</p>
  </div>;
}
