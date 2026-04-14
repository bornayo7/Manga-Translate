"use client";

import { Github, Menu, Moon, Sun, X, ChevronRight, Chrome } from "lucide-react";
import { useEffect, useState } from "react";

import { AuthButtons } from "@/components/auth/AuthButtons";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { Button } from "@/components/ui/button";
import { navLinks, projectGithub } from "@/data/site";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("visiontranslate-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseDark = savedTheme ? savedTheme === "dark" : prefersDark;

    document.documentElement.classList.toggle("dark", shouldUseDark);
    setDarkMode(shouldUseDark);
  }, []);

  function toggleTheme() {
    const nextDarkMode = !darkMode;
    document.documentElement.classList.toggle("dark", nextDarkMode);
    window.localStorage.setItem(
      "visiontranslate-theme",
      nextDarkMode ? "dark" : "light"
    );
    setDarkMode(nextDarkMode);
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl transition-all">
      <nav className="section-shell flex h-16 items-center">
        {/* Left: Logo */}
        <div className="flex flex-1 items-center justify-start">
          <a
            href="/"
            className="flex items-center gap-2 transition-transform hover:scale-[1.02]"
            aria-label="VisionTranslate home"
          >
            <BrandLogo />
          </a>
        </div>

        {/* Center: Navigation (Desktop) */}
        <div className="hidden md:flex items-center justify-center gap-1 rounded-full border border-border/40 bg-muted/20 px-2 py-1 backdrop-blur-md">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Right: Actions (Desktop) */}
        <div className="hidden flex-1 items-center justify-end gap-3 md:flex">
          <AuthButtons />
          <Button
            variant="ghost"
            className="h-10 w-10 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
          >
            {darkMode ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>
          <Button variant="dark" className="rounded-full px-5 shadow-sm" asChild>
            <a href="https://chrome.google.com/webstore" target="_blank" rel="noreferrer">
              <Chrome className="h-4 w-4" />
              Get Extension
            </a>
          </Button>
          <Button variant="outline" className="rounded-full px-5 shadow-sm" asChild>
            <a href={projectGithub.href} target="_blank" rel="noreferrer">
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </Button>
        </div>

        {/* Mobile Toggle */}
        <div className="flex flex-1 items-center justify-end md:hidden">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div
        id="mobile-menu"
        className={cn(
          "overflow-hidden border-border/40 bg-background/95 backdrop-blur-xl transition-all md:hidden",
          open ? "max-h-80 border-t py-4" : "max-h-0 py-0"
        )}
      >
        <div className="section-shell flex flex-col gap-2">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              {link.label}
              <ChevronRight className="h-4 w-4 opacity-50" />
            </a>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-border/40 pt-4">
            <AuthButtons />
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full px-4"
                onClick={toggleTheme}
              >
                {darkMode ? (
                  <>
                    <Sun className="h-4 w-4" /> Light
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4" /> Dark
                  </>
                )}
              </Button>
              <Button variant="outline" size="sm" className="rounded-full px-4 shadow-sm" asChild>
                <a
                  href={projectGithub.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </a>
              </Button>
            </div>
            <Button variant="dark" className="w-full rounded-full shadow-sm" asChild>
              <a
                href="https://chrome.google.com/webstore"
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
              >
                <Chrome className="h-4 w-4" />
                Get Extension
              </a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
