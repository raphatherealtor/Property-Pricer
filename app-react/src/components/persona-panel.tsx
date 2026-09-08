import type { EngineOutput, Persona } from "@/engine/types";
import { bps, daysLabel, pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CostCurve } from "./charts";
import { Pip } from "./evidence";

const TABS: { id: Persona; label: string; short: string }[] = [
  { id: "listing", label: "Listing Agent (Default)", short: "Listing" },
  { id: "lender", label: "Mortgage Lender", short: "Lender" },
  { id: "investor", label: "Equity Investor", short: "Investor" },
  { id: "commercial", label: "Commercial Broker", short: "Commercial" },
];

export function PersonaTabs({
  persona,
  onChange,
}: {
  persona: Persona;
  onChange: (p: Persona) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Persona diagnostic"
      className="grid grid-cols-2 gap-1 rounded-md border border-line bg-panel p-1 lg:grid-cols-4"
    >
      {TABS.map((t) => {
        const on = persona === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              "min-h-11 rounded-sm px-2 py-1.5 text-center text-2xs font-medium leading-tight transition-colors sm:text-xs",
              on ? "bg-ink text-paper" : "text-ink-2 hover:bg-gray-soft hover:text-ink",
            )}
          >
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.short}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PersonaPanel({
  out,
  persona,
  actualDom,
  baseline,
  ask,
}: {
  out: EngineOutput;
  persona: Persona;
  actualDom: number | null;
  baseline: number;
  ask: number;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <div className="label-kicker">Persona diagnostic</div>
          <h3 className="font-display text-sm font-semibold">
            {TABS.find((t) => t.id === persona)?.label}
          </h3>
        </div>
        <span className="label-kicker">from core intake</span>
      </div>
      {persona === "listing" ? (
        <ListingBlock out={out} actualDom={actualDom} baseline={baseline} ask={ask} />
      ) : null}
      {persona === "lender" ? <LenderBlock out={out} /> : null}
      {persona === "investor" ? <InvestorBlock out={out} /> : null}
      {persona === "commercial" ? <CommercialBlock out={out} /> : null}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tier,
}: {
  label: string;
  value: string;
  hint?: string;
  tier: "FW" | "EA";
}) {
  return (
    <div className="rounded-md border border-line bg-gray-soft/40 px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <Pip tier={tier} />
        <span className="label-kicker truncate">{label}</span>
      </div>
      <div className="num mt-1 text-lg font-medium tracking-tight text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-2xs text-ink-2 leading-snug">{hint}</div> : null}
    </div>
  );
}

function ListingBlock({
  out,
  actualDom,
  baseline,
  ask,
}: {
  out: EngineOutput;
  actualDom: number | null;
  baseline: number;
  ask: number;
}) {
  const stale = actualDom !== null && actualDom > 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="label-kicker mb-1">Cost of testing</div>
        <CostCurve points={out.costCurve} current={out.uEff} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-teal/30 bg-teal-soft/50 p-3">
          <div className="label-kicker text-teal">Fresh path</div>
          <div className="num mt-1 text-xl font-medium">{usd(out.listing.freshNet)}</div>
          <div className="text-2xs text-ink-2 mt-1">Ask {usd(baseline)} · expected net</div>
        </div>
        <div className="rounded-md border border-amber/30 bg-amber-soft/60 p-3">
          <div className="label-kicker text-amber">Stale / ambitious</div>
          <div className="num mt-1 text-xl font-medium">{usd(out.listing.staleNet)}</div>
          <div className="text-2xs text-ink-2 mt-1">
            Ask {usd(ask)} · P(4+ mo) {pct(out.pStale120d, 1)}
          </div>
        </div>
      </div>
      {stale ? (
        <div className="rounded-md border border-blue/30 bg-blue-soft p-3">
          <div className="label-kicker text-blue">Conditional DOM countdown</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="num text-2xl font-medium">{daysLabel(out.remainingDomDays)}</span>
            <span className="text-2xs text-ink-2">
              remaining · already {actualDom}d on market · E[min(T,26) | T {">"} s] ={" "}
              {daysLabel(out.expectedDomDays)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-2xs text-ink-2">
          Set actual DOM above 0 to arm the already-listed countdown (conditional survival).
        </p>
      )}
    </div>
  );
}

function LenderBlock({ out }: { out: EngineOutput }) {
  const L = out.lender;
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
      <Metric
        label="Lesser-of loan"
        value={usd(L.loanAmount)}
        hint={`LTV × min(appraised, contract) = ${usd(L.lesserOfValue)}`}
        tier="FW"
      />
      <Metric
        label="Appraisal gap cash"
        value={usd(L.gapCash)}
        hint="Due at close if contract > appraised"
        tier="FW"
      />
      <Metric
        label="Post-close reserve"
        value={usd(L.postCloseReserve)}
        hint={`Holdback + ${usd(L.monthlyPiti)} PITI × 6`}
        tier="EA"
      />
      <Metric
        label="Winner's curse uplift"
        value={`+${L.winnersCurseUpliftPp.toFixed(2)} pp`}
        hint={`1.9pp scaled · ${usd(L.winnersCurse)} notional`}
        tier="FW"
      />
      <Metric
        label="Stress LTV @ 8.4%"
        value={pct(L.stressLtv, 1)}
        hint={`Collateral ${usd(L.stressValue)} · DSCR ${L.dscrReserves.toFixed(2)}x`}
        tier="FW"
      />
    </div>
  );
}

