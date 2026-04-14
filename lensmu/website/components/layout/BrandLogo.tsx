import Image from "next/image";

import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  inverse?: boolean;
};

export function BrandLogo({
  className,
  markClassName,
  textClassName,
  inverse = false
}: BrandLogoProps) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border shadow-soft",
          inverse
            ? "border-white/20 bg-white/10"
            : "border-primary/25 bg-primary/10",
          markClassName
        )}
      >
        <span className="absolute inset-0 bg-primary/20 blur-md" />
        <Image
          src="/logo.png"
          alt=""
          width={34}
          height={34}
          priority
          className="relative z-10 h-8 w-8 object-contain drop-shadow-[0_0_12px_rgba(59,130,246,0.7)]"
        />
      </span>
      <span className={cn("leading-none", textClassName)}>
        <span className={cn("block text-base font-bold", inverse ? "text-white" : "text-foreground")}>
          VisionTranslate
        </span>
        <span
          className={cn(
            "block text-xs font-medium",
            inverse ? "text-white/70" : "text-muted-foreground"
          )}
        >
          Translate visual text anywhere
        </span>
      </span>
    </span>
  );
}
