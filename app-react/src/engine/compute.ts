import { hashInputs } from "../lib/format";
import { computeHoldback } from "./holdback";
import {
  kappaEff,
  kappaFromUii,
  solveKappaT,
  uEff,
} from "./kappa";
import {
  computeCommercial,
  computeInvestor,
  computeLender,
  computeListing,
} from "./personas";
import {
  DILATION_LAMBDA,
  HORIZON_WEEKS,
  expectedCappedWeeks,
  expectedCappedWeeksConditional,
  p50Weeks,
  sConditional,
  sWarped,
  survivalPath,
} from "./survival";
import { CALC_VERSION, type ComputeBundle, type CostPoint, type EngineOutput, type FlagCode, type MarketTemp, type ReadConfidence, type TraceRow } from "./types";

const CARRY_MONTH = 0.007;
const DAYS_PER_MONTH = 365.25 / 12;

export function discountAtDays(t: number): number {
  if (t <= 60) return 0.019;
  if (t >= 120) return 0.084;
  return 0.019 + (0.084 - 0.019) * ((t - 60) / 60);
}

function expectedDiscount(kappa: number, sWeeks: number): number {
  const H = HORIZON_WEEKS;
  const N = 260;
  const dw = H / N;
  let acc = 0;
  const s0 = sWeeks > 0 ? sWarped(kappa, sWeeks) : 1;
  if (s0 <= 1e-12) return 0.084;
  for (let i = 0; i < N; i++) {
    const w0 = dw * i;
    const w1 = dw * (i + 1);
    if (w1 <= sWeeks) continue;
    const a = Math.max(w0, sWeeks);
    const p = (sWarped(kappa, a) - sWarped(kappa, w1)) / s0;
    const tmid = 7 * (a + w1) / 2;
    acc += discountAtDays(tmid) * Math.max(0, p);
  }
  const pRemain = sWarped(kappa, Math.max(H, sWeeks)) / s0;
  acc += 0.084 * Math.max(0, pRemain);
  return acc;
}

function marketTemp(kappaT: number): MarketTemp {
  if (kappaT >= 2.2) return "HOT";
  if (kappaT >= 1.35) return "WARM";
  if (kappaT >= 0.8) return "BALANCED";
  if (kappaT >= 0.5) return "COOL";
  return "COLD";
}

function carryDollars(price: number, domDays: number): number {
  return CARRY_MONTH * price * (domDays / DAYS_PER_MONTH);
}

function netAt(
  ask: number,
  kappaT: number,
  sWeeks: number,
  holdback: number,
): { net: number; sale: number; carry: number; eDom: number; eDisc: number; pStale: number; p2wk: number; p50: number; kEff: number; u: number } {
  const kEff = kappaT;
  const eDomW =
    sWeeks > 0
      ? expectedCappedWeeksConditional(kEff, sWeeks)
      : expectedCappedWeeks(kEff);
  const eDom = eDomW * 7;
  const eDisc = expectedDiscount(kEff, sWeeks);
  const sale = ask * (1 - eDisc);
  const carry = carryDollars(ask, eDom);
  const net = sale - carry - holdback;
  const pStale =
    sWeeks > 0
      ? sConditional(kEff, 120 / 7, sWeeks)
      : sWarped(kEff, 120 / 7);
  const p2wk =
    sWeeks > 0
      ? 1 - sConditional(kEff, sWeeks + 2, sWeeks)
      : 1 - sWarped(kEff, 2);
  const p50 = p50Weeks(kEff) * 7;
  return { net, sale, carry, eDom, eDisc, pStale, p2wk, p50, kEff, u: 0 };
}

