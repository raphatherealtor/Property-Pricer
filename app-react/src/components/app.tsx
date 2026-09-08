import { compute } from "@/engine/compute";
import { selfTestSummary } from "@/engine/selftest";
import type { AppMode } from "@/engine/types";
import { usePricer } from "@/store/pricer";
import { cn } from "@/lib/utils";
import { LayoutGrid, Presentation, UserRound, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Consumer } from "./consumer";
import { Deck } from "./deck";
import { Desk } from "./desk";
import { PrintDoc } from "./print-doc";
import { ConfMeter, TempBadge } from "./evidence";
import { SelfTestModal } from "./selftest-panel";
import { Button } from "./ui/button";

const MODES: { id: AppMode; label: string; icon: typeof LayoutGrid }[] = [
  { id: "desk", label: "Desk", icon: LayoutGrid },
  { id: "screen", label: "Screen", icon: Presentation },
  { id: "consumer", label: "Consumer", icon: UserRound },
];

export function App({ autoSelfTest = false }: { autoSelfTest?: boolean }) {
  const mode = usePricer((s) => s.mode);
  const setMode = usePricer((s) => s.setMode);
  const setSlide = usePricer((s) => s.setSlide);
  const slide = usePricer((s) => s.slide);
  const intake = usePricer((s) => s.intake);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const hydrate = usePricer((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const out = useMemo(
    () => compute({ intake, lender, investor, commercial }),
    [intake, lender, investor, commercial],
  );

  const [stamp, setStamp] = useState("");
  useEffect(() => {
    setStamp(new Date().toISOString());
  }, [out.inputHash]);

  const cert = useMemo(() => selfTestSummary(), []);
  const verified = cert.passed === cert.total;
  const [selftestOpen, setSelftestOpen] = useState(false);

  useEffect(() => {
    if (autoSelfTest) setSelftestOpen(true);
  }, [autoSelfTest]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    return () => {
      delete document.documentElement.dataset.mode;
    };
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (typing) return;
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setMode(mode === "screen" ? "desk" : "screen");
      }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setMode("consumer");
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        window.print();
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (mode === "screen") {
          e.preventDefault();
          setSlide(slide + 1);
        }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (mode === "screen") {
          e.preventDefault();
          setSlide(slide - 1);
        }
      }
      if (/^[1-6]$/.test(e.key) && mode === "screen") {
        setSlide(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, slide, setMode, setSlide]);

  const dark = mode === "screen";

  return (
    <>
      <div className="app-chrome min-h-svh">
        <header
          className={cn(
            "sticky top-0 z-30 flex min-h-[52px] items-center gap-2 border-b px-3 sm:px-4",
            dark
              ? "border-dark-line bg-dark text-dark-ink"
              : "border-line bg-paper/90 backdrop-blur-md text-ink",
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid size-6 place-items-center rounded-sm"
              style={{ background: dark ? "#111A2E" : "#16181D" }}
              aria-hidden
            >
              <span className="size-2 rounded-full bg-teal" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold tracking-tight leading-none">
                Property Pricer
              </div>
              <button
                type="button"
                onClick={() => setSelftestOpen(true)}
                className={cn(
                  "label-kicker mt-0.5 flex items-center gap-1.5 transition-colors",
                  verified
                    ? dark
                      ? "text-dark-muted hover:text-teal"
                      : "text-ink-2 hover:text-teal"
                    : "text-red hover:text-red",
                )}
                title="Open engine certification self-test"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    verified ? "bg-teal" : "bg-red",
                  )}
                  aria-hidden
                />
                <span className="hidden sm:inline">
                  Engine v1.6 {verified ? "Verified" : "Failed"}
                </span>
                <span className="sm:hidden">
                  {verified ? "v1.6 Verified" : "v1.6 Failed"}
                </span>
              </button>
            </div>
          </div>

          <nav
            className="mx-auto flex rounded-md border p-0.5"
            style={{
              borderColor: dark ? "var(--color-dark-line)" : "var(--color-line)",
              background: dark ? "var(--color-dark-panel)" : "var(--color-panel)",
            }}
          >
            {MODES.map((m) => {
              const Icon = m.icon;
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "flex h-8 min-h-8 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors",
                    on
                      ? dark
                        ? "bg-dark-ink text-dark"
                        : "bg-ink text-paper"
                      : dark
                        ? "text-dark-muted hover:text-dark-ink"
                        : "text-ink-2 hover:text-ink",
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="sm:inline">{m.label}</span>
                </button>
              );
            })}
          </nav>

          {mode !== "consumer" ? (
            <div className="hidden md:flex items-center gap-2">
              <TempBadge temp={out.marketTemp} />
              {!dark ? <ConfMeter conf={out.readConfidence} /> : null}
            </div>
          ) : (
            <div className="hidden md:block min-w-8" />
          )}
          <Button
            size="sm"
            variant={dark ? "ghost" : "secondary"}
            className={dark ? "text-dark-ink hover:bg-dark-panel" : undefined}
            onClick={() => window.print()}
          >
            <Printer className="size-3.5" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
        </header>

        {mode === "desk" ? <Desk out={out} stamp={stamp} /> : null}
        {mode === "screen" ? <Deck out={out} /> : null}
        {mode === "consumer" ? <Consumer out={out} /> : null}

        <SelfTestModal open={selftestOpen} onClose={() => setSelftestOpen(false)} />
      </div>
      <PrintDoc out={out} intake={intake} stamp={stamp} />
    </>
  );
}
