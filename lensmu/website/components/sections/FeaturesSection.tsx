import {
  FileText,
  Image as ImageIcon,
  Languages,
  MonitorSmartphone,
  ScanText,
  Sparkles
} from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { features } from "@/data/site";

const iconMap = {
  scan: ScanText,
  languages: Languages,
  image: ImageIcon,
  browser: MonitorSmartphone,
  sparkles: Sparkles,
  file: FileText
};

export function FeaturesSection() {
  return (
    <section id="features" className="border-y border-border bg-card section-padding">
      <div className="section-shell">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Features</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
            Everything needed for seamless, real-world browser translation.
          </h2>
          <p className="mt-5 text-base leading-8 text-muted-foreground">
            VisionTranslate combines page scanning, image OCR, translation, and
            visual overlays into a clean extension workflow.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = iconMap[feature.icon as keyof typeof iconMap];
            return (
              <Card key={feature.title} className="animate-fade-up shadow-soft transition-transform hover:-translate-y-1">
                <CardHeader>
                  <span className="mb-4 grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
