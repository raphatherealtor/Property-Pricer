import { selfTestSummary, type Assertion } from "@/engine/selftest";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "./ui/button";

export function SelfTestList() {
  const { rows, passed, total } = useMemo(() => selfTestSummary(), []);
  const all = passed === total;
  return (
    <div>
      <p className={cn("num text-sm font-medium", all ? "text-teal" : "text-red")}>
        {passed}/{total} assertions passed
      </p>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-panel">
        {rows.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
    </div>
  );
}

export function SelfTestPanel() {
  return (
    <div className="min-h-svh bg-paper text-ink px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <p className="label-kicker">v1.6.1 harness</p>
        <h1 className="font-display text-2xl font-semibold">Self-test</h1>
        <div className="mt-6">
          <SelfTestList />
        </div>
      </div>
    </div>
  );
}

export function SelfTestModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const summary = useMemo(() => (open ? selfTestSummary() : null), [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !summary) return null;
  const all = summary.passed === summary.total;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="selftest-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close self-test"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[88svh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-paper shadow-border sm:max-h-[80vh]">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="label-kicker">{all ? "Certified" : "Failed"}</div>
            <h2 id="selftest-title" className="font-display text-base font-semibold">
              Engine v1.6 {all ? "Verified" : "needs attention"}
            </h2>
            <p className={cn("num mt-0.5 text-xs", all ? "text-teal" : "text-red")}>
              {summary.passed}/{summary.total} self-tests passed
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        {all ? (
          <div className="border-b border-teal/20 bg-teal-soft px-4 py-2.5 text-2xs leading-snug text-ink-2">
            Knots, kappa dilation, convex cost scaling, and median coherence all hold.
          </div>
        ) : (
          <div className="border-b border-red/20 bg-red-soft px-4 py-2.5 text-2xs leading-snug text-red">
            One or more assertions failed. Review the harness below before pricing live inventory.
          </div>
        )}
        <div className="overflow-y-auto px-4 py-3">
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {summary.rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ r }: { r: Assertion }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className={cn("num text-xs font-semibold w-12", r.pass ? "text-teal" : "text-red")}>
        {r.pass ? "PASS" : "FAIL"}
      </span>
      <span className="flex-1 text-sm">
        <span className="text-gray num mr-2">#{r.id}</span>
        {r.name}
      </span>
      <span className="num text-2xs text-ink-2">
        exp {r.expected} · act {r.actual}
      </span>
    </li>
  );
}
