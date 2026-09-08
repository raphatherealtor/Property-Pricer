import { create } from "zustand";
import { lookupZip } from "@/data/zips";
import {
  DEFAULT_COMMERCIAL,
  DEFAULT_INTAKE,
  DEFAULT_INVESTOR,
  DEFAULT_LENDER,
} from "@/engine/defaults";
import { EQUIPMENT_PILLS } from "@/engine/holdback";
import type {
  AppMode,
  CommercialExt,
  CoreIntake,
  EquipmentPill,
  InvestorExt,
  LenderExt,
  Persona,
} from "@/engine/types";

const LS_KEY = "pp-v16-intake";

function loadIntake(): Partial<CoreIntake> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as CoreIntake) : null;
  } catch {
    return null;
  }
}

type State = {
  mode: AppMode;
  slide: number;
  persona: Persona;
  intake: CoreIntake;
  lender: LenderExt;
  investor: InvestorExt;
  commercial: CommercialExt;
  intakeOpen: boolean;
  setMode: (m: AppMode) => void;
  setSlide: (n: number) => void;
  setPersona: (p: Persona) => void;
  patchIntake: (p: Partial<CoreIntake>) => void;
  patchLender: (p: Partial<LenderExt>) => void;
  patchInvestor: (p: Partial<InvestorExt>) => void;
  patchCommercial: (p: Partial<CommercialExt>) => void;
  applyZip: (zip: string) => void;
  applyPill: (pill: EquipmentPill) => void;
  setIntakeOpen: (v: boolean) => void;
  reset: () => void;
  hydrate: () => void;
};

function persist(intake: CoreIntake) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(intake));
  } catch {
    /* ignore quota */
  }
}

export const usePricer = create<State>((set) => ({
  mode: "desk",
  slide: 0,
  persona: "listing",
  intake: { ...DEFAULT_INTAKE },
  lender: { ...DEFAULT_LENDER },
  investor: { ...DEFAULT_INVESTOR },
  commercial: { ...DEFAULT_COMMERCIAL },
  intakeOpen: false,
  setMode: (mode) => set({ mode }),
  setSlide: (slide) => set({ slide: Math.max(0, Math.min(5, slide)) }),
  setPersona: (persona) =>
    set((s) => ({
      persona,
      intake: {
        ...s.intake,
        assetClass: persona === "commercial" ? "commercial" : "residential",
      },
    })),
  patchIntake: (p) =>
    set((s) => {
      const intake = { ...s.intake, ...p };
      persist(intake);
      return { intake };
    }),
  patchLender: (p) => set((s) => ({ lender: { ...s.lender, ...p } })),
  patchInvestor: (p) => set((s) => ({ investor: { ...s.investor, ...p } })),
  patchCommercial: (p) => set((s) => ({ commercial: { ...s.commercial, ...p } })),
  applyZip: (zip) =>
    set((s) => {
      const m = lookupZip(zip);
      const intake = {
        ...s.intake,
        zip: m.zip,
        medianDomZip: m.medianDom,
        uiiMonths: m.uii,
      };
      persist(intake);
      return { intake };
    }),
  applyPill: (pill) =>
    set((s) => {
      const ages = EQUIPMENT_PILLS[pill];
      const intake = { ...s.intake, ...ages };
      persist(intake);
      return { intake };
    }),
  setIntakeOpen: (intakeOpen) => set({ intakeOpen }),
  reset: () => {
    persist(DEFAULT_INTAKE);
    set({
      intake: { ...DEFAULT_INTAKE },
      lender: { ...DEFAULT_LENDER },
      investor: { ...DEFAULT_INVESTOR },
      commercial: { ...DEFAULT_COMMERCIAL },
    });
  },
  hydrate: () => {
    const loaded = loadIntake();
    if (loaded && loaded.zip) {
      set((s) => ({ intake: { ...s.intake, ...loaded } }));
    }
  },
}));
