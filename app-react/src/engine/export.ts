import { DILATION_LAMBDA } from "./survival";
import type { ComputeBundle, EngineOutput, ScenarioExport } from "./types";

export function buildScenarioExport(
  bundle: ComputeBundle,
  out: EngineOutput,
  exportedAt: string,
): ScenarioExport {
  return {
    version: out.calcVersion,
    exportedAt,
    caseId: out.caseId,
    inputHash: out.inputHash,
    marketTemp: out.marketTemp,
    readConfidence: out.readConfidence,
    flags: [...out.flags],
    intake: { ...bundle.intake },
    extensions: {
      lender: { ...bundle.lender },
      investor: { ...bundle.investor },
      commercial: {
        ...bundle.commercial,
        tenantRollover: bundle.commercial.tenantRollover.map((t) => ({ ...t })),
      },
    },
    calibrations: {
      uEff: out.uEff,
      kappaT: out.kappaT,
      kappaEff: out.kappaEff,
      kappaUii: out.kappaUii,
      infl: out.infl,
      mClosedWeeks: out.mClosedWeeks,
      mAllWeeks: out.mAllWeeks,
      tension: out.tension,
      dilationLambda: DILATION_LAMBDA,
    },
    survival: {
      expectedDomDays: out.expectedDomDays,
      remainingDomDays: out.remainingDomDays,
      p50DomDays: out.p50DomDays,
      pStale120d: out.pStale120d,
      pSold2wk: out.pSold2wk,
      expectedDiscountPct: out.expectedDiscountPct,
      expectedSalePrice: out.expectedSalePrice,
    },
    economics: {
      carryTotal: out.carryTotal,
      costOfTesting: out.costOfTesting,
      netProceeds: out.netProceeds,
      netProceedsAnchored: out.netProceedsAnchored,
      scaledHoldback: out.scaledHoldback,
      holdbackFullReplacement: out.holdbackFullReplacement,
      classMultiplier: out.classMultiplier,
      holdbackLines: out.holdbackLines.map((l) => ({ ...l })),
    },
    personas: {
      listing: { ...out.listing },
      lender: { ...out.lender },
      investor: { ...out.investor },
      commercial: { ...out.commercial },
    },
  };
}