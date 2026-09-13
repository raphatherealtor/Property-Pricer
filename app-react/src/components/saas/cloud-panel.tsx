import { useEffect, useState } from "react";
import { Brain, HardDriveDownload, Landmark, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EngineOutput } from "@/engine/types";
import { cn } from "@/lib/utils";
import { AiCopilot } from "./ai-copilot";
import { CrmConnect } from "./crm-connect";
import { InstallCard } from "./install-card";
import { ScenarioLibrary } from "./scenario-library";

type TabId = "scenarios" | "ai" | "crm" | "install";

const TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: "scenarios", label: "Scenarios", icon: Landmark },
  { id: "ai", label: "AI", icon: Brain },
  { id: "crm", label: "CRM", icon: Share2 },
  { id: "install", label: "Install", icon: HardDriveDownload },
];

/**
 * The SaaS shell: saved scenarios, server-side AI, the Figgy CRM connector, and
 * install/offline state, in a modal that mirrors the engine self-test dialog.
 *
 * Tab bodies mount only while their tab is active, so opening the panel does not
 * fire four cloud round-trips at once — and, more importantly, so a workspace
 * with no provider configured never has an AI call attempted on its behalf.
 *
 * `out` is threaded down from `App`: the live `EngineOutput` the desk and deck are
 * already rendering. Nothing in this tree recomputes or invents a figure.
 */
export function CloudPanel({
  open,
  onClose,
  out,
}: {
  open: boolean;
  onClose: () => void;
  out: EngineOutput;
}) {
  const [tab, setTab] = useState<TabId>("scenarios");

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-panel-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close workspace panel"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[92svh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-paper shadow-border sm:max-h-[88vh]">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="label-kicker">Workspace</div>
            <h2 id="cloud-panel-title" className="font-display text-base font-semibold">
              Cloud &amp; integrations
            </h2>
            <p className="num mt-0.5 text-3xs text-ink-2">
              {out.caseId} · engine v{out.calcVersion} · {out.inputHash}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex gap-1 border-b border-line px-3 pt-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 rounded-t-sm border border-b-transparent px-2.5 py-1.5 text-2xs font-medium transition-colors",
                  on
                    ? "border-line bg-paper text-ink"
                    : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                <Icon className="size-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="soft-scrollbar overflow-y-auto bg-paper px-3 py-3 sm:px-4">
          {tab === "scenarios" ? <ScenarioLibrary out={out} /> : null}
          {tab === "ai" ? <AiCopilot out={out} /> : null}
          {tab === "crm" ? <CrmConnect out={out} /> : null}
          {tab === "install" ? <InstallCard /> : null}
        </div>
      </div>
    </div>
  );
}
