"use client";

import { Mail, Send } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactLinks } from "@/data/site";

type FormState = {
  name: string;
  email: string;
  message: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const initialForm: FormState = {
  name: "",
  email: "",
  message: ""
};

export function ContactSection() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [success, setSuccess] = useState(false);

  function validate(values: FormState) {
    const nextErrors: FormErrors = {};

    if (values.name.trim().length < 2) {
      nextErrors.name = "Please enter your name.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      nextErrors.email = "Please enter a valid email address.";
    }

    if (values.message.trim().length < 10) {
      nextErrors.message = "Please write at least 10 characters.";
    }

    return nextErrors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setSuccess(false);
      return;
    }

    setSuccess(true);
    setForm(initialForm);
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSuccess(false);
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  return (
    <section id="contact" className="bg-card section-padding">
      <div className="section-shell">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow">Contact</p>
            <h2 className="mt-3 max-w-xl text-3xl font-bold leading-tight sm:text-4xl">
              Get in touch with VisionTranslate
            </h2>
            <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground">
              Send a message for business inquiries, collaboration, or product
              questions. We&apos;re building the future of in-context visual
              translation.
            </p>

            <div className="mt-8 grid gap-3">
              {contactLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Mail className="h-4 w-4" />
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <Card className="shadow-lift">
            <CardContent className="p-6 sm:p-8">
              <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    aria-invalid={Boolean(errors.name)}
                  />
                  {errors.name ? (
                    <p className="text-sm text-secondary">{errors.name}</p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    aria-invalid={Boolean(errors.email)}
                  />
                  {errors.email ? (
                    <p className="text-sm text-secondary">{errors.email}</p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    name="message"
                    placeholder="How can we help you?"
                    value={form.message}
                    onChange={(event) =>
                      updateField("message", event.target.value)
                    }
                    aria-invalid={Boolean(errors.message)}
                  />
                  {errors.message ? (
                    <p className="text-sm text-secondary">{errors.message}</p>
                  ) : null}
                </div>

                <Button type="submit" size="lg" className="w-full">
                  <Send className="h-5 w-5" />
                  Submit Message
                </Button>

                <p className="min-h-6 text-sm font-medium text-primary" aria-live="polite">
                  {success
                    ? "Thanks. Your message has been received by the VisionTranslate team."
                    : ""}
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
