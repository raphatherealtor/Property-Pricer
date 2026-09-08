import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type Size = "sm" | "md" | "lg";

export function Button({
  className,
  variant = "secondary",
  size = "md",
  static: isStatic,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  static?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-[transform,background-color,box-shadow,color] duration-150 ease-out select-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        !isStatic && "active:not-disabled:scale-[0.96]",
        size === "sm" && "h-8 px-2.5 text-xs rounded-sm",
        size === "md" && "h-9 px-3.5 text-sm rounded-md",
        size === "lg" && "h-11 px-4 text-sm rounded-md",
        variant === "primary" && "bg-ink text-paper hover:bg-ink/90",
        variant === "secondary" &&
          "bg-panel text-ink border border-line hover:bg-gray-soft",
        variant === "ghost" && "bg-transparent text-ink-2 hover:bg-gray-soft hover:text-ink",
        variant === "danger" && "bg-red-soft text-red hover:bg-red/15",
        variant === "dark" &&
          "bg-dark-ink text-dark hover:bg-white border border-transparent",
        className,
      )}
      {...props}
    />
  );
}
