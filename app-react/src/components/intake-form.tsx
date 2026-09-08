import { searchZips, type ZipMarket } from "@/data/zips";
import type { CoreIntake, ListingState, Persona } from "@/engine/types";
import { usd } from "@/lib/format";
import { usePricer } from "@/store/pricer";
import { useMemo, useState } from "react";
import { Field, Input } from "./ui/input";
import { Button } from "./ui/button";
import { Pip } from "./evidence";
import { ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const STATES: ListingState[] = ["pre_listing", "active", "pending", "closed", "withdrawn"];
const PERSONAS: { id: Persona; label: string }[] = [
  { id: "listing", label: "Listing" },
  { id: "lender", label: "Lender" },
  { id: "investor", label: "Investor" },
  { id: "commercial", label: "Commercial" },
];

function Num({
  value,
  onChange,
  step = 1,
  min,
  max,
  prefix,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  prefix?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {prefix ? (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray num">
          {prefix}
        </span>
      ) : null}
      <Input
        type="number"
        className={prefix ? "pl-6" : undefined}
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

export function IntakeForm() {
  const intake = usePricer((s) => s.intake);
  const persona = usePricer((s) => s.persona);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const patchIntake = usePricer((s) => s.patchIntake);
  const patchLender = usePricer((s) => s.patchLender);
  const patchInvestor = usePricer((s) => s.patchInvestor);
  const patchCommercial = usePricer((s) => s.patchCommercial);
  const applyZip = usePricer((s) => s.applyZip);
  const setPersona = usePricer((s) => s.setPersona);
  const reset = usePricer((s) => s.reset);

  const [zipQ, setZipQ] = useState(intake.zip);
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchZips(zipQ, 7), [zipQ]);
  const [personaOpen, setPersonaOpen] = useState(false);

  const pickZip = (m: ZipMarket) => {
    setZipQ(m.zip);
    setOpen(false);
    applyZip(m.zip);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label-kicker">Audit intake</div>
          <h2 className="font-display text-base font-semibold tracking-tight">Case inputs</h2>
        </div>
        <Button size="sm" variant="ghost" onClick={reset} title="Reset to verification case">
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>

      <Field label="ZIP code" hint="auto-calibrates">
        <div className="relative">
          <Input
            value={zipQ}
            onChange={(e) => {
              setZipQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 180)}
            placeholder="92373"
            inputMode="numeric"
            autoComplete="off"
          />
          {open && hits.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-panel shadow-border">
              {hits.map((m) => (
                <li key={m.zip}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs hover:bg-blue-soft"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickZip(m)}
                  >
                    <span className="font-medium">
                      <span className="num">{m.zip}</span> {m.city}, {m.state}
                    </span>
                    <span className="label-kicker">
                      {m.medianDom}d · {m.uii.toFixed(1)} UII
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Chip
          label="Closed median"
          value={`${intake.medianDomZip}d`}
          sub="censoring-corrected"
          tier="FW"
        />
        <Chip label="UII" value={`${intake.uiiMonths.toFixed(1)} mo`} sub="inventory prior" tier="EA" />
      </div>

      <Field label="Baseline value" hint="as-is">
        <Num value={intake.baselineValue} onChange={(n) => patchIntake({ baselineValue: n })} step={1000} min={1} prefix="$" />
      </Field>
      <Field label="Target ask" hint="live">
        <Num value={intake.targetPrice} onChange={(n) => patchIntake({ targetPrice: n })} step={1000} min={1} prefix="$" />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Listing state">
          <select
            className="h-9 w-full rounded-md border border-line bg-panel px-2 text-sm"
            value={intake.listingState}
            onChange={(e) => patchIntake({ listingState: e.target.value as ListingState })}
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Actual DOM" hint="days">
          <Num
            value={intake.actualDom ?? 0}
            onChange={(n) => patchIntake({ actualDom: n > 0 ? n : null })}
            min={0}
            step={1}
          />
        </Field>
      </div>

      <Field label="Gross living area" hint="sf">
        <Num value={intake.glaSqft} onChange={(n) => patchIntake({ glaSqft: Math.max(1, n) })} min={1} step={50} />
      </Field>

      <div>
        <div className="label-kicker mb-2">Mechanical ages</div>
        <div className="grid grid-cols-3 gap-2">
          <Age label="HVAC" value={intake.hvacAge} onChange={(n) => patchIntake({ hvacAge: n })} life={15} />
          <Age label="Roof" value={intake.roofAge} onChange={(n) => patchIntake({ roofAge: n })} life={20} />
          <Age label="W.H." value={intake.whAge} onChange={(n) => patchIntake({ whAge: n })} life={10} />
        </div>
      </div>

      <div>
        <div className="label-kicker mb-2">Persona</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersona(p.id)}
              className={cn(
                "h-8 rounded-md border text-xs font-medium transition-colors",
                persona === p.id
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-panel text-ink-2 hover:bg-gray-soft",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="flex items-center justify-between text-xs font-medium text-ink-2"
        onClick={() => setPersonaOpen((v) => !v)}
      >
        Persona extensions
        <ChevronDown className={cn("size-3.5 transition-transform", personaOpen && "rotate-180")} />
      </button>

      {personaOpen ? (
        <PersonaExt
          persona={persona}
          intake={intake}
          lender={lender}
          investor={investor}
          commercial={commercial}
          patchLender={patchLender}
          patchInvestor={patchInvestor}
          patchCommercial={patchCommercial}
        />
      ) : null}

      <p className="text-2xs text-gray leading-relaxed">
        Clock basis {intake.domClockBasis.replace("_", " ")} · {usd(intake.baselineValue)} baseline · ask{" "}
        {usd(intake.targetPrice)}.
      </p>
    </div>
  );
}

function Chip({
  label,
  value,
  sub,
  tier,
}: {
  label: string;
  value: string;
  sub: string;
  tier: "FW" | "EA";
}) {
  return (
    <div className="rounded-md border border-line bg-gray-soft/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Pip tier={tier} />
        <span className="label-kicker">{label}</span>
      </div>
      <div className="num mt-1 text-sm font-medium">{value}</div>
      <div className="text-3xs text-gray">{sub}</div>
    </div>
  );
}

function Age({
  label,
  value,
  onChange,
  life,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  life: number;
}) {
  const terminal = value >= life;
  return (
    <div className={cn("rounded-md border px-2 py-2", terminal ? "border-red bg-red-soft/50" : "border-line")}>
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium text-ink-2">{label}</span>
        <span className="label-kicker">{life}y</span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          className="size-7 rounded-sm border border-line text-sm leading-none"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </button>
        <div className="num flex-1 text-center text-sm font-medium">{value}</div>
        <button
          type="button"
          className="size-7 rounded-sm border border-line text-sm leading-none"
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function PersonaExt({
  persona,
  intake,
  lender,
  investor,
  commercial,
  patchLender,
  patchInvestor,
  patchCommercial,
}: {
  persona: Persona;
  intake: CoreIntake;
  lender: ReturnType<typeof usePricer.getState>["lender"];
  investor: ReturnType<typeof usePricer.getState>["investor"];
  commercial: ReturnType<typeof usePricer.getState>["commercial"];
  patchLender: (p: Partial<typeof lender>) => void;
  patchInvestor: (p: Partial<typeof investor>) => void;
  patchCommercial: (p: Partial<typeof commercial>) => void;
}) {
  if (persona === "lender") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="LTV">
          <Num value={lender.ltv} onChange={(n) => patchLender({ ltv: n })} step={0.01} min={0} max={1} />
        </Field>
        <Field label="Note rate">
          <Num value={lender.noteRate} onChange={(n) => patchLender({ noteRate: n })} step={0.001} min={0} />
        </Field>
        <Field label="Appraised">
          <Num value={lender.appraisedValue} onChange={(n) => patchLender({ appraisedValue: n })} step={1000} prefix="$" />
        </Field>
        <Field label="NOI / yr">
          <Num value={lender.noiAnnual} onChange={(n) => patchLender({ noiAnnual: n })} step={100} prefix="$" />
        </Field>
      </div>
    );
  }
  if (persona === "investor") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Rent / mo">
          <Num value={investor.rentRollMonthly} onChange={(n) => patchInvestor({ rentRollMonthly: n })} step={50} prefix="$" />
        </Field>
        <Field label="Opex ratio">
          <Num value={investor.opexRatio} onChange={(n) => patchInvestor({ opexRatio: n })} step={0.01} />
        </Field>
        <Field label="Hold years">
          <Num value={investor.holdYears} onChange={(n) => patchInvestor({ holdYears: n })} step={1} />
        </Field>
        <Field label="IO months">
          <Num value={investor.ioMonths} onChange={(n) => patchInvestor({ ioMonths: n })} step={1} />
        </Field>
      </div>
    );
  }
  if (persona === "commercial") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Available SF">
          <Num value={commercial.availableSf} onChange={(n) => patchCommercial({ availableSf: n })} step={100} />
        </Field>
        <Field label="Absorbed SF/mo">
          <Num value={commercial.monthlyAbsorbedSf} onChange={(n) => patchCommercial({ monthlyAbsorbedSf: n })} step={10} />
        </Field>
        <Field label="WALT (mo)">
          <Num value={commercial.waltMonths} onChange={(n) => patchCommercial({ waltMonths: n })} step={1} />
        </Field>
        <Field label="Debt maturity">
          <Num value={commercial.debtMaturityMonths} onChange={(n) => patchCommercial({ debtMaturityMonths: n })} step={1} />
        </Field>
      </div>
    );
  }
  void intake;
  return (
    <p className="text-2xs text-ink-2 leading-relaxed">
      Listing persona uses search-bracket capture, fresh vs stale paths, and repair-before-list ROI. No extra
      capital-stack fields required.
    </p>
  );
}
