import { EQUIPMENT_PILLS } from "@/engine/holdback";
import type { EngineOutput, EquipmentPill } from "@/engine/types";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePricer } from "@/store/pricer";
import { searchZips } from "@/data/zips";
import { useEffect, useMemo, useState } from "react";
import { Input } from "./ui/input";
import { AskSlider, Waterfall } from "./charts";

const PILLS: { id: EquipmentPill; title: string; sub: string }[] = [
  { id: "turnkey", title: "Turnkey", sub: "0–7 years" },
  { id: "average", title: "Average", sub: "8–14 years" },
  { id: "aging", title: "Original / aging", sub: "15 years +" },
];

function activePill(intake: { hvacAge: number; roofAge: number; whAge: number }): EquipmentPill | null {
  for (const id of Object.keys(EQUIPMENT_PILLS) as EquipmentPill[]) {
    const p = EQUIPMENT_PILLS[id];
    if (p.hvacAge === intake.hvacAge && p.roofAge === intake.roofAge && p.whAge === intake.whAge) {
      return id;
    }
  }
  return null;
}

export function Consumer({ out }: { out: EngineOutput }) {
  const intake = usePricer((s) => s.intake);
  const patchIntake = usePricer((s) => s.patchIntake);
  const applyZip = usePricer((s) => s.applyZip);
  const applyPill = usePricer((s) => s.applyPill);
  const [zipQ, setZipQ] = useState(intake.zip);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setZipQ(intake.zip);
  }, [intake.zip]);
  const hits = useMemo(() => searchZips(zipQ, 6), [zipQ]);
  const pill = activePill(intake);
  const cotNeg = out.costOfTesting < 0;
  const repairs = out.holdbackLines.filter((l) => l.usedFrac >= 0.7);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <p className="label-kicker">For sellers</p>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
        Two questions. Honest numbers.
      </h1>
      <p className="mt-3 text-ink-2 leading-relaxed">
        What does testing a higher price actually cost — and which repairs will show up in inspection?
      </p>

      <div className="mt-8 flex flex-col gap-6">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Where is the home?</span>
          <div className="relative">
            <Input
              value={zipQ}
              placeholder="ZIP code"
              onChange={(e) => {
                setZipQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 160)}
            />
            {open && hits.length > 0 ? (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-panel shadow-border">
                {hits.map((m) => (
                  <li key={m.zip}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-blue-soft"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setZipQ(m.zip);
                        setOpen(false);
                        applyZip(m.zip);
                      }}
                    >
                      <span>
                        {m.city}, {m.state}
                      </span>
                      <span className="num text-xs text-gray">{m.zip}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </label>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">What is it worth today?</span>
            <span className="num text-sm">{usd(intake.baselineValue)}</span>
          </div>
          <input
            type="range"
            min={200000}
            max={2500000}
            step={5000}
            value={intake.baselineValue}
            onChange={(e) => patchIntake({ baselineValue: Number(e.target.value) })}
            className="mt-2 w-full accent-blue"
          />
        </div>

        <AskSlider
          baseline={intake.baselineValue}
          value={intake.targetPrice}
          onChange={(n) => patchIntake({ targetPrice: n })}
        />

        <div>
          <div className="text-sm font-medium mb-2">Equipment condition</div>
          <div className="grid grid-cols-3 gap-2">
            {PILLS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPill(p.id)}
                className={cn(
                  "rounded-lg border px-2 py-3 text-center transition-colors min-h-11",
                  pill === p.id ? "border-ink bg-ink text-paper" : "border-line bg-panel hover:bg-gray-soft",
                )}
              >
                <div className="text-xs font-semibold">{p.title}</div>
                <div className={cn("text-3xs mt-0.5", pill === p.id ? "text-paper/70" : "text-gray")}>
                  {p.sub}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn("panel p-5", cotNeg ? "bg-teal-soft/40" : "bg-amber-soft/50")}>
            <div className="label-kicker">{cotNeg ? "The extra price helps" : "Cost of testing that price"}</div>
            <div className="num text-3xl font-medium mt-2">{usd(Math.abs(out.costOfTesting))}</div>
            <p className="text-sm text-ink-2 mt-2 leading-relaxed">
              Chance it still sits after 4 months: <span className="num font-medium text-ink">{pct(out.pStale120d, 0)}</span>.
              Typical time to a deal: <span className="num font-medium text-ink">{Math.round(out.expectedDomDays)} days</span>.
            </p>
          </div>
          <div className="panel p-5">
            <div className="label-kicker">Repairs a buyer will price in</div>
            <div className="num text-3xl font-medium mt-2">{usd(out.scaledHoldback)}</div>
            <ul className="mt-3 space-y-1.5">
              {(repairs.length ? repairs : out.holdbackLines).map((l) => (
                <li key={l.system} className="flex justify-between text-sm">
                  <span>
                    {l.system}
                    {l.terminal ? " — replace" : ""}
                  </span>
                  <span className="num">{usd(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel p-5">
          <div className="label-kicker mb-3">Where the repair budget goes</div>
          <Waterfall out={out} />
        </div>
      </div>
    </div>
  );
}
