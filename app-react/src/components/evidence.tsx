import { cn } from "@/lib/utils";
import type { EvidenceTier } from "@/engine/types";

export function Pip({ tier }: { tier: EvidenceTier }) {
  return (
    <span
      className={tier === "FW" ? "pip-fw" : "pip-ea"}
      title={tier === "FW" ? "Framework-sourced" : "Engine assumption"}
    />
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tier,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tier: EvidenceTier;
  tone?: "default" | "good" | "warn" | "bad" | "hot";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "panel flex flex-col gap-1.5 p-3 min-w-0",
        tone === "good" && "bg-teal-soft/60",
        tone === "warn" && "bg-amber-soft/70",
        tone === "bad" && "bg-red-soft/70",
        tone === "hot" && "bg-blue-soft/70",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Pip tier={tier} />
        <span className="label-kicker truncate">{label}</span>
        <span className="ml-auto label-kicker opacity-70">{tier}</span>
      </div>
      <div className="num text-xl font-medium tracking-tight text-ink leading-none">
        {value}
      </div>
      {hint ? <div className="text-2xs text-ink-2 leading-snug">{hint}</div> : null}
    </div>
  );
}

export function TempBadge({ temp }: { temp: string }) {
  const map: Record<string, string> = {
    HOT: "bg-red-soft text-red",
    WARM: "bg-amber-soft text-amber",
    BALANCED: "bg-teal-soft text-teal",
    COOL: "bg-blue-soft text-blue",
    COLD: "bg-gray-soft text-gray",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-3xs font-semibold tracking-[0.14em]",
        map[temp] ?? "bg-gray-soft text-gray",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {temp}
    </span>
  );
}

export function ConfMeter({ conf }: { conf: "HIGH" | "MEDIUM" | "LOW" }) {
  const n = conf === "HIGH" ? 3 : conf === "MEDIUM" ? 2 : 1;
  return (
    <div className="flex items-center gap-2">
      <span className="label-kicker">Read {conf}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-4 rounded-full",
              i <= n
                ? conf === "LOW"
                  ? "bg-amber"
                  : "bg-teal"
                : "bg-line",
            )}
          />
        ))}
      </div>
    </div>
  );
}
