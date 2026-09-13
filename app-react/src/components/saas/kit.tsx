import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small shared presentational pieces for the SaaS panels. */

export function SaasSection({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel p-3 sm:p-4", className)}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold tracking-tight">{title}</h3>
          {hint ? <p className="mt-0.5 text-2xs leading-snug text-ink-2">{hint}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-2xs leading-snug text-ink-2", className)}>{children}</p>;
}

/**
 * One consistent place to show why a cloud action failed. `tone: "warn"` is for
 * degradations the operator can keep working through (offline, no key yet);
 * `tone: "bad"` is for a hard failure.
 */
export function Note({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warn" | "bad" | "good";
  children: ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === "bad"
      ? "border-red/30 bg-red-soft text-red"
      : tone === "warn"
        ? "border-amber/30 bg-amber-soft text-ink-2"
        : tone === "good"
          ? "border-teal/30 bg-teal-soft text-ink-2"
          : "border-line bg-gray-soft text-ink-2";
  return (
    <p className={cn("rounded-md border px-2.5 py-2 text-2xs leading-snug", toneClass, className)}>
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-2xs text-ink-2">
      {children}
    </p>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-2xs text-ink-2">{label}</span>
      <span className="num text-2xs text-ink">{value}</span>
    </div>
  );
}

/** A pill used for statuses and provenance tags. */
export function Tag({
  tone = "info",
  children,
  title,
}: {
  tone?: "info" | "warn" | "bad" | "good";
  children: ReactNode;
  title?: string;
}) {
  const toneClass =
    tone === "bad"
      ? "border-red/25 bg-red-soft text-red"
      : tone === "warn"
        ? "border-amber/25 bg-amber-soft text-amber"
        : tone === "good"
          ? "border-teal/25 bg-teal-soft text-teal"
          : "border-line bg-gray-soft text-ink-2";
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-xs border px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}
