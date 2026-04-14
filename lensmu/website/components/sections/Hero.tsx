import { CheckCircle2, Chrome, Play, Users } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { heroStats } from "@/data/site";

export function Hero() {
  return (
    <section
      id="home"
      className="relative isolate overflow-hidden bg-background text-foreground"
    >
      {/* Background gradients */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-background to-background" />
      <div className="absolute top-0 right-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-primary/20 blur-[100px] animate-pulse-slow" />
      <div className="absolute top-40 left-1/4 -z-10 h-[400px] w-[400px] rounded-full bg-secondary/15 blur-[120px] animate-pulse-slow" style={{ animationDelay: "2s" }} />

      <div className="section-shell pb-10 pt-14 sm:pb-12 sm:pt-16 lg:pb-14 lg:pt-20">
        <div className="mx-auto max-w-5xl text-center">
          <Badge variant="outline" className="mb-5 border-primary/20 bg-primary/5 text-primary">
            OCR + AI translation for visual text
          </Badge>

          <h1 className="animate-fade-up mx-auto max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-7xl">
            Translate image text right where it appears.
          </h1>

          <p className="animate-fade-up-delay mx-auto mt-6 max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg">
            VisionTranslate is a browser extension that detects
            foreign-language text inside webpage images and overlays the
            translation directly on the page.
          </p>

          <div className="animate-fade-up-delay-2 mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="default" size="lg" className="rounded-full px-8 shadow-glow transition-all hover:shadow-none hover:-translate-y-0.5" asChild>
              <a href="https://chrome.google.com/webstore" target="_blank" rel="noreferrer">
                <Chrome className="h-5 w-5" />
                Get Extension
              </a>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="rounded-full px-8 transition-all hover:-translate-y-0.5"
              asChild
            >
              <a href="/about">
                <Users className="h-5 w-5" />
                About Us
              </a>
            </Button>
          </div>
        </div>

        <div className="animate-fade-up-delay-2 mx-auto mt-16 max-w-5xl relative">
          <div className="absolute -inset-1 rounded-xl bg-gradient-to-tr from-primary/30 via-secondary/30 to-accent/30 blur-2xl opacity-50" />
          
          <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card shadow-lift ring-1 ring-border/50">
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-3 backdrop-blur">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-green-400" />
              <div className="mx-auto flex w-1/2 items-center justify-center rounded-md border border-border/50 bg-background/50 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                visiontranslate.app/manga-panel
              </div>
            </div>

            <div className="relative aspect-[16/8.2] min-h-[240px] overflow-hidden sm:min-h-[320px]">
              <Image
                src="https://images.unsplash.com/photo-1528164344705-47542687000d?auto=format&fit=crop&w=1400&q=80"
                alt="Browser mockup showing image text translated in place"
                fill
                priority
                sizes="(min-width: 1024px) 896px, 100vw"
                className="object-cover transition-transform duration-1000 hover:scale-105"
              />
              <div className="absolute inset-0 bg-neutral-950/10" />
              <div className="animate-preview-float absolute left-[6%] top-[10%] max-w-[42%] rounded-lg border border-border/50 bg-background/95 p-4 text-left text-sm font-medium leading-relaxed text-foreground shadow-lift backdrop-blur-sm">
                Original visual text detected
              </div>
              <div className="animate-preview-float absolute bottom-[14%] right-[6%] max-w-[48%] rounded-lg border border-primary/20 bg-primary p-4 text-left text-sm font-medium leading-relaxed text-primary-foreground shadow-glow" style={{ animationDelay: "2.5s" }}>
                Translation appears directly on the image
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {heroStats.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-border/50 bg-card p-6 text-left shadow-sm transition-all hover:shadow-md"
              >
                <p className="text-xl font-bold tracking-tight text-primary">{item.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
