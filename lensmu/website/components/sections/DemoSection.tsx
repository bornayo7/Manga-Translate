import Link from 'next/link';
export function DemoSection() {
  return <section className="reading-section demo-invitation"><div className="section-shell invitation-layout"><div><h2>Try it with your own image.</h2><p>The website demo reads JPG, PNG, and WEBP images with your local PaddleOCR or MangaOCR backend, then translates the text through MyMemory.</p></div><Link className="action-button secondary-action" href="/translate">Open image translator</Link></div></section>;
}
