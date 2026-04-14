import { BadgeCheck, ImageOff, Layers3 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const productPoints = [
  {
    title: "The problem",
    description:
      "Browser translators miss text that is baked into images, screenshots, manga panels, signs, menus, and scanned pages.",
    icon: ImageOff
  },
  {
    title: "The solution",
    description:
      "VisionTranslate combines OCR, AI translation, and a browser overlay so visual text becomes readable in context.",
    icon: BadgeCheck
  },
  {
    title: "The experience",
    description:
      "Users stay on the page, click the extension, and see translations placed over the original image regions.",
    icon: Layers3
  }
];

export function AboutSection() {
  return (
    <section id="product" className="bg-background section-padding">
      <div className="section-shell">
        <div className="grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="eyebrow">What The Product Does</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
              It translates the text normal browser translators cannot reach.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground">
              VisionTranslate is built for the visual web: pages where important
              words live inside images instead of HTML text. It turns those
              image regions into translated, readable content without making the
              user leave the page.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3 lg:grid-cols-1">
            {productPoints.map((point) => {
              const Icon = point.icon;
              return (
                <Card
                  key={point.title}
                  className="animate-fade-up border-l-4 border-l-primary shadow-soft"
                >
                  <CardHeader className="flex-row gap-4 space-y-0">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <CardTitle>{point.title}</CardTitle>
                      <CardDescription className="mt-2">
                        {point.description}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>

        <Card className="mt-12 overflow-hidden border-primary/25 bg-card shadow-soft">
          <CardContent className="grid gap-6 p-6 md:grid-cols-3 md:p-8">
            {[
              ["Use it for", "Manga, screenshots, signs, menus, documents"],
              ["Powered by", "OCR detection, AI translation, page overlays"],
              ["Designed for", "Production use cases, real browsing, visual content"]
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-sm font-semibold uppercase text-primary">
                  {label}
                </p>
                <p className="mt-2 text-lg font-semibold leading-7">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
