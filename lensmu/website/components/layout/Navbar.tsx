"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AuthButtons } from '@/components/auth/AuthButtons';
import { BrandLogo } from './BrandLogo';
import { navLinks } from '@/data/site';

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    let preferred = window.matchMedia('(prefers-color-scheme: dark)').matches;
    try { const saved = window.localStorage.getItem('visiontranslate-theme'); if(saved) preferred=saved==='dark'; } catch { /* Theme remains usable without storage. */ }
    const frame = requestAnimationFrame(()=>{ document.documentElement.classList.toggle('dark',preferred); setDark(preferred); });
    return ()=>cancelAnimationFrame(frame);
  }, []);
  function changeTheme() {
    const next=!dark; setDark(next); document.documentElement.classList.toggle('dark',next);
    try { localStorage.setItem('visiontranslate-theme',next?'dark':'light'); } catch { /* Session preference still applies. */ }
  }
  const links = navLinks.map((link)=><Link key={link.href} href={link.href} aria-current={pathname===link.href?'page':undefined} onClick={()=>setOpen(false)}>{link.label}</Link>);
  return <header className="site-header" onKeyDown={(event)=>{ if(event.key==='Escape' && open) { setOpen(false); toggle.current?.focus(); } }}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className="section-shell site-masthead">
      <Link href="/" aria-label="lensmu home"><BrandLogo /></Link>
      <nav className="desktop-navigation" aria-label="Main navigation">{links}</nav>
      <div className="desktop-actions"><AuthButtons /><button className="theme-button" type="button" onClick={changeTheme} aria-label={dark?'Use light theme':'Use dark theme'}>{dark?'Light':'Dark'}</button></div>
      <button ref={toggle} type="button" className="menu-toggle" aria-expanded={open} aria-controls="mobile-menu" onClick={()=>setOpen(!open)}>{open?'Close':'Menu'}</button>
    </div>
    {open ? <div id="mobile-menu" className="mobile-menu"><nav aria-label="Mobile navigation">{links}</nav><div className="mobile-actions"><AuthButtons /><button className="theme-button" onClick={changeTheme}>{dark?'Use light theme':'Use dark theme'}</button></div></div> : null}
  </header>;
}
