import type { AssetClass, HoldbackLine } from "./types";

const LIFE = { hvac: 15, roof: 20, wh: 10 } as const;

const RES_RATE = { hvac: 4.5, roof: 9.5, wh: 1.2 } as const;
const COM_RATE = { hvac: 4.0, roof: 7.5, wh: 0.5 } as const;

export function classMultiplier(baselinePerSf: number): number {
  if (baselinePerSf <= 150) return 0.75;
  if (baselinePerSf >= 350) return 1.9;
  return 1;
}

function line(
  system: HoldbackLine["system"],
  age: number,
  life: number,
  rate: number,
  gla: number,
  mClass: number,
): HoldbackLine {
  const used = Math.min(1, Math.max(0, age / life));
  const terminal = age >= life;
  const ramp = terminal ? 1 : used;
  const amount = rate * gla * ramp * mClass;
  return {
    system,
    age,
    life,
    ratePerSf: rate,
    usedFrac: used,
    amount,
    terminal,
    tier: "EA",
  };
}

export function computeHoldback(args: {
  glaSqft: number;
  baselineValue: number;
  hvacAge: number;
  roofAge: number;
  whAge: number;
  assetClass: AssetClass;
}): {
  lines: HoldbackLine[];
  total: number;
  fullReplacement: number;
  mClass: number;
} {
  const perSf = args.baselineValue / Math.max(args.glaSqft, 1);
  const mClass = classMultiplier(perSf);
  const rates = args.assetClass === "commercial" ? COM_RATE : RES_RATE;
  const gla = args.glaSqft;
  const lines: HoldbackLine[] = [
    line("HVAC", args.hvacAge, LIFE.hvac, rates.hvac, gla, mClass),
    line("Roof", args.roofAge, LIFE.roof, rates.roof, gla, mClass),
    line("Water Heater", args.whAge, LIFE.wh, rates.wh, gla, mClass),
  ];
  const fullReplacement =
    (rates.hvac + rates.roof + rates.wh) * gla * mClass;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, fullReplacement, mClass };
}

export const EQUIPMENT_PILLS = {
  turnkey: { hvacAge: 4, roofAge: 5, whAge: 3 },
  average: { hvacAge: 11, roofAge: 12, whAge: 8 },
  aging: { hvacAge: 16, roofAge: 22, whAge: 12 },
} as const;
