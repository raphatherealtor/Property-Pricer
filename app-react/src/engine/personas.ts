import type {
  CommercialExt,
  CommercialMetrics,
  InvestorExt,
  InvestorMetrics,
  LenderExt,
  LenderMetrics,
  ListingMetrics,
} from "./types";

function pmt(rate: number, nper: number, pv: number): number {
  if (nper <= 0) return 0;
  if (Math.abs(rate) < 1e-12) return pv / nper;
  const pow = Math.pow(1 + rate, nper);
  return (pv * rate * pow) / (pow - 1);
}

function remainingBalance(
  orig: number,
  monthlyRate: number,
  term: number,
  elapsed: number,
): number {
  if (elapsed >= term) return 0;
  if (Math.abs(monthlyRate) < 1e-12) {
    return orig * (1 - elapsed / term);
  }
  const p = pmt(monthlyRate, term, orig);
  let bal = orig;
  for (let i = 0; i < elapsed; i++) {
    const interest = bal * monthlyRate;
    bal = bal - (p - interest);
  }
  return Math.max(0, bal);
}

function npv(monthlyRate: number, cfs: number[]): number {
  let v = 0;
  for (let t = 0; t < cfs.length; t++) {
    v += cfs[t] / Math.pow(1 + monthlyRate, t);
  }
  return v;
}

function irrMonthly(cfs: number[]): number | null {
  let r = 0.008;
  for (let i = 0; i < 40; i++) {
    const v = npv(r, cfs);
    const v2 = npv(r + 1e-6, cfs);
    const deriv = (v2 - v) / 1e-6;
    if (Math.abs(deriv) < 1e-14) break;
    const next = r - v / deriv;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - r) < 1e-10) {
      r = next;
      break;
    }
    r = next;
  }
  if (!Number.isFinite(r) || r <= -0.99 || r > 2) return null;
  return r;
}

function annualize(rM: number | null): number | null {
  return rM === null ? null : Math.pow(1 + rM, 12) - 1;
}

export function computeLender(
  ext: LenderExt,
  holdback: number,
  expectedSale: number,
): LenderMetrics {
  const lesserOfValue = Math.min(ext.appraisedValue, ext.contractPrice);
  const loanAmount = ext.ltv * lesserOfValue;
  const gapCash = Math.max(0, ext.contractPrice - ext.appraisedValue);
  const monthlyRate = ext.noteRate / 12;
  const monthlyPiti = pmt(monthlyRate, ext.termMonths, loanAmount);
  const annualDebtService = monthlyPiti * 12;
  const reserveMonths = ext.programReserveMonths > 0 ? ext.programReserveMonths : 6;
  const postCloseReserve = holdback + monthlyPiti * reserveMonths;
  const overpay = Math.max(0, ext.contractPrice - ext.appraisedValue);
  const u = ext.appraisedValue > 0 ? overpay / ext.appraisedValue : 0;
  const winnersCurseUpliftPp = 1.9 * (1 + Math.max(0, u));
  const winnersCurse = ext.contractPrice * (winnersCurseUpliftPp / 100);
  const stressValue = 0.916 * ext.appraisedValue;
  const stressLtv = stressValue > 0 ? loanAmount / stressValue : 0;
  const dscrReserves =
    annualDebtService > 0
      ? (ext.noiAnnual - holdback / 5) / annualDebtService
      : 0;
  void expectedSale;
  return {
    lesserOfValue,
    loanAmount,
    gapCash,
    monthlyPiti,
    postCloseReserve,
    winnersCurse,
    winnersCurseUpliftPp,
    stressValue,
    stressLtv,
    dscrReserves,
    annualDebtService,
  };
}

function cashflows(args: {
  purchase: number;
  exit: number;
  noi: number;
  ltv: number;
  noteRate: number;
  amortYears: number;
  ioMonths: number;
  holdM: number;
}): number[] {
  const ln = args.ltv * args.purchase;
  const eq = args.purchase - ln;
  const mRate = args.noteRate / 12;
  const amortM = Math.max(1, args.amortYears * 12);
  const aPmt = ln > 0 ? pmt(mRate, amortM, ln) : 0;
  const iPmt = ln * mRate;
  const io = Math.max(0, args.ioMonths);
  const cfs = new Array<number>(args.holdM + 1).fill(0);
  cfs[0] = -eq;
  for (let t = 1; t <= args.holdM; t++) {
    const ds = ln <= 0 ? 0 : t <= io ? iPmt : aPmt;
    cfs[t] = args.noi / 12 - ds;
  }
  const elapsedAmort = Math.max(0, args.holdM - io);
  const bal = ln > 0 ? remainingBalance(ln, mRate, amortM, elapsedAmort) : 0;
  cfs[args.holdM] += args.exit - bal;
  return cfs;
}

