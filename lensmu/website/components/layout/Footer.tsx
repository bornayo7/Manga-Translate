import { BrandLogo } from "@/components/layout/BrandLogo";
import { contactLinks, navLinks } from "@/data/site";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-neutral-950 text-white/90">
      <div className="section-shell py-10 sm:py-12">
        <div className="grid gap-8 border-b border-white/10 pb-8 md:grid-cols-[1.3fr_0.9fr_0.9fr] md:items-start">
          <div>
            <BrandLogo inverse className="mb-3" />
            <p className="max-w-sm text-sm leading-6 text-white/65">
              Translate text inside webpage images with OCR and AI.
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Explore</h3>
            <div className="grid gap-2">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm text-white/65 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Connect</h3>
            <div className="grid gap-2">
              {contactLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                  className="text-sm text-white/65 transition-colors duration-200 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-5 text-sm text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>VisionTranslate for the visual web.</p>
          <p className="text-white/35">© 2026 VisionTranslate</p>
        </div>
      </div>
    </footer>
  );
}