export function compute(bundle: ComputeBundle): EngineOutput {
  const { intake, lender, investor, commercial } = bundle;
  const sWeeks = intake.actualDom && intake.actualDom > 0 ? intake.actualDom / 7 : 0;

  const kSolve = solveKappaT(intake.medianDomZip, intake.domClockBasis);
  const kUii = kappaFromUii(intake.uiiMonths);
  const tension = (kSolve.kappaT - kUii) / Math.max(0.15, (Math.abs(kSolve.kappaT) + Math.abs(kUii)) / 2);

  const u = uEff(intake.baselineValue, intake.targetPrice);
  const kEff = kappaEff(kSolve.kappaT, u, DILATION_LAMBDA);

  const hb = computeHoldback(intake);

  const atAsk = netAt(intake.targetPrice, kEff, sWeeks, hb.total);
  const atBase = netAt(
    intake.baselineValue,
    kappaEff(kSolve.kappaT, 0, DILATION_LAMBDA),
    sWeeks,
    hb.total,
  );

  const costOfTesting = atBase.net - atAsk.net;

  const flags: FlagCode[] = [];
  if (Math.abs(tension) > 0.35) flags.push("VELOCITY_TENSION");
  if (kSolve.infl > 1.02 && intake.domClockBasis !== "cumulative") {
    flags.push("CENSORING_INFLATION_APPLIED");
  }
  for (const line of hb.lines) {
    if (line.terminal) {
      if (line.system === "HVAC") flags.push("TERMINAL_HVAC");
      if (line.system === "Roof") flags.push("TERMINAL_ROOF");
      if (line.system === "Water Heater") flags.push("TERMINAL_WH");
    }
  }
  if (u > 0.12) flags.push("EXTREME_OVERSHOOT");
  if (intake.medianDomZip >= 180) flags.push("SPARSE_ZIP");
  if (sWeeks * 7 >= 90) flags.push("STALE_LISTING");

  let conf: ReadConfidence = "HIGH";
  if (flags.includes("SPARSE_ZIP") || flags.length >= 3 || Math.abs(u) > 0.2) {
    conf = "LOW";
  } else if (flags.length >= 1 || Math.abs(tension) > 0.25) {
    conf = "MEDIUM";
  }

  const costCurve = scanCostCurve(intake.baselineValue, kSolve.kappaT, sWeeks, hb.total);
  let best = costCurve[0];
  let riskBest = costCurve[0];
  let haveRisk = false;
  for (const p of costCurve) {
    if (p.net > best.net) best = p;
    if (p.pStale <= 0.35 && (!haveRisk || p.net > riskBest.net)) {
      riskBest = p;
      haveRisk = true;
    }
  }
  if (!haveRisk) riskBest = best;

  const lenderM = computeLender(
    { ...lender, contractPrice: intake.targetPrice, appraisedValue: lender.appraisedValue || intake.baselineValue },
    hb.total,
    atAsk.sale,
  );
  const investorM = computeInvestor(
    { ...investor, purchasePrice: investor.purchasePrice || intake.targetPrice },
    atAsk.carry,
    atBase.carry,
    intake.baselineValue,
  );
  const commercialM = computeCommercial(
    commercial,
    atAsk.eDom,
    hb.total,
    intake.baselineValue,
  );
  const listingM = computeListing({
    baseline: intake.baselineValue,
    ask: intake.targetPrice,
    holdback: hb.total,
    netAsk: atAsk.net,
    netBase: atBase.net,
    carryAsk: atAsk.carry,
    carryBase: atBase.carry,
  });

  const remaining =
    sWeeks > 0 ? Math.max(0, atAsk.eDom - sWeeks * 7) : atAsk.eDom;

  const hash = hashInputs({
    v: CALC_VERSION,
    zip: intake.zip,
    b: intake.baselineValue,
    a: intake.targetPrice,
    d: intake.actualDom,
    m: intake.medianDomZip,
    u: intake.uiiMonths,
    g: intake.glaSqft,
    h: [intake.hvacAge, intake.roofAge, intake.whAge],
  });

  const trace: TraceRow[] = [
    { key: "h1", label: "h₁ week-1 hazard", value: Hfmt(0.098), tier: "FW", note: "National shape" },
    { key: "h2", label: "h₂ week-2 hazard", value: Hfmt(0.084), tier: "FW" },
    { key: "h3", label: "h₃ week-3 hazard", value: Hfmt(0.062), tier: "FW" },
    { key: "hp", label: "hₚ plateau hazard", value: Hfmt(0.018), tier: "FW" },
    { key: "mbase", label: "M_base (national median)", value: `${(27.1282).toFixed(4)} wk`, tier: "FW" },
    { key: "mClosed", label: "Closed median (ZIP)", value: `${kSolve.mClosedWeeks.toFixed(3)} wk`, tier: "FW" },
    { key: "infl", label: "Censoring infl(κ)", value: kSolve.infl.toFixed(4), tier: "FW", note: kSolve.infl > 1.02 ? "Applied" : "Fast-market identity" },
    { key: "mAll", label: "All-listings median (corrected)", value: `${kSolve.mAllWeeks.toFixed(3)} wk`, tier: "FW" },
    { key: "kappaT", label: "κ_t submarket warp", value: kSolve.kappaT.toFixed(4), tier: "FW" },
    { key: "kappaUii", label: "κ_UII prior", value: kUii.toFixed(4), tier: "EA" },
    { key: "tension", label: "Velocity tension", value: `${(tension * 100).toFixed(1)}%`, tier: "EA" },
    { key: "uEff", label: "u_eff overshoot", value: `${(u * 100).toFixed(2)}%`, tier: "FW" },
    { key: "lambda", label: "Dilation λ", value: DILATION_LAMBDA.toFixed(1), tier: "EA" },
    { key: "kappaEff", label: "κ_eff = κ_t·e^{−λu}", value: kEff.toFixed(4), tier: "EA" },
    { key: "eDisc", label: "E[d] integrated discount", value: `${(atAsk.eDisc * 100).toFixed(2)}%`, tier: "FW" },
    { key: "eDom", label: "E[min(T,26)]", value: `${atAsk.eDom.toFixed(1)} d`, tier: "FW" },
    { key: "p50", label: "p₅₀ DOM", value: `${atAsk.p50.toFixed(1)} d`, tier: "FW" },
    { key: "p2", label: "P(≤ 2 wk)", value: `${(atAsk.p2wk * 100).toFixed(1)}%`, tier: "FW" },
    { key: "p120", label: "P(> 120 d)", value: `${(atAsk.pStale * 100).toFixed(1)}%`, tier: "FW" },
    { key: "carry", label: "Carry @ 70 bps/mo", value: money(atAsk.carry), tier: "EA" },
    { key: "hb", label: "Scaled holdback", value: money(hb.total), tier: "EA" },
    { key: "mClass", label: "Class multiplier M_class", value: hb.mClass.toFixed(2), tier: "EA" },
    { key: "net", label: "Expected net proceeds", value: money(atAsk.net), tier: "EA" },
    { key: "anchor", label: "Anchored net (u=0)", value: money(atBase.net), tier: "EA" },
    { key: "cot", label: "Cost of testing", value: money(costOfTesting), tier: "EA" },
  ];

  return {
    calcVersion: CALC_VERSION,
    computedAt: "",
    inputHash: hash,
    caseId: `PP-${hash.slice(0, 8).toUpperCase()}`,
    uEff: u,
    kappaT: kSolve.kappaT,
    kappaEff: kEff,
    kappaUii: kUii,
    infl: kSolve.infl,
    mClosedWeeks: kSolve.mClosedWeeks,
    mAllWeeks: kSolve.mAllWeeks,
    tension,
    expectedDomDays: atAsk.eDom,
    remainingDomDays: remaining,
    p50DomDays: atAsk.p50,
    pStale120d: atAsk.pStale,
    pSold2wk: atAsk.p2wk,
    expectedDiscountPct: atAsk.eDisc,
    expectedSalePrice: atAsk.sale,
    carryTotal: atAsk.carry,
    costOfTesting,
    scaledHoldback: hb.total,
    holdbackFullReplacement: hb.fullReplacement,
    classMultiplier: hb.mClass,
    holdbackLines: hb.lines,
    netProceeds: atAsk.net,
    netProceedsAnchored: atBase.net,
    marketTemp: marketTemp(kSolve.kappaT),
    readConfidence: conf,
    flags,
    trace,
    survival: survivalPath(kEff),
    costCurve,
    optimalAsk: best.ask,
    optimalOvershoot: best.overshoot,
    riskAsk: riskBest.ask,
    riskOvershoot: riskBest.overshoot,
    lender: lenderM,
    investor: investorM,
    commercial: commercialM,
    listing: listingM,
  };
}

function scanCostCurve(
  baseline: number,
  kappaT: number,
  sWeeks: number,
  holdback: number,
): CostPoint[] {
  const pts: CostPoint[] = [];
  const atBase = netAt(baseline, kappaEff(kappaT, 0), sWeeks, holdback);
  for (let i = -10; i <= 60; i++) {
    const overshoot = i / 200; // -5% … +30% in 0.5% steps
    const ask = baseline * (1 + overshoot);
    const k = kappaEff(kappaT, uEff(baseline, ask));
    const n = netAt(ask, k, sWeeks, holdback);
    pts.push({
      overshoot,
      ask,
      cost: atBase.net - n.net,
      net: n.net,
      expectedDom: n.eDom,
      pStale: n.pStale,
    });
  }
  return pts;
}

function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function Hfmt(n: number): string {
  return n.toFixed(3);
}

export { CARRY_MONTH };
