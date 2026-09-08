import type { EngineOutput } from "@/engine/types";
import { pct, usd } from "@/lib/format";
import { CostCurve, SurvivalChart, Waterfall } from "./charts";
import type { CoreIntake } from "@/engine/types";

export function PrintDoc({
  out,
  intake,
  stamp,
}: {
  out: EngineOutput;
  intake: CoreIntake;
  stamp: string;
}) {
  return (
    <div className="print-root">
      <section className="print-page">
        <header className="flex items-start justify-between border-b border-line pb-3">
          <div>
            <div className="label-kicker">Property Pricer · Candidate Engine</div>
            <h1 className="font-display text-2xl font-semibold">Client pricing diagnostic</h1>
          </div>
          <div className="text-right text-2xs num text-ink-2">
            <div>{out.caseId}</div>
            <div>v{out.calcVersion}</div>
            <div>{stamp ? stamp.slice(0, 19).replace("T", " ") : "live"}</div>
            <div>hash {out.inputHash}</div>
          </div>
        </header>
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="rounded-full bg-gray-soft px-2 py-0.5 font-semibold tracking-wider">
            {out.marketTemp}
          </span>
          <span>
            {intake.zip} · baseline {usd(intake.baselineValue)} · ask {usd(intake.targetPrice)} · GLA{" "}
            {intake.glaSqft.toLocaleString()} sf
          </span>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <PrintKpi label="E[DOM]" value={`${Math.round(out.expectedDomDays)}d`} />
          <PrintKpi label="P(>120d)" value={pct(out.pStale120d, 1)} />
          <PrintKpi label="E[d]" value={pct(out.expectedDiscountPct, 2)} />
          <PrintKpi
            label={out.costOfTesting < 0 ? "Ask surplus" : "Cost of testing"}
            value={usd(Math.abs(out.costOfTesting))}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="label-kicker mb-1">Survival</div>
            <SurvivalChart out={out} actualDom={intake.actualDom} />
          </div>
          <div>
            <div className="label-kicker mb-1">Cost of testing</div>
            <CostCurve points={out.costCurve} current={out.uEff} />
          </div>
        </div>
      </section>

      <section className="print-page mt-6">
        <h2 className="font-display text-lg font-semibold">Holdback · decision · formulas</h2>
        <div className="mt-3 grid grid-cols-2 gap-6">
          <Waterfall out={out} />
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray">
                <th className="py-1 font-medium"> </th>
                <th className="py-1 font-medium">Fresh</th>
                <th className="py-1 font-medium">Ambitious</th>
              </tr>
            </thead>
            <tbody className="num">
              <tr className="border-t border-line">
                <td className="py-1.5">Ask</td>
                <td>{usd(intake.baselineValue)}</td>
                <td>{usd(intake.targetPrice)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5">Expected sale</td>
                <td>—</td>
                <td>{usd(out.expectedSalePrice)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5">Net proceeds</td>
                <td>{usd(out.netProceedsAnchored)}</td>
                <td>{usd(out.netProceeds)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5">P(4+ months)</td>
                <td>—</td>
                <td>{pct(out.pStale120d, 1)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5">Holdback</td>
                <td colSpan={2}>{usd(out.scaledHoldback)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-5 rounded-md border border-line bg-gray-soft/50 p-3 text-2xs leading-relaxed text-ink-2">
          <p className="font-medium text-ink mb-1">Formula footnote · v{out.calcVersion}</p>
          S_base uses weekly hazards h₁=0.098, h₂=0.084, h₃=0.062, hₚ=0.018. Submarket warp κ_t =
          M_base / m_all after up to 8-pass censoring inflation (≤1.63×). Overpricing enters only via
          κ_eff = κ_t · exp(−4 · u_eff). E[d] integrates 1.9% (t≤60d) → 8.4% (t≥120d) over weekly sale
          mass, remainder at the 26-week re-strategy horizon. Carry = 70 bps/month · ask · E[DOM].
          Holdback = Σ rate_sys · GLA · min(1, age/life) · M_class. Evidence: FW = literature, EA =
          engine assumption.
        </div>
        <p className="mt-3 text-3xs text-gray num">
          Reproducibility stamp {out.caseId} · {out.inputHash} · {stamp || "live"} · Property Pricer
          v{out.calcVersion}. Not an appraisal. Diagnostic only.
        </p>
      </section>
    </div>
  );
}

function PrintKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line p-3">
      <div className="label-kicker">{label}</div>
      <div className="num text-xl font-medium mt-1">{value}</div>
    </div>
  );
}