function irrLabel(v: number | null): string {
  return v === null ? "—" : pct(v, 1);
}

function InvestorBlock({ out }: { out: EngineOutput }) {
  const I = out.investor;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="label-kicker mb-2">60-month IRR bridge</div>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-soft text-left text-ink-2">
                <th className="px-3 py-2 font-medium"> </th>
                <th className="px-3 py-2 font-medium">All-cash</th>
                <th className="px-3 py-2 font-medium">Levered</th>
              </tr>
            </thead>
            <tbody className="num">
              <tr className="border-t border-line">
                <td className="px-3 py-2 text-ink-2">Fresh</td>
                <td className="px-3 py-2">{irrLabel(I.irrFreshCash)}</td>
                <td className="px-3 py-2">{irrLabel(I.irrFreshLevered)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-3 py-2 text-ink-2">Stale (8.4% floor)</td>
                <td className="px-3 py-2">{irrLabel(I.irrStaleCash)}</td>
                <td className="px-3 py-2">{irrLabel(I.irrStaleLevered)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="Exit cap expansion"
          value={bps(I.capExpansionBps)}
          hint={`Entry ${pct(I.capEntry, 2)} → exit ${pct(I.capExit, 2)}`}
          tier="EA"
        />
        <Metric
          label="Equity return erosion"
          value={usd(I.erosionDollars)}
          hint={`${bps(I.erosionBps)} IRR vs fresh levered`}
          tier="EA"
        />
      </div>
    </div>
  );
}

function CommercialBlock({ out }: { out: EngineOutput }) {
  const C = out.commercial;
  const waltRisk = C.twoClockSpread < 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="SF absorption"
          value={`${C.absorptionMonths.toFixed(1)} mo`}
          hint={`${out.commercial.absorptionMonths > 0 ? "Available SF / monthly take-up" : ""}`}
          tier="EA"
        />
        <Metric
          label="Vacancy transmission"
          value={pct(C.vacancyTransmission, 0)}
          hint="SF rolling inside marketing horizon"
          tier="EA"
        />
      </div>
      <div
        className={cn(
          "rounded-md border p-3",
          waltRisk ? "border-red/30 bg-red-soft/70" : "border-line bg-gray-soft/40",
        )}
      >
        <div className="label-kicker">Two-clock risk</div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="text-2xs text-ink-2">WALT runway</div>
            <div className="num text-lg font-medium">{C.waltMonths.toFixed(1)} mo</div>
          </div>
          <div>
            <div className="text-2xs text-ink-2">Marketing clock</div>
            <div className="num text-lg font-medium">{C.marketingWeeks.toFixed(1)} wk</div>
          </div>
        </div>
        <div className="mt-2 text-2xs text-ink-2">
          Debt maturity {C.debtMaturityMonths.toFixed(0)} mo · spread {C.twoClockSpread.toFixed(1)} mo
          {waltRisk ? " — WALT/marketing outruns the debt clock." : "."}
        </div>
      </div>
      <Metric
        label="DSCR after 5-year reserves"
        value={`${C.dscrAfterReserves.toFixed(2)}x`}
        hint={`NOI ${usd(C.noiAnnual)} − holdback/5`}
        tier="EA"
      />
    </div>
  );
}