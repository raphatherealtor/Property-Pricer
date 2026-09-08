import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, ReactNode } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-line bg-panel px-2.5 text-sm text-ink",
        "placeholder:text-gray num",
        "transition-[border-color,box-shadow] duration-150",
        "hover:border-line-2 focus-visible:outline-none focus-visible:border-blue focus-visible:ring-2 focus-visible:ring-blue/20",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-2xs font-medium tracking-wide text-ink-2">{label}</span>
        {hint ? <span className="label-kicker">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}
