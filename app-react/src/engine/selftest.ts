import { compute } from "./compute";
import { DEFAULT_COMMERCIAL, DEFAULT_INTAKE, DEFAULT_INVESTOR, DEFAULT_LENDER } from "./defaults";
import { censoringInflation, kappaEff, solveKappaT, uEff } from "./kappa";
import { computeHoldback } from "./holdback";
import { H1, H2, H3, HP, M_BASE, S1, S2, S3, sBase } from "./survival";

export interface Assertion {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
}

function close(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

export function runSelfTest(): Assertion[] {
  const out: Assertion[] = [];
  const push = (
    id: number,
    name: string,
    pass: boolean,
    expected: string,
    actual: string,
  ) => out.push({ id, name, pass, expected, actual });

  // 1–4 closed-form knots
  push(1, "S_base(0) = 1", close(sBase(0), 1, 1e-12), "1", sBase(0).toFixed(6));
  push(2, "S_base(1) = 1 − h₁", close(sBase(1), S1, 1e-12), S1.toFixed(6), sBase(1).toFixed(6));
  push(3, "S_base(2) = (1−h₁)(1−h₂)", close(sBase(2), S2, 1e-12), S2.toFixed(6), sBase(2).toFixed(6));
  push(4, "S_base(3) ≈ 0.7750", close(sBase(3), S3, 1e-12) && close(S3, 0.7750, 5e-4), "~0.7750", S3.toFixed(6));

  // 5 median knot
  push(
    5,
    "S_base(M_base) = 0.5",
    close(sBase(M_BASE), 0.5, 1e-10) && close(M_BASE, 27.1282, 0.01),
    "0.5 @ ~27.1282 wk",
    `${sBase(M_BASE).toFixed(8)} @ ${M_BASE.toFixed(4)} wk`,
  );

  // 6 κ_t fixed point for 40d closed
  const k40 = solveKappaT(40, "closed_only");
  const kExpect = M_BASE / (40 / 7);
  push(
    6,
    "κ_t fixed point (40d closed, infl=1)",
    close(k40.kappaT, kExpect, 1e-6) && close(k40.infl, 1, 1e-9),
    kExpect.toFixed(4),
    k40.kappaT.toFixed(4),
  );

  // 7 dilation at +5%
  const u = uEff(600000, 630000);
  const ke = kappaEff(k40.kappaT, u);
  const keExpect = k40.kappaT * Math.exp(-4 * 0.05);
  push(
    7,
    "κ_eff = κ_t · e^{−4u} at +5%",
    close(u, 0.05, 1e-12) && close(ke, keExpect, 1e-8),
    keExpect.toFixed(4),
    ke.toFixed(4),
  );

  // 8–9 verification case
  const bundle = {
    intake: { ...DEFAULT_INTAKE },
    lender: { ...DEFAULT_LENDER },
    investor: { ...DEFAULT_INVESTOR },
    commercial: { ...DEFAULT_COMMERCIAL },
  };
  const r = compute(bundle);
  push(
    8,
    "P(>120d) ≈ 24.4% at +5% / 40d ZIP",
    close(r.pStale120d, 0.244, 0.008),
    "≈ 24.4%",
    `${(r.pStale120d * 100).toFixed(2)}%`,
  );
  push(
    9,
    "Direction coherence: p50 < 120d ⇒ P(>120d) < 0.5",
    r.p50DomDays < 120 && r.pStale120d < 0.5,
    "p50<120 & P<0.5",
    `p50=${r.p50DomDays.toFixed(1)}d  P=${(r.pStale120d * 100).toFixed(1)}%`,
  );

  // 10 convex cost scaling
  const c5 = r.costCurve.find((p) => close(p.overshoot, 0.05, 1e-9));
  const c10 = r.costCurve.find((p) => close(p.overshoot, 0.1, 1e-9));
  const c15 = r.costCurve.find((p) => close(p.overshoot, 0.15, 1e-9));
  const d1 = (c10?.cost ?? 0) - (c5?.cost ?? 0);
  const d2 = (c15?.cost ?? 0) - (c10?.cost ?? 0);
  push(
    10,
    "Convex cost scaling (second difference > 0 on 5–15%)",
    d2 > d1,
    "Δ(10→15) > Δ(5→10)",
    `Δ1=${d1.toFixed(0)}  Δ2=${d2.toFixed(0)}`,
  );

  // 11 median coherence
  const p50Expect = 7 * (M_BASE / r.kappaEff);
  push(
    11,
    "Median coherence p50 = 7 · M_base / κ_eff",
    close(r.p50DomDays, p50Expect, 0.05),
    p50Expect.toFixed(2),
    r.p50DomDays.toFixed(2),
  );

  // 12 monotonic: higher ask → higher P(>120d)
  const low = compute({
    ...bundle,
    intake: { ...bundle.intake, targetPrice: 600000 },
  });
  const high = compute({
    ...bundle,
    intake: { ...bundle.intake, targetPrice: 660000 },
  });
  push(
    12,
    "Monotone: higher ask raises E[DOM] and P(>120d)",
    high.expectedDomDays > low.expectedDomDays && high.pStale120d > low.pStale120d,
    "E[DOM]↑ and P↑",
    `E ${low.expectedDomDays.toFixed(1)}→${high.expectedDomDays.toFixed(1)}  P ${(low.pStale120d * 100).toFixed(1)}→${(high.pStale120d * 100).toFixed(1)}`,
  );

  // 13 holdback full replacement = $30,400 at 2000 sf / $300/sf
  const hb = computeHoldback({
    glaSqft: 2000,
    baselineValue: 600000,
    hvacAge: 15,
    roofAge: 20,
    whAge: 10,
    assetClass: "residential",
  });
  push(
    13,
    "Full-replacement holdback = $30,400 (2,000 sf · $15.20)",
    close(hb.fullReplacement, 30400, 0.5) && close(hb.total, 30400, 0.5),
    "30400",
    hb.total.toFixed(0),
  );

  // 14 slow-market inflation + S knots sanity (h constants)
  const kSlow = solveKappaT(220, "closed_only");
  push(
    14,
    "Slow-market infl(κ) ∈ (1, 1.63] and hazards sum-check",
    kSlow.infl > 1.02 &&
      kSlow.infl <= 1.63 &&
      close(H1 + H2 + H3 + HP, 0.262, 1e-9) &&
      censoringInflation(2) === 1,
    "infl(slow)∈(1,1.63], Σh=0.262",
    `infl=${kSlow.infl.toFixed(3)}  Σh=${(H1 + H2 + H3 + HP).toFixed(3)}`,
  );

  return out;
}

export function selfTestSummary(rows = runSelfTest()): {
  passed: number;
  failed: number;
  total: number;
  rows: Assertion[];
} {
  const passed = rows.filter((r) => r.pass).length;
  return { passed, failed: rows.length - passed, total: rows.length, rows };
}