export function computeInvestor(
  ext: InvestorExt,
  carryAsk: number,
  carryBase: number,
  baselineValue: number,
): InvestorMetrics {
  const noi = ext.rentRollMonthly * 12 * (1 - ext.opexRatio);
  const purchase = Math.max(ext.purchasePrice, 1);
  const capEntry = noi / purchase;
  const marketCap = noi / Math.max(baselineValue, 1);
  const capExit =
    marketCap + ext.exitOvershootPct * Math.max(0, purchase / baselineValue - 1);
  const growth = 0.03;
  const holdM = Math.max(1, Math.round(ext.holdYears * 12));
  const noiExit = noi * Math.pow(1 + growth, ext.holdYears);
  const exitValue = capExit > 1e-6 ? noiExit / capExit : 0;
  const exitBase = marketCap > 1e-6 ? noiExit / marketCap : 0;
  const exitStale = exitValue * 0.916;

  const common = {
    noi,
    noteRate: ext.noteRate,
    amortYears: ext.amortYears,
    ioMonths: ext.ioMonths,
    holdM,
  };

  const irrFreshCash = annualize(
    irrMonthly(cashflows({ ...common, purchase: baselineValue, exit: exitBase, ltv: 0 })),
  );
  const irrFreshLevered = annualize(
    irrMonthly(
      cashflows({ ...common, purchase: baselineValue, exit: exitBase, ltv: ext.ltv }),
    ),
  );
  const irrStaleCash = annualize(
    irrMonthly(cashflows({ ...common, purchase, exit: exitStale, ltv: 0 })),
  );
  const irrStaleLevered = annualize(
    irrMonthly(cashflows({ ...common, purchase, exit: exitStale, ltv: ext.ltv })),
  );

  const loan = ext.ltv * purchase;
  const extraCarry = Math.max(0, carryAsk - carryBase);
  const erosionDollars =
    Math.max(0, baselineValue > 0 ? purchase - baselineValue : 0) + extraCarry;
  const erosionBps =
    irrFreshLevered !== null && irrStaleLevered !== null
      ? (irrFreshLevered - irrStaleLevered) * 10000
      : 0;
  const capExpansionBps = (capExit - capEntry) * 10000;

  return {
    noiAnnual: noi,
    capEntry,
    capExit,
    capExpansionBps,
    exitValue,
    equityIn: purchase - loan,
    irrAnnual: irrStaleLevered,
    irrBaseline: irrFreshLevered,
    irrFreshCash,
    irrFreshLevered,
    irrStaleCash,
    irrStaleLevered,
    erosionDollars,
    erosionBps,
    extraCarry,
  };
}

export function computeCommercial(
  ext: CommercialExt,
  expectedDomDays: number,
  holdback: number,
  propertyValue: number,
): CommercialMetrics {
  const absorptionMonths =
    ext.monthlyAbsorbedSf > 0 ? ext.availableSf / ext.monthlyAbsorbedSf : 99;
  const marketingMonths = expectedDomDays / (365.25 / 12);
  const marketingWeeks = expectedDomDays / 7;
  const tenants = ext.tenantRollover;
  const totalSf = tenants.reduce((s, t) => s + t.sqft, 0) || 1;
  const totalRent = tenants.reduce((s, t) => s + t.annualRent, 0) || 1;
  const sfWeightedWalt =
    tenants.reduce((s, t) => s + t.sqft * t.expiryMonth, 0) / totalSf;
  const shares = tenants.map((t) => t.annualRent / totalRent);
  const hhi = shares.reduce((s, p) => s + p * p, 0);
  const top3 = [...shares]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((s, p) => s + p, 0);
  const horizonMo = Math.max(12, marketingMonths);
  const rollingSf = tenants
    .filter((t) => t.expiryMonth <= horizonMo)
    .reduce((s, t) => s + t.sqft, 0);
  const vacancyTransmission = rollingSf / totalSf;
  const twoClockSpread =
    ext.debtMaturityMonths - Math.max(ext.waltMonths, marketingMonths);
  const noiAnnual = ext.capRateEntryPct * Math.max(propertyValue, 1);
  const ads = pmt(0.065 / 12, 300, 0.65 * Math.max(propertyValue, 1)) * 12;
  const dscrAfterReserves = ads > 0 ? (noiAnnual - holdback / 5) / ads : 0;
  return {
    absorptionMonths,
    marketingMonths,
    marketingWeeks,
    debtMaturityMonths: ext.debtMaturityMonths,
    waltMonths: ext.waltMonths,
    twoClockSpread,
    top3Concentration: top3,
    hhi,
    sfWeightedWalt,
    vacancyTransmission,
    noiAnnual,
    dscrAfterReserves,
  };
}

const STAGING_COST = 4800;

export function searchCapture(ask: number): { bracket: string; capture: number } {
  const grain = 50000;
  const lo = Math.floor(ask / grain) * grain;
  const hi = lo + grain;
  const bracket = `${usdK(lo)}–${usdK(hi)}`;
  const pos = (ask - lo) / grain;
  const capture = Math.max(0.12, 0.78 - 0.42 * pos);
  return { bracket, capture };
}

function usdK(n: number): string {
  return `$${Math.round(n / 1000)}k`;
}

export function computeListing(args: {
  baseline: number;
  ask: number;
  holdback: number;
  netAsk: number;
  netBase: number;
  carryAsk: number;
  carryBase: number;
}): ListingMetrics {
  const atAsk = searchCapture(args.ask);
  const atBase = searchCapture(args.baseline);
  const below = searchCapture(
    Math.max(1000, Math.floor(args.baseline / 50000) * 50000 - 1000),
  );
  const repairCost = args.holdback;
  const concessionAvoided = args.holdback * 1.15;
  const repairFirstNet = args.netBase - repairCost + concessionAvoided;
  const priceItInNet = args.netAsk;
  const repairRoi =
    repairCost > 0 ? (repairFirstNet - priceItInNet) / repairCost : 0;
  return {
    bracket: atAsk.bracket,
    captureAsk: atAsk.capture,
    captureBaseline: atBase.capture,
    captureBelowGrain: below.capture,
    stagingCost: STAGING_COST,
    repairFirstNet,
    priceItInNet,
    repairRoi,
    freshNet: args.netBase,
    staleNet: args.netAsk,
  };
}