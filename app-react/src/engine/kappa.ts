import { M_BASE } from "./survival";
import type { DomClockBasis } from "./types";

const DAYS_PER_MONTH = 365.25 / 12;
export const WEEKS_PER_MONTH = DAYS_PER_MONTH / 7; // ≈ 4.34821

/**
 * Closed-only MLS exports omit failed/withdrawn listings (informative
 * right-censoring). Slow submarkets understate DOM by up to 1.63×.
 * Fast markets (κ ≥ 1) need no inflation.
 */
export function censoringInflation(kappa: number): number {
  if (kappa >= 1) return 1;
  if (kappa <= 0) return 1.63;
  const t = kappa;
  const smooth = t * t * (3 - 2 * t);
  return 1.63 - 0.63 * smooth;
}

export function solveKappaT(
  closedMedianDays: number,
  basis: DomClockBasis,
): {
  kappaT: number;
  mClosedWeeks: number;
  mAllWeeks: number;
  infl: number;
  iterations: number;
} {
  const mClosedWeeks = Math.max(closedMedianDays, 1) / 7;
  if (basis === "cumulative") {
    const kappa = M_BASE / mClosedWeeks;
    return {
      kappaT: kappa,
      mClosedWeeks,
      mAllWeeks: mClosedWeeks,
      infl: 1,
      iterations: 0,
    };
  }
  let kappa = M_BASE / mClosedWeeks;
  let infl = 1;
  let mAll = mClosedWeeks;
  let iterations = 0;
  for (let i = 0; i < 8; i++) {
    infl = censoringInflation(kappa);
    mAll = mClosedWeeks * infl;
    const next = M_BASE / mAll;
    iterations = i + 1;
    if (Math.abs(next - kappa) < 1e-8) {
      kappa = next;
      break;
    }
    kappa = next;
  }
  return { kappaT: kappa, mClosedWeeks, mAllWeeks: mAll, infl, iterations };
}

export function kappaFromUii(uiiMonths: number): number {
  const m = Math.max(uiiMonths, 0.25) * WEEKS_PER_MONTH;
  return M_BASE / m;
}

/**
 * Overpricing enters strictly through time dilation:
 *   u_eff = (P_ask / P_baseline) − 1
 *   κ_eff = κ_t · exp(−λ · u_eff)
 * λ = 4 is an engine assumption (EA), calibrated so +5% in a 40-day
 * closed-median submarket yields P(>120d) ≈ 24.4%.
 */
export function uEff(baseline: number, ask: number): number {
  if (baseline <= 0) return 0;
  const u = ask / baseline - 1;
  return Math.max(-0.2, Math.min(0.5, u));
}

export function kappaEff(kappaT: number, u: number, lambda = 4): number {
  return kappaT * Math.exp(-lambda * u);
}
