import type { EngineOutput, FlagCode, KpiItem, Persona } from "@/engine/types";
import { buildScenarioExport } from "@/engine/export";
import { daysLabel, pct, usd, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePricer } from "@/store/pricer";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useMemo, useState } from "react";
import { AskSlider, SurvivalChart, Waterfall } from "./charts";
import { ConfMeter, KpiCard, Pip, TempBadge } from "./evidence";
import { IntakeForm } from "./intake-form";
import { PersonaPanel, PersonaTabs } from "./persona-panel";
import { Button } from "./ui/button";

const FLAG_COPY: Record<FlagCode, string> = {
  VELOCITY_TENSION: "Closed-DOM speed and UII prior disagree by more than 35%.",
  CENSORING_INFLATION_APPLIED: "Closed-only clock was inflated for right-censoring.",
  TERMINAL_HVAC: "HVAC at or past expected 15-year life.",
  TERMINAL_ROOF: "Roof at or past expected 20-year life.",
  TERMINAL_WH: "Water heater at or past expected 10-year life.",
  EXTREME_OVERSHOOT: "Ask is more than 12% above baseline.",
  SPARSE_ZIP: "ZIP median DOM looks like a slow/un-calibrated submarket.",
  STALE_LISTING: "Already on market 90+ days — conditional survival in force.",
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function Desk({ out, stamp }: { out: EngineOutput; stamp: string }) {
  const intake = usePricer((s) => s.intake);
  const persona = usePricer((s) => s.persona);
  const patchIntake = usePricer((s) => s.patchIntake);
  const setMode = usePricer((s) => s.setMode);
  const setPersona = usePricer((s) => s.setPersona);

  const kpis = useMemo(() => kpiSet(out, persona), [out, persona]);

  return (
    <>
      <div className="hidden lg:flex h-[calc(100svh-52px)]">
        <Group orientation="horizontal" className="h-full w-full">
          <Panel defaultSize="24%" minSize="18%" className="bg-paper">
            <div className="h-full overflow-y-auto border-r border-line px-4 py-4">
              <IntakeForm />
            </div>
          </Panel>
          <Separator className="w-px bg-line hover:bg-blue data-[separator-active]:bg-blue" />
          <Panel defaultSize="52%" minSize="36%">
            <Center out={out} kpis={kpis} persona={persona} setPersona={setPersona} />
          </Panel>
          <Separator className="w-px bg-line hover:bg-blue" />
          <Panel defaultSize="24%" minSize="16%" className="bg-paper">
            <AuditRail out={out} stamp={stamp} onDeck={() => setMode("screen")} />
          </Panel>
        </Group>
      </div>

      <div className="lg:hidden flex flex-col gap-4 px-3 py-3 pb-28">
        <div className="flex items-center justify-between">
          <TempBadge temp={out.marketTemp} />
          <ConfMeter conf={out.readConfidence} />
        </div>
        <PersonaTabs persona={persona} onChange={setPersona} />
        <AskSlider
          baseline={intake.baselineValue}
          value={intake.targetPrice}
          onChange={(n) => patchIntake({ targetPrice: n })}
        />
        <div className="grid grid-cols-2 gap-2">
          {kpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>
        <PersonaPanel
          out={out}
          persona={persona}
          actualDom={intake.actualDom}
          baseline={intake.baselineValue}
          ask={intake.targetPrice}
        />
        <div className="panel p-3">
          <div className="label-kicker mb-2">Survival S_zip(w)</div>
          <SurvivalChart out={out} actualDom={intake.actualDom} />
        </div>
        <details className="panel p-3">
          <summary className="text-sm font-medium cursor-pointer">Intake</summary>
          <div className="mt-3">
            <IntakeForm />
          </div>
        </details>
        <details className="panel p-3">
          <summary className="text-sm font-medium cursor-pointer">Audit trace</summary>
          <div className="mt-3">
            <AuditRail out={out} stamp={stamp} onDeck={() => setMode("screen")} compact />
          </div>
        </details>
      </div>
    </>
  );
}

function Center({
  out,
  kpis,
  persona,
  setPersona,
}: {
  out: EngineOutput;
  kpis: KpiItem[];
  persona: Persona;
  setPersona: (p: Persona) => void;
}) {
  const intake = usePricer((s) => s.intake);
  const patchIntake = usePricer((s) => s.patchIntake);
  return (
    <div className="h-full overflow-y-auto px-5 py-4 flex flex-col gap-4">
      <PersonaTabs persona={persona} onChange={setPersona} />
      <div className="flex flex-wrap items-center gap-3">
        <TempBadge temp={out.marketTemp} />
        <ConfMeter conf={out.readConfidence} />
        <span className="ml-auto text-2xs text-ink-2 num">
          {out.caseId} · v{out.calcVersion}
        </span>
      </div>
      <AskSlider
        baseline={intake.baselineValue}
        value={intake.targetPrice}
        onChange={(n) => patchIntake({ targetPrice: n })}
      />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>
      <PersonaPanel
        out={out}
        persona={persona}
        actualDom={intake.actualDom}
        baseline={intake.baselineValue}
        ask={intake.targetPrice}
      />
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="label-kicker">Hero diagnostic</div>
            <h3 className="font-display text-sm font-semibold">Time-warped survival</h3>
          </div>
          <span className="label-kicker">
            <Pip tier="FW" /> national shape · local κ
          </span>
        </div>
        <SurvivalChart out={out} actualDom={intake.actualDom} />
      </div>
      {persona === "listing" ? (
        <div className="panel p-4">
          <div className="label-kicker mb-1">Escrow trap</div>
          <h3 className="font-display text-sm font-semibold mb-3">Scaled holdback waterfall</h3>
          <Waterfall out={out} />
        </div>
      ) : null}
    </div>
  );
}

function AuditRail({
  out,
  stamp,
  onDeck,
  compact,
}: {
  out: EngineOutput;
  stamp: string;
  onDeck: () => void;
  compact?: boolean;
}) {
  const intake = usePricer((s) => s.intake);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const [copied, setCopied] = useState<"idle" | "ok" | "err">("idle");

  const copyJson = async () => {
    const payload = buildScenarioExport(
      { intake, lender, investor, commercial },
      out,
      stamp || new Date().toISOString(),
    );
    const text = JSON.stringify(payload, null, 2);
    const ok = await writeClipboard(text);
    setCopied(ok ? "ok" : "err");
    window.setTimeout(() => setCopied("idle"), 1800);
  };

  return (
    <div className={cn("flex flex-col gap-3", !compact && "h-full overflow-y-auto px-4 py-4 pb-20")}>
      <div>
        <div className="label-kicker">Live rule trace</div>
        <h2 className="font-display text-base font-semibold tracking-tight">Audit log</h2>
      </div>
      <div>
        <div className="label-kicker mb-1.5">Engine flags</div>
        {out.flags.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {out.flags.map((f) => (
              <div key={f} className="rounded-md border border-amber/30 bg-amber-soft px-2.5 py-2">
                <div className="label-kicker text-amber">{f}</div>
                <p className="text-2xs text-ink-2 mt-0.5 leading-snug">{FLAG_COPY[f]}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-teal/30 bg-teal-soft px-2.5 py-2 text-2xs text-ink-2">
            No system flags. Direction coherent.
          </div>
        )}
        <Button variant="primary" className="mt-2 w-full" onClick={() => void copyJson()}>
          {copied === "ok" ? "Copied scenario JSON" : copied === "err" ? "Copy failed" : "Copy Scenario JSON"}
        </Button>
      </div>
      <div className="rounded-md bg-ink text-paper p-3 font-mono text-3xs leading-5 overflow-x-auto">
        {out.trace.map((row) => (
          <div key={row.key} className="flex gap-2">
            <span className="text-teal w-14 shrink-0">{row.tier}</span>
            <span className="text-paper/50 flex-1 truncate">{row.label}</span>
            <span className="text-paper">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onDeck}>
          Launch client deck
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            window.print();
          }}
        >
          Export 2-page PDF
        </Button>
      </div>
      <p className="text-3xs text-gray leading-relaxed">
        Hash {out.inputHash}
        {stamp ? ` · ${stamp.slice(0, 19).replace("T", " ")}Z` : ""} · reproducibility stamp v
        {out.calcVersion}.
      </p>
    </div>
  );
}

function kpiSet(out: EngineOutput, persona: Persona): KpiItem[] {
  const cotNeg = out.costOfTesting < 0;
  const core: KpiItem[] = [
    {
      label: "E[DOM]",
      value: daysLabel(out.expectedDomDays),
      hint: `p50 ${daysLabel(out.p50DomDays)} · remaining ${daysLabel(out.remainingDomDays)}`,
      tier: "FW",
      tone: "default",
    },
    {
      label: "P(≤ 2 wk)",
      value: pct(out.pSold2wk, 1),
      hint: "Front-loaded hazard mass",
      tier: "FW",
      tone: out.pSold2wk > 0.25 ? "good" : "default",
    },
    {
      label: "P(> 120 d)",
      value: pct(out.pStale120d, 1),
      hint: "Four-month stale risk",
      tier: "FW",
      tone: out.pStale120d > 0.35 ? "bad" : out.pStale120d > 0.22 ? "warn" : "good",
    },
    {
      label: "E[d]",
      value: pct(out.expectedDiscountPct, 2),
      hint: `Offer ${usdCompact(out.expectedSalePrice)}`,
      tier: "FW",
      tone: "default",
    },
    {
      label: cotNeg ? "Ask surplus" : "Cost of testing",
      value: usd(Math.abs(out.costOfTesting)),
      hint: cotNeg ? "Expected net vs listing at baseline" : "Expected net given up vs baseline ask",
      tier: "EA",
      tone: cotNeg ? "good" : "warn",
    },
    {
      label: "Scaled holdback",
      value: usd(out.scaledHoldback),
      hint: `Ceiling ${usdCompact(out.holdbackFullReplacement)}`,
      tier: "EA",
      tone: out.flags.some((f) => f.startsWith("TERMINAL")) ? "warn" : "default",
    },
    {
      label: "Net proceeds",
      value: usd(out.netProceeds),
      hint: "Sale − carry − holdback",
      tier: "EA",
      tone: "default",
    },
  ];

  const extra: KpiItem =
    persona === "lender"
      ? {
          label: "Stress LTV @ 8.4%",
          value: pct(out.lender.stressLtv, 1),
          hint: `DSCR ${out.lender.dscrReserves.toFixed(2)}x after reserves`,
          tier: "FW",
          tone: out.lender.stressLtv > 0.9 ? "bad" : "default",
        }
      : persona === "investor"
        ? {
            label: "Levered IRR",
            value: out.investor.irrAnnual === null ? "—" : pct(out.investor.irrAnnual, 1),
            hint: `Exit cap ${pct(out.investor.capExit, 2)} · erosion ${usdCompact(out.investor.erosionDollars)}`,
            tier: "EA",
            tone: "hot",
          }
        : persona === "commercial"
          ? {
              label: "Two-clock spread",
              value: `${out.commercial.twoClockSpread.toFixed(1)} mo`,
              hint: `WALT ${out.commercial.waltMonths.toFixed(0)} · absorb ${out.commercial.absorptionMonths.toFixed(1)} mo`,
              tier: "EA",
              tone: out.commercial.twoClockSpread < 0 ? "bad" : "default",
            }
          : {
              label: "Bracket capture",
              value: pct(out.listing.captureAsk, 0),
              hint: out.listing.bracket,
              tier: "EA",
              tone: "hot",
            };

  return [...core, extra];
}