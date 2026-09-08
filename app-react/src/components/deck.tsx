import type { EngineOutput } from "@/engine/types";
import { pct, usd, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePricer } from "@/store/pricer";
import { ChevronLeft, ChevronRight, Keyboard } from "lucide-react";
import {
  AskSlider,
  BracketChart,
  CostCurve,
  DiscountBridge,
  HazardBars,
  SurvivalChart,
  Waterfall,
} from "./charts";
import { Pip } from "./evidence";
import { Button } from "./ui/button";

const TITLES = [
  ["Stage 1", "Visibility"],
  ["Stage 2", "Conversion"],
  ["Stage 3", "Time"],
  ["Stage 3", "Price"],
  ["Stage 4", "Escrow & close"],
  ["Decision", "Fresh vs ambitious"],
];

export function Deck({ out }: { out: EngineOutput }) {
  const slide = usePricer((s) => s.slide);
  const setSlide = usePricer((s) => s.setSlide);
  const setMode = usePricer((s) => s.setMode);
  const intake = usePricer((s) => s.intake);
  const patchIntake = usePricer((s) => s.patchIntake);

  return (
    <div className="relative min-h-[calc(100svh-52px)] bg-dark text-dark-ink">
      <div className="mx-auto flex min-h-[calc(100svh-52px)] max-w-6xl flex-col px-4 py-5 sm:px-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="label-kicker text-dark-muted">{TITLES[slide][0]}</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {TITLES[slide][1]}
          </h1>
          <span className="ml-auto hidden items-center gap-1.5 text-3xs text-dark-muted sm:flex">
            <Keyboard className="size-3.5" /> ← → slides · D desk
          </span>
        </div>

        <div className="flex-1">
          {slide === 0 && <Slide0 out={out} />}
          {slide === 1 && <Slide1 out={out} />}
          {slide === 2 && (
            <Slide2
              out={out}
              ask={intake.targetPrice}
              baseline={intake.baselineValue}
              actualDom={intake.actualDom}
              onAsk={(n) => patchIntake({ targetPrice: n })}
            />
          )}
          {slide === 3 && <Slide3 out={out} baseline={intake.baselineValue} ask={intake.targetPrice} />}
          {slide === 4 && <Slide4 out={out} />}
          {slide === 5 && (
            <Slide5
              out={out}
              baseline={intake.baselineValue}
              ask={intake.targetPrice}
              onPrint={() => window.print()}
              onDesk={() => setMode("desk")}
            />
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button
            variant="ghost"
            className="text-dark-ink hover:bg-dark-panel"
            onClick={() => setSlide(slide - 1)}
            disabled={slide === 0}
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <div className="flex flex-1 items-center justify-center gap-1.5">
            {TITLES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Slide ${i + 1}`}
                onClick={() => setSlide(i)}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200",
                  i === slide ? "w-8 bg-dark-ink" : "w-2.5 bg-dark-line hover:bg-dark-muted",
                )}
              />
            ))}
          </div>
          <Button
            variant="dark"
            onClick={() => (slide === 5 ? window.print() : setSlide(slide + 1))}
          >
            {slide === 5 ? "Print decision" : "Next"}
            {slide < 5 ? <ChevronRight className="size-4" /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Slide0({ out }: { out: EngineOutput }) {
  const intake = usePricer((s) => s.intake);
  return (
    <div className="grid gap-8 lg:grid-cols-5 items-center">
      <div className="lg:col-span-2 space-y-4">
        <p className="text-dark-muted text-sm leading-relaxed">
          Buyers search in $50k grains. Listing above a grain is invisible to everyone whose max budget
          stops at that line.
        </p>
        <div className="rounded-lg border border-dark-line bg-dark-panel p-4">
          <div className="label-kicker text-dark-muted">At this ask</div>
          <div className="num mt-1 text-4xl font-medium">{pct(out.listing.captureAsk, 0)}</div>
          <div className="text-sm text-dark-muted mt-1">of nearby searchers still see the listing</div>
        </div>
      </div>
      <div className="lg:col-span-3 rounded-lg border border-dark-line bg-dark-panel p-5">
        <BracketChart
          ask={intake.targetPrice}
          baseline={intake.baselineValue}
          captureAsk={out.listing.captureAsk}
          captureBase={out.listing.captureBaseline}
          captureBelow={out.listing.captureBelowGrain}
          variant="dark"
        />
      </div>
    </div>
  );
}

function Slide1({ out }: { out: EngineOutput }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-lg border border-dark-line bg-dark-panel p-6 flex flex-col gap-3">
        <div className="label-kicker text-dark-muted">Staging investment</div>
        <div className="num text-4xl font-medium">{usd(out.listing.stagingCost)}</div>
        <p className="text-sm text-dark-muted leading-relaxed">
          Typical full-home staging for a 2,000 sf listing. It buys conversion — not a substitute for
          mechanical honesty.
        </p>
      </div>
      <div className="rounded-lg border border-amber/40 bg-dark-panel p-6 flex flex-col gap-3">
        <div className="label-kicker text-amber">The presentation gap</div>
        <div className="num text-4xl font-medium">{usd(out.holdbackFullReplacement)}</div>
        <p className="text-sm text-dark-muted leading-relaxed">
          Full HVAC + roof + water heater replacement at this GLA and class. Scaled holdback today is{" "}
          {usd(out.scaledHoldback)}. Buyers will find this in inspection.
        </p>
      </div>
    </div>
  );
}

function Slide2({
  out,
  ask,
  baseline,
  actualDom,
  onAsk,
}: {
  out: EngineOutput;
  ask: number;
  baseline: number;
  actualDom: number | null;
  onAsk: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <HeroStat label="Expected DOM" value={`${Math.round(out.expectedDomDays)}d`} hint="capped at 26 weeks" />
        <HeroStat label="4+ month risk" value={pct(out.pStale120d, 1)} hint="P(T > 120d)" />
        <HeroStat label="κ_eff" value={out.kappaEff.toFixed(3)} hint="time warp at this ask" />
      </div>
      <AskSlider baseline={baseline} value={ask} onChange={onAsk} dark />
      <div className="rounded-lg border border-dark-line bg-dark-panel p-4">
        <SurvivalChart out={out} actualDom={actualDom} variant="dark" />
        <div className="mt-3">
          <div className="label-kicker text-dark-muted mb-1">Weekly sale probability mass</div>
          <HazardBars out={out} variant="dark" />
        </div>
      </div>
    </div>
  );
}

function Slide3({ out, baseline, ask }: { out: EngineOutput; baseline: number; ask: number }) {
  const stale = ask * (1 - 0.084);
  return (
    <div className="grid gap-8 lg:grid-cols-5 items-center">
      <div className="lg:col-span-2 space-y-3">
        <p className="text-sm text-dark-muted leading-relaxed">
          Discount is not a cliff. It interpolates 1.9% inside 60 days to an 8.4% stale floor at 120
          days, then stays capped.
        </p>
        <div className="num text-sm text-dark-ink">
          E[d] {pct(out.expectedDiscountPct, 2)} → expected offer {usd(out.expectedSalePrice)}
        </div>
      </div>
      <div className="lg:col-span-3">
        <DiscountBridge
          baseline={baseline}
          expectedSale={out.expectedSalePrice}
          staleFloor={stale}
          variant="dark"
        />
      </div>
    </div>
  );
}

function Slide4({ out }: { out: EngineOutput }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border border-dark-line bg-dark-panel p-5">
        <div className="label-kicker text-dark-muted mb-3">Mechanical holdback</div>
        <Waterfall out={out} variant="dark" />
      </div>
      <div className="grid gap-3">
        <div className="rounded-lg border border-dark-line bg-dark-panel p-5">
          <div className="label-kicker text-teal mb-1">Repair first</div>
          <div className="num text-3xl">{usd(out.listing.repairFirstNet)}</div>
          <p className="text-xs text-dark-muted mt-2">
            Net after paying holdback now and avoiding a 1.15× re-trade concession.
          </p>
        </div>
        <div className="rounded-lg border border-dark-line bg-dark-panel p-5">
          <div className="label-kicker text-amber mb-1">Price it in</div>
          <div className="num text-3xl">{usd(out.listing.priceItInNet)}</div>
          <p className="text-xs text-dark-muted mt-2">
            Expected net at the current ask, leaving inspection to the buyer. Repair ROI{" "}
            {pct(out.listing.repairRoi, 0)}.
          </p>
        </div>
      </div>
    </div>
  );
}

function Slide5({
  out,
  baseline,
  ask,
  onPrint,
  onDesk,
}: {
  out: EngineOutput;
  baseline: number;
  ask: number;
  onPrint: () => void;
  onDesk: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <PathCard
          title="Fresh path"
          kicker="Baseline ask"
          price={baseline}
          rows={[
            ["E[DOM]", `${Math.round(out.costCurve.find((p) => Math.abs(p.overshoot) < 1e-9)?.expectedDom ?? out.expectedDomDays)}d`],
            ["Net expected", usd(out.netProceedsAnchored)],
            ["Holdback", usd(out.scaledHoldback)],
          ]}
          accent="teal"
        />
        <PathCard
          title="Ambitious path"
          kicker="Current ask"
          price={ask}
          rows={[
            ["E[DOM]", `${Math.round(out.expectedDomDays)}d`],
            ["P(4+ mo)", pct(out.pStale120d, 1)],
            ["Net expected", usd(out.netProceeds)],
            [
              out.costOfTesting < 0 ? "Surplus vs baseline" : "Cost of testing",
              usd(Math.abs(out.costOfTesting)),
            ],
          ]}
          accent="amber"
        />
      </div>
      <div className="rounded-lg border border-dark-line bg-dark-panel p-4">
        <div className="label-kicker text-dark-muted mb-2">Cost surface</div>
        <CostCurve points={out.costCurve} current={out.uEff} variant="dark" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="dark" onClick={onPrint}>
          Generate 2-page PDF
        </Button>
        <Button variant="ghost" className="text-dark-ink hover:bg-dark-panel" onClick={onDesk}>
          Return to desk
        </Button>
        <span className="ml-auto self-center text-3xs text-dark-muted num">
          Risk-bounded ask {usdCompact(out.riskAsk)}
        </span>
      </div>
    </div>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dark-line bg-dark-panel px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Pip tier="FW" />
        <span className="label-kicker text-dark-muted">{label}</span>
      </div>
      <div className="num mt-1 text-2xl font-medium sm:text-3xl">{value}</div>
      <div className="text-2xs text-dark-muted">{hint}</div>
    </div>
  );
}

function PathCard({
  title,
  kicker,
  price,
  rows,
  accent,
}: {
  title: string;
  kicker: string;
  price: number;
  rows: [string, string][];
  accent: "teal" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-dark-panel p-5",
        accent === "teal" ? "border-teal/40" : "border-amber/40",
      )}
    >
      <div className={cn("label-kicker", accent === "teal" ? "text-teal" : "text-amber")}>{kicker}</div>
      <h3 className="font-display text-xl font-semibold mt-1">{title}</h3>
      <div className="num text-3xl mt-2">{usd(price)}</div>
      <dl className="mt-4 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <dt className="text-dark-muted">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
