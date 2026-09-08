import type {
  CommercialExt,
  CoreIntake,
  InvestorExt,
  LenderExt,
} from "./types";

export const DEFAULT_INTAKE: CoreIntake = {
  zip: "92373",
  baselineValue: 600000,
  targetPrice: 630000,
  listingState: "pre_listing",
  actualDom: null,
  uiiMonths: 4.8,
  medianDomZip: 40,
  domClockBasis: "closed_only",
  glaSqft: 2000,
  hvacAge: 11,
  roofAge: 12,
  whAge: 8,
  assetClass: "residential",
};

export const DEFAULT_LENDER: LenderExt = {
  ltv: 0.8,
  noteRate: 0.065,
  termMonths: 360,
  loanType: "conventional",
  appraisedValue: 600000,
  programReserveMonths: 6,
  contractPrice: 630000,
  noiAnnual: 19800,
};

export const DEFAULT_INVESTOR: InvestorExt = {
  purchasePrice: 630000,
  rentRollMonthly: 3200,
  holdYears: 5,
  exitOvershootPct: 0.06,
  opexRatio: 0.45,
  ltv: 0.75,
  noteRate: 0.065,
  amortYears: 30,
  ioMonths: 0,
};

export const DEFAULT_COMMERCIAL: CommercialExt = {
  availableSf: 4800,
  monthlyAbsorbedSf: 350,
  waltMonths: 42,
  capRateEntryPct: 0.0625,
  debtMaturityMonths: 60,
  tenantRollover: [
    { sqft: 1800, expiryMonth: 14, annualRent: 43200, credit: "A" },
    { sqft: 1600, expiryMonth: 38, annualRent: 36800, credit: "BBB" },
    { sqft: 1400, expiryMonth: 71, annualRent: 29400, credit: "NR" },
  ],
};
