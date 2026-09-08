/**
 * v1.6 National Shape Survival Curve (S_base) and closed-form integrals.
 * Hazard steps are framework-sourced (listing-decay literature).
 */

export const H1 = 0.098;
export const H2 = 0.084;
export const H3 = 0.062;
export const HP = 0.018;

export const S1 = 1 - H1; // 0.902
export const S2 = S1 * (1 - H2); // 0.826232
export const S3 = S2 * (1 - H3); // ≈ 0.775005616

const LN_SURV_P = Math.log(1 - HP);

/** Median of S_base: solve S_base(w) = 0.5 in the week-4+ plateau. */
export const M_BASE =
  3 + Math.log(0.5 / S3) / LN_SURV_P; /* ≈ 27.127 weeks (~190 d) */

export const HORIZON_WEEKS = 26;
export const DILATION_LAMBDA = 4.0; // EA: overpricing → time dilation

export function sBase(w: number): number {
  if (w <= 0) return 1;
  if (w <= 1) return 1 - H1 * w;
  if (w <= 2) return S1 * (1 - H2 * (w - 1));
  if (w <= 3) return S2 * (1 - H3 * (w - 2));
  return S3 * Math.pow(1 - HP, w - 3);
}

/** ∫_0^w S_base(t) dt — piecewise antiderivative. */
export function integS(w: number): number {
  if (w <= 0) return 0;
  const I1 = 1 - H1 / 2;
  const I2 = I1 + S1 * (1 - H2 / 2);
  const I3 = I2 + S2 * (1 - H3 / 2);
  if (w <= 1) return w - (H1 * w * w) / 2;
  if (w <= 2) {
    const u = w - 1;
    return I1 + S1 * (u - (H2 * u * u) / 2);
  }
  if (w <= 3) {
    const u = w - 2;
    return I2 + S2 * (u - (H3 * u * u) / 2);
  }
  const u = w - 3;
  return I3 + (S3 * (Math.pow(1 - HP, u) - 1)) / LN_SURV_P;
}

export function integSRange(a: number, b: number): number {
  return integS(Math.max(b, 0)) - integS(Math.max(a, 0));
}

/**
 * Time-warped survival S_zip(w) = S_base(κ · w).
 * E[min(T, H)] = ∫_0^H S_base(κ w) dw = integS(κ H) / κ
 */
export function expectedCappedWeeks(kappa: number, horizon = HORIZON_WEEKS): number {
  if (kappa <= 1e-9) return horizon;
  const kH = kappa * horizon;
  return integS(kH) / kappa;
}

export function p50Weeks(kappa: number): number {
  if (kappa <= 1e-9) return M_BASE * 100;
  return M_BASE / kappa;
}

export function sWarped(kappa: number, w: number): number {
  return sBase(kappa * w);
}

/** Conditional S(w | T > s) for already-listed inventory. */
export function sConditional(kappa: number, w: number, sWeeks: number): number {
  if (sWeeks <= 0) return sWarped(kappa, w);
  const denom = sWarped(kappa, sWeeks);
  if (denom <= 1e-12) return 0;
  if (w <= sWeeks) return 1;
  return sWarped(kappa, w) / denom;
}

/**
 * E[min(T, H) | T > s] = s + ∫_s^H S_base(κ w) dw / S_base(κ s)
 */
export function expectedCappedWeeksConditional(
  kappa: number,
  sWeeks: number,
  horizon = HORIZON_WEEKS,
): number {
  if (sWeeks <= 0) return expectedCappedWeeks(kappa, horizon);
  if (sWeeks >= horizon) return sWeeks;
  const denom = sWarped(kappa, sWeeks);
  if (denom <= 1e-12) return sWeeks;
  const integral = integSRange(kappa * sWeeks, kappa * horizon) / kappa;
  return sWeeks + integral / denom;
}

export function survivalPath(kappa: number, n = 53): { w: number; s: number }[] {
  const pts: { w: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    const w = (HORIZON_WEEKS * i) / (n - 1);
    pts.push({ w, s: sWarped(kappa, w) });
  }
  return pts;
}
