import { Github, Linkedin } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { teamMembers } from "@/data/site";

export function TeamSection() {
  return (
    <section id="team" className="bg-background section-padding">
      <div className="section-shell">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">About Us</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
            Built by a product-minded engineering team.
          </h2>
          <p className="mt-5 text-base leading-8 text-muted-foreground">
            A cross-functional group bringing together extension engineering,
            OCR, backend systems, and product design.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {teamMembers.map((member) => (
            <Card key={member.name} className="animate-fade-up flex h-full flex-col shadow-soft">
              <CardHeader>
                <div className="relative mb-5 h-20 w-20">
                  {member.avatarUrl ? (
                    <Image
                      src={member.avatarUrl}
                      alt={`${member.name} profile photo`}
                      fill
                      sizes="80px"
                      className="rounded-lg object-cover shadow-soft"
                    />
                  ) : (
                    <div className="grid h-20 w-20 place-items-center rounded-lg bg-primary text-xl font-bold text-primary-foreground shadow-soft">
                      {member.initials}
                    </div>
                  )}
                  {member.linkedin ? (
                    <a
                      href={member.linkedin}
                      aria-label={`${member.name} LinkedIn profile`}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute -bottom-2 -right-2 grid h-8 w-8 place-items-center rounded-md border border-card bg-[#0a66c2] text-white shadow-sm transition-transform hover:scale-105"
                    >
                      <Linkedin className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
                <CardTitle>
                  {member.linkedin ? (
                    <a
                      href={member.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors hover:text-primary"
                    >
                      {member.name}
                    </a>
                  ) : (
                    member.name
                  )}
                </CardTitle>
                <CardDescription className="font-semibold text-primary">
                  {member.role}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <p className="text-sm leading-6 text-muted-foreground">
                  {member.bio}
                </p>
                <div className="mt-auto pt-5 flex flex-wrap gap-2">
                  {member.github ? (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={member.github}
                        aria-label={`${member.name} GitHub`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Github className="h-4 w-4" />
                        GitHub
                      </a>
                    </Button>
                  ) : null}
                  {member.linkedin ? (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={member.linkedin}
                        aria-label={`${member.name} LinkedIn`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Linkedin className="h-4 w-4" />
                        LinkedIn
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
