import { ArrowRight } from "lucide-react";
import Image from "next/image";

import { Card, CardContent } from "@/components/ui/card";
import { useCases } from "@/data/site";

export function UseCasesSection() {
  return (
    <section id="use-cases" className="bg-background section-padding">
      <div className="section-shell">
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">Use Cases</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
              Built for the image-heavy parts of the internet.
            </h2>
          </div>
          <a
            href="#demo"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary transition-colors hover:text-primary/80"
          >
            Watch it translate
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((useCase) => (
            <Card
              key={useCase.title}
              className="animate-fade-up overflow-hidden shadow-soft transition-transform hover:-translate-y-1"
            >
              <div className="relative h-48 w-full">
                <Image
                  src={useCase.image}
                  alt={useCase.alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold">{useCase.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {useCase.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
