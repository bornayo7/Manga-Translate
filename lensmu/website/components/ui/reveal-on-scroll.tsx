"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type RevealOnScrollProps = {
  children: ReactNode;
  className?: string;
  delay?: "none" | "short" | "medium";
  variant?: "fade-up" | "scale-up";
};

const delayClasses = {
  none: "",
  short: "delay-100",
  medium: "delay-200"
};

const variantClasses = {
  "fade-up": {
    hidden: "translate-y-10 opacity-0 blur-sm",
    visible: "translate-y-0 opacity-100 blur-0"
  },
  "scale-up": {
    hidden: "translate-y-12 scale-[0.96] opacity-0 blur-sm",
    visible: "translate-y-0 scale-100 opacity-100 blur-0"
  }
};

export function RevealOnScroll({
  children,
  className,
  delay = "none",
  variant = "fade-up"
}: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.22, rootMargin: "0px 0px -60px 0px" }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "will-change-transform transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:blur-0",
        delayClasses[delay],
        visible ? variantClasses[variant].visible : variantClasses[variant].hidden,
        className
      )}
    >
      {children}
    </div>
  );
}
