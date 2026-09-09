import Link from 'next/link';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Install lensmu', description: 'Install the Chrome extension locally and configure OCR and translation.' };
export default function InstallPage() {
  return <main id="main-content" className="reading-section"><div className="section-shell guide-page">
    <h1>Set up lensmu.</h1><p className="lead">Install the Chrome extension from this project. A Chrome Web Store listing is not available yet.</p>
    <ol className="install-steps">
      <li><h2>Get the project</h2><p>Download or clone the <a className="text-link" href="https://github.com/bornayo7/Manga-Translate">lensmu repository on GitHub</a>. Install Node.js 20.19 or newer.</p><pre><code>git clone https://github.com/bornayo7/Manga-Translate.git</code></pre></li>
      <li><h2>Build the extension</h2><pre><code>{'cd Manga-Translate/lensmu/extension\nnpm ci\nnpm run build'}</code></pre></li>
      <li><h2>Load it in Chrome</h2><p>Open <code>chrome://extensions</code>, enable Developer mode, choose <strong>Load unpacked</strong>, and select <code>lensmu/extension</code>, the directory containing <code>manifest.json</code>. Pin lensmu to your toolbar.</p></li>
      <li><h2>Choose an engine</h2><p>Tesseract runs in the browser. PaddleOCR and MangaOCR need the local backend; Google Vision needs your own key. Choose your languages and translation provider in the popup. MyMemory has no key requirement and a limited daily quota.</p></li>
      <li><h2>Translate an image</h2><p>Open an ordinary webpage, turn on image controls, and click a panel or choose <strong>Translate this page</strong>. Browser settings pages and the Chrome store do not allow extension scripts.</p></li>
    </ol>
    <section id="local-demo" className="guide-section"><h2>Run the local demo</h2><p>The website translator expects OCR at <code>http://localhost:8000</code>. Follow the repository’s <a className="text-link" href="https://github.com/bornayo7/Manga-Translate/blob/main/lensmu/backend/README.md">backend setup instructions</a> for the supported installation profile.</p><pre><code>{'cd lensmu/backend\npython server.py'}</code></pre><p>Start this website locally in another terminal:</p><pre><code>{'cd lensmu/website\nnpm ci\nnpm run dev'}</code></pre><p>Open <code>http://localhost:3000/translate</code>. Your browser sends pixels to the local backend and extracted text to MyMemory. Account sync is not enabled in this build.</p><Link className="action-button" href="/translate">Open image translator</Link></section>
  </div></main>;
}
