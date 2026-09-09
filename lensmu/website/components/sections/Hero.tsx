import Link from 'next/link';
import { PanelSample } from './PanelSample';

export function Hero() {
  return <section className="reading-hero">
    <div className="section-shell hero-layout">
      <div className="hero-copy">
        <h1>Read the next panel.</h1>
        <p>lensmu translates text inside webpage images, so you can keep reading where the story happens.</p>
        <div className="hero-actions"><Link href="/install" className="action-button">Install the extension</Link><Link href="/translate" className="text-link">Try the local demo</Link></div>
        <p className="setup-note">Chrome extension · local installation<br />Choose an OCR engine and translation provider.</p>
      </div>
      <PanelSample />
    </div>
  </section>;
}
