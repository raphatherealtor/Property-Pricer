import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { selfTestSummary } = await jiti.import("../src/engine/selftest.ts");
const { compute } = await jiti.import("../src/engine/compute.ts");
const defaults = await jiti.import("../src/engine/defaults.ts");
const surv = await jiti.import("../src/engine/survival.ts");

const s = selfTestSummary();
console.log("M_BASE", surv.M_BASE, "S3", surv.S3, "S(M)", surv.sBase(surv.M_BASE));
for (const r of s.rows) {
  console.log((r.pass ? "PASS" : "FAIL") + " #" + r.id, r.name, "| exp", r.expected, "| act", r.actual);
}
console.log("RESULT", s.passed + "/" + s.total);
const r = compute({
  intake: defaults.DEFAULT_INTAKE,
  lender: defaults.DEFAULT_LENDER,
  investor: defaults.DEFAULT_INVESTOR,
  commercial: defaults.DEFAULT_COMMERCIAL,
});
console.log("kT", r.kappaT, "kEff", r.kappaEff, "u", r.uEff);
console.log("E[DOM]", r.expectedDomDays, "p50", r.p50DomDays, "P120", r.pStale120d, "P2w", r.pSold2wk);
console.log("E[d]", r.expectedDiscountPct, "sale", r.expectedSalePrice, "cot", r.costOfTesting, "net", r.netProceeds);
console.log("hb", r.scaledHoldback, "full", r.holdbackFullReplacement);
console.log("temp", r.marketTemp, "conf", r.readConfidence, "flags", r.flags);
console.log("opt", r.optimalAsk, r.optimalOvershoot);
