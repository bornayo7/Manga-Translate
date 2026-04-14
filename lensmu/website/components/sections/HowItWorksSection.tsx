import { Languages, Layers3, ScanSearch, ScanText } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { howItWorks } from "@/data/site";

const stepIcons = {
  scan: ScanSearch,
  ocr: ScanText,
  translate: Languages,
  overlay: Layers3
};

export function HowItWorksSection() {
  return (
    <section id="workflow" className="bg-card section-padding">
      <div className="section-shell">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">How It Works</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
            From image text to readable translation in four steps.
          </h2>
          <p className="mt-5 text-base leading-8 text-muted-foreground">
            The extension turns visual content into translated page overlays
            with a clear OCR and AI pipeline.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {howItWorks.map((item) => {
            const Icon = stepIcons[item.icon as keyof typeof stepIcons];
            return (
              <Card
                key={item.step}
                className="animate-fade-up relative overflow-hidden shadow-soft"
              >
                <CardHeader>
                  <div className="mb-5 flex items-center justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-bold text-secondary">
                      {item.step}
                    </span>
                  </div>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
