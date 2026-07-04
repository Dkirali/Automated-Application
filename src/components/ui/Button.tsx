import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "ink" | "accent" | "outline" | "link" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  ink: "bg-ink text-cream hover:bg-ink/90 font-bold",
  accent: "bg-accent text-white hover:bg-accent/90 font-bold",
  outline:
    "bg-card border-[1.5px] border-ink text-ink hover:bg-ink hover:text-cream font-bold",
  link: "text-accent hover:underline font-semibold px-0 py-0",
  danger:
    "bg-card border-[1.5px] border-[#e3b5a6] text-accent-strong hover:bg-accent-strong hover:text-white hover:border-accent-strong font-bold",
};

const SIZES: Record<Size, string> = {
  sm: "px-4 py-2 text-[13px]",
  md: "px-5 py-2.5 text-[13px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "ink",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  const isLink = variant === "link";
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-btn transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        !isLink && SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
