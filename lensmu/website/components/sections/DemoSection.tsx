import { ArrowRight, ScanText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RevealOnScroll } from "@/components/ui/reveal-on-scroll";

export function DemoSection() {
  return (
    <section
      id="demo"
      className="relative overflow-hidden bg-muted/30 text-foreground section-padding"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="section-shell relative z-10">
        <RevealOnScroll className="mx-auto max-w-3xl text-center">
          <div>
            <p className="eyebrow">
              Product Showcase
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
              See the extension translate visual text in real time.
            </h2>
            <p className="mt-5 text-base leading-8 text-muted-foreground">
              This walkthrough shows VisionTranslate scanning a webpage image,
              extracting text with OCR, translating it, and placing the result
              directly over the original visual content.
            </p>
          </div>
        </RevealOnScroll>

        <RevealOnScroll
          delay="short"
          variant="scale-up"
          className="mx-auto mt-12 max-w-6xl"
        >
          <div className="group overflow-hidden rounded-xl border border-border/50 bg-card shadow-lift transition duration-500 hover:-translate-y-1 hover:border-primary/50">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border/50 bg-muted/50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-2 truncate text-xs font-medium text-muted-foreground">
                  VisionTranslate showcase playback
                </span>
              </div>
              <span className="hidden rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold sm:inline-flex">
                Production-ready tour
              </span>
            </div>

            <div className="relative aspect-video">
              <iframe
                src="https://www.youtube.com/embed/JS8v538aw2c"
                title="VisionTranslate product tour"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0 rounded-b-xl"
              />
            </div>

            <div className="grid gap-4 border-t border-border/50 bg-muted/20 p-5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="grid gap-3 sm:grid-cols-3">
                {["Scans images", "Runs OCR", "Overlays translation"].map(
                  (item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm"
                    >
                      <ScanText className="h-4 w-4 text-primary" />
                      {item}
                    </div>
                  )
                )}
              </div>
              <Button variant="default" size="lg" className="rounded-full shadow-glow" asChild>
                <a href="/contact">
                  See it in Action
                  <ArrowRight className="h-5 w-5 ml-2" />
                </a>
              </Button>
            </div>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}
