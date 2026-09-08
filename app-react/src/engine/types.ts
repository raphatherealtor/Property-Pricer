export const CALC_VERSION = "1.6.1" as const;

export type ListingState =
  | "pre_listing"
  | "active"
  | "pending"
  | "closed"
  | "withdrawn";

export type DomClockBasis = "closed_only" | "cumulative" | "unknown";
export type ReadConfidence = "HIGH" | "MEDIUM" | "LOW";
export type Persona = "listing" | "lender" | "investor" | "commercial";
export type EvidenceTier = "FW" | "EA";
export type AppMode = "desk" | "screen" | "consumer";
export type AssetClass = "residential" | "commercial";
export type MarketTemp = "HOT" | "WARM" | "BALANCED" | "COOL" | "COLD";
export type EquipmentPill = "turnkey" | "average" | "aging";

export type FlagCode =
  | "VELOCITY_TENSION"
  | "CENSORING_INFLATION_APPLIED"
  | "TERMINAL_HVAC"
  | "TERMINAL_ROOF"
  | "TERMINAL_WH"
  | "EXTREME_OVERSHOOT"
  | "SPARSE_ZIP"
  | "STALE_LISTING";

export interface TenantRoll {
  sqft: number;
  expiryMonth: number;
  annualRent: number;
  credit: "A" | "BBB" | "NR";
}

export interface CoreIntake {
  zip: string;
  baselineValue: number;
  targetPrice: number;
  listingState: ListingState;
  actualDom: number | null;
  uiiMonths: number;
  medianDomZip: number;
  domClockBasis: DomClockBasis;
  glaSqft: number;
  hvacAge: number;
  roofAge: number;
  whAge: number;
  assetClass: AssetClass;
}

export interface LenderExt {
  ltv: number;
  noteRate: number;
  termMonths: number;
  loanType: string;
  appraisedValue: number;
  programReserveMonths: number;
  contractPrice: number;
  noiAnnual: number;
}

export interface InvestorExt {
  purchasePrice: number;
  rentRollMonthly: number;
  holdYears: number;
  exitOvershootPct: number;
  opexRatio: number;
  ltv: number;
  noteRate: number;
  amortYears: number;
  ioMonths: number;
}

export interface CommercialExt {
  availableSf: number;
  monthlyAbsorbedSf: number;
  waltMonths: number;
  capRateEntryPct: number;
  tenantRollover: TenantRoll[];
  debtMaturityMonths: number;
}

export interface TraceRow {
  key: string;
  label: string;
  value: string;
  tier: EvidenceTier;
  note?: string;
}

export interface HoldbackLine {
  system: "HVAC" | "Roof" | "Water Heater";
  age: number;
  life: number;
  ratePerSf: number;
  usedFrac: number;
  amount: number;
  terminal: boolean;
  tier: EvidenceTier;
}

export interface LenderMetrics {
  lesserOfValue: number;
  loanAmount: number;
  gapCash: number;
  monthlyPiti: number;
  postCloseReserve: number;
  winnersCurse: number;
  winnersCurseUpliftPp: number;
  stressValue: number;
  stressLtv: number;
  dscrReserves: number;
  annualDebtService: number;
}

export interface InvestorMetrics {
  noiAnnual: number;
  capEntry: number;
  capExit: number;
  capExpansionBps: number;
  exitValue: number;
  equityIn: number;
  irrAnnual: number | null;
  irrBaseline: number | null;
  irrFreshCash: number | null;
  irrFreshLevered: number | null;
  irrStaleCash: number | null;
  irrStaleLevered: number | null;
  erosionDollars: number;
  erosionBps: number;
  extraCarry: number;
}

export interface CommercialMetrics {
  absorptionMonths: number;
  marketingMonths: number;
  marketingWeeks: number;
  debtMaturityMonths: number;
  waltMonths: number;
  twoClockSpread: number;
  top3Concentration: number;
  hhi: number;
  sfWeightedWalt: number;
  vacancyTransmission: number;
  noiAnnual: number;
  dscrAfterReserves: number;
}

export interface ListingMetrics {
  bracket: string;
  captureAsk: number;
  captureBaseline: number;
  captureBelowGrain: number;
  stagingCost: number;
  repairFirstNet: number;
  priceItInNet: number;
  repairRoi: number;
  freshNet: number;
  staleNet: number;
}

export type KpiTone = "default" | "good" | "warn" | "bad" | "hot";

export interface KpiItem {
  label: string;
  value: string;
  hint?: string;
  tier: EvidenceTier;
  tone: KpiTone;
}

export interface ScenarioCalibrations {
  uEff: number;
  kappaT: number;
  kappaEff: number;
  kappaUii: number;
  infl: number;
  mClosedWeeks: number;
  mAllWeeks: number;
  tension: number;
  dilationLambda: number;
}

export interface ScenarioSurvival {
  expectedDomDays: number;
  remainingDomDays: number;
  p50DomDays: number;
  pStale120d: number;
  pSold2wk: number;
  expectedDiscountPct: number;
  expectedSalePrice: number;
}

export interface ScenarioEconomics {
  carryTotal: number;
  costOfTesting: number;
  netProceeds: number;
  netProceedsAnchored: number;
  scaledHoldback: number;
  holdbackFullReplacement: number;
  classMultiplier: number;
  holdbackLines: HoldbackLine[];
}

export interface ScenarioExport {
  version: typeof CALC_VERSION;
  exportedAt: string;
  caseId: string;
  inputHash: string;
  marketTemp: MarketTemp;
  readConfidence: ReadConfidence;
  flags: FlagCode[];
  intake: CoreIntake;
  extensions: {
    lender: LenderExt;
    investor: InvestorExt;
    commercial: CommercialExt;
  };
  calibrations: ScenarioCalibrations;
  survival: ScenarioSurvival;
  economics: ScenarioEconomics;
  personas: {
    listing: ListingMetrics;
    lender: LenderMetrics;
    investor: InvestorMetrics;
    commercial: CommercialMetrics;
  };
}

export interface CostPoint {
  overshoot: number;
  ask: number;
  cost: number;
  net: number;
  expectedDom: number;
  pStale: number;
}

export interface EngineOutput {
  calcVersion: typeof CALC_VERSION;
  computedAt: string;
  inputHash: string;
  caseId: string;
  uEff: number;
  kappaT: number;
  kappaEff: number;
  kappaUii: number;
  infl: number;
  mClosedWeeks: number;
  mAllWeeks: number;
  tension: number;
  expectedDomDays: number;
  remainingDomDays: number;
  p50DomDays: number;
  pStale120d: number;
  pSold2wk: number;
  expectedDiscountPct: number;
  expectedSalePrice: number;
  carryTotal: number;
  costOfTesting: number;
  scaledHoldback: number;
  holdbackFullReplacement: number;
  classMultiplier: number;
  holdbackLines: HoldbackLine[];
  netProceeds: number;
  netProceedsAnchored: number;
  marketTemp: MarketTemp;
  readConfidence: ReadConfidence;
  flags: FlagCode[];
  trace: TraceRow[];
  survival: { w: number; s: number }[];
  costCurve: CostPoint[];
  optimalAsk: number;
  optimalOvershoot: number;
  riskAsk: number;
  riskOvershoot: number;
  lender: LenderMetrics;
  investor: InvestorMetrics;
  commercial: CommercialMetrics;
  listing: ListingMetrics;
}

export interface ComputeBundle {
  intake: CoreIntake;
  lender: LenderExt;
  investor: InvestorExt;
  commercial: CommercialExt;
}
