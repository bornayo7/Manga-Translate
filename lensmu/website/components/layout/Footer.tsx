import Link from 'next/link';
import { BrandLogo } from './BrandLogo';
import { projectGithub } from '@/data/site';
export function Footer() {
  return <footer className="site-footer"><div className="section-shell footer-layout"><div><BrandLogo /><p>Keep reading where the story happens.</p></div><nav aria-label="Footer"><Link href="/install">Installation guide</Link><Link href="/contact">Contact</Link><a href={projectGithub.href}>Project on GitHub</a></nav></div></footer>;
}
