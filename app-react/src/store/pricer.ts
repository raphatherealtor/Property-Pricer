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

/** Legacy intake-only key. Still written so an older build keeps working. */
const LS_INTAKE_KEY = "pp-v16-intake";
/** Full local scenario: everything needed to reopen the last session offline. */
const LS_SCENARIO_KEY = "pp-v16-scenario-v1";
const SNAPSHOT_VERSION = 1;

/**
 * A locally persisted session. This is what makes "the last local scenario
 * persists" true across reloads *and* offline: the whole bundle is stored, not
 * just the intake, so the desk comes back exactly as it was left — including the
 * persona, the mode, and the slide the deck was on.
 *
 * Persistence is purely local (`localStorage`); the server copy lives in
 * `scenarios` and is written only when the operator saves to the cloud.
 */
export type LocalScenarioSnapshot = {
  version: number;
  savedAt: string;
  mode: AppMode;
  slide: number;
  persona: Persona;
  intake: CoreIntake;
  lender: LenderExt;
  investor: InvestorExt;
  commercial: CommercialExt;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Merge a stored partial over its defaults, keeping a default for any field that
 * is missing or not a finite number. A hand-edited or half-written snapshot can
 * therefore never produce `NaN` pricing.
 *
 * `T extends object` (rather than `Record<string, unknown>`) so the engine's own
 * interfaces — which have no index signature — can be passed and returned without
 * a cast, keeping the caller's type.
 */
function mergeNumbers<T extends object>(base: T, stored: unknown): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const source = base as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!(key in source)) continue;
    const current = source[key];
    if (isFiniteNumber(current)) {
      if (isFiniteNumber(value)) out[key] = value;
      continue;
    }
    if (current === null) {
      out[key] = isFiniteNumber(value) || value === null ? value : current;
      continue;
    }
    if (typeof current === "string") {
      if (typeof value === "string") out[key] = value;
      continue;
    }
    if (Array.isArray(current)) {
      if (Array.isArray(value)) out[key] = value;
      continue;
    }
    if (typeof current === "boolean") {
      if (typeof value === "boolean") out[key] = value;
      continue;
    }
  }
  return out as T;
}

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function asMode(value: unknown, fallback: AppMode): AppMode {
  return value === "desk" || value === "screen" || value === "consumer" ? value : fallback;
}

function asPersona(value: unknown, fallback: Persona): Persona {
  return value === "listing" || value === "lender" || value === "investor" || value === "commercial"
    ? value
    : fallback;
}

function asSlide(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? Math.max(0, Math.min(5, Math.trunc(value))) : fallback;
}

/** Everything the store holds that is worth restoring. */
function snapshotOf(
  state: {
    mode: AppMode;
    slide: number;
    persona: Persona;
    intake: CoreIntake;
    lender: LenderExt;
    investor: InvestorExt;
    commercial: CommercialExt;
  },
  savedAt: string,
): LocalScenarioSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    savedAt,
    mode: state.mode,
    slide: state.slide,
    persona: state.persona,
    intake: { ...state.intake },
    lender: { ...state.lender },
    investor: { ...state.investor },
    commercial: {
      ...state.commercial,
      tenantRollover: state.commercial.tenantRollover.map((t) => ({ ...t })),
    },
  };
}

type PersistableState = Parameters<typeof snapshotOf>[0];

/**
 * Write the current bundle to `localStorage` and return the stamp for it.
 *
 * Best-effort by contract: a full quota, a private-mode `localStorage`, or no
 * `window` at all (SSR) must never stop a state change from applying.
 * Serialization therefore happens *inside* the `try` — building the snapshot can
 * itself throw on a malformed extension, and losing the snapshot is acceptable
 * whereas losing the operator's edit is not.
 */
function persist(state: PersistableState): string {
  const savedAt = new Date().toISOString();
  if (typeof window === "undefined") return savedAt;
  try {
    const snapshot = snapshotOf(state, savedAt);
    window.localStorage.setItem(LS_SCENARIO_KEY, JSON.stringify(snapshot));
    // Keep the legacy key in sync — the intake is the part older builds read.
    window.localStorage.setItem(LS_INTAKE_KEY, JSON.stringify(snapshot.intake));
  } catch {
    /* quota, private mode, or unserializable state — persistence is best-effort */
  }
  return savedAt;
}

/** Restore the last local scenario, tolerating a missing/corrupt snapshot. */
function loadSnapshot(fallback: PersistableState): LocalScenarioSnapshot | null {
  const stored = readJson(LS_SCENARIO_KEY);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    // Fall back to the legacy intake-only key so an upgraded build keeps the
    // scenario the operator already had.
    const legacy = readJson(LS_INTAKE_KEY);
    if (!legacy || typeof legacy !== "object") return null;
    const intake = mergeNumbers(fallback.intake, legacy);
    if (!intake.zip) return null;
    return {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      mode: fallback.mode,
      slide: fallback.slide,
      persona: fallback.persona,
      intake,
      lender: { ...fallback.lender },
      investor: { ...fallback.investor },
      commercial: {
        ...fallback.commercial,
        tenantRollover: fallback.commercial.tenantRollover.map((t) => ({ ...t })),
      },
    };
  }

  const record = stored as Record<string, unknown>;
  const intake = mergeNumbers(fallback.intake, record.intake);
  if (!intake.zip) return null;
  return {
    version: isFiniteNumber(record.version) ? record.version : SNAPSHOT_VERSION,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date().toISOString(),
    mode: asMode(record.mode, fallback.mode),
    slide: asSlide(record.slide, fallback.slide),
    persona: asPersona(record.persona, fallback.persona),
    intake,
    lender: mergeNumbers(fallback.lender, record.lender),
    investor: mergeNumbers(fallback.investor, record.investor),
    commercial: mergeNumbers(fallback.commercial, record.commercial),
  };
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
  /** ISO timestamp of the last local persistence write (null before hydration). */
  savedAt: string | null;
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
  /** Replace the whole bundle (used when loading a saved cloud scenario). */
  loadScenario: (input: {
    persona?: Persona;
    intake: CoreIntake;
    lender?: LenderExt;
    investor?: InvestorExt;
    commercial?: CommercialExt;
  }) => void;
  reset: () => void;
  hydrate: () => void;
};

const DEFAULTS = {
  mode: "desk" as AppMode,
  slide: 0,
  persona: "listing" as Persona,
  intake: DEFAULT_INTAKE,
  lender: DEFAULT_LENDER,
  investor: DEFAULT_INVESTOR,
  commercial: DEFAULT_COMMERCIAL,
};

export const usePricer = create<State>((set, get) => {
  /** Persist the bundle produced by `next` and stamp `savedAt`. */
  const commit = (next: Partial<State>) => {
    const merged = { ...get(), ...next };
    const savedAt = persist({
      mode: merged.mode,
      slide: merged.slide,
      persona: merged.persona,
      intake: merged.intake,
      lender: merged.lender,
      investor: merged.investor,
      commercial: merged.commercial,
    });
    set({ ...next, savedAt });
  };

  return {
    mode: DEFAULTS.mode,
    slide: DEFAULTS.slide,
    persona: DEFAULTS.persona,
    intake: { ...DEFAULT_INTAKE },
    lender: { ...DEFAULT_LENDER },
    investor: { ...DEFAULT_INVESTOR },
    commercial: { ...DEFAULT_COMMERCIAL },
    intakeOpen: false,
    savedAt: null,
    setMode: (mode) => commit({ mode }),
    setSlide: (slide) => commit({ slide: Math.max(0, Math.min(5, slide)) }),
    setPersona: (persona) =>
      commit({
        persona,
        intake: {
          ...get().intake,
          assetClass: persona === "commercial" ? "commercial" : "residential",
        },
      }),
    patchIntake: (p) => commit({ intake: { ...get().intake, ...p } }),
    patchLender: (p) => commit({ lender: { ...get().lender, ...p } }),
    patchInvestor: (p) => commit({ investor: { ...get().investor, ...p } }),
    patchCommercial: (p) => commit({ commercial: { ...get().commercial, ...p } }),
    applyZip: (zip) => {
      const m = lookupZip(zip);
      commit({
        intake: {
          ...get().intake,
          zip: m.zip,
          medianDomZip: m.medianDom,
          uiiMonths: m.uii,
        },
      });
    },
    applyPill: (pill) => commit({ intake: { ...get().intake, ...EQUIPMENT_PILLS[pill] } }),
    setIntakeOpen: (intakeOpen) => set({ intakeOpen }),
    loadScenario: (input) =>
      commit({
        persona: input.persona ?? get().persona,
        intake: { ...input.intake },
        lender: input.lender ? { ...input.lender } : { ...DEFAULT_LENDER },
        investor: input.investor ? { ...input.investor } : { ...DEFAULT_INVESTOR },
        commercial: input.commercial
          ? {
              ...input.commercial,
              tenantRollover: input.commercial.tenantRollover.map((t) => ({ ...t })),
            }
          : { ...DEFAULT_COMMERCIAL },
      }),
    reset: () => {
      commit({
        intake: { ...DEFAULT_INTAKE },
        lender: { ...DEFAULT_LENDER },
        investor: { ...DEFAULT_INVESTOR },
        commercial: { ...DEFAULT_COMMERCIAL },
        persona: DEFAULTS.persona,
      });
    },
    hydrate: () => {
      const snapshot = loadSnapshot({
        mode: get().mode,
        slide: get().slide,
        persona: get().persona,
        intake: get().intake,
        lender: get().lender,
        investor: get().investor,
        commercial: get().commercial,
      });
      if (!snapshot) {
        // First run: nothing stored yet, so write the defaults once. That makes
        // the very first offline reload work too.
        const savedAt = persist({
          mode: get().mode,
          slide: get().slide,
          persona: get().persona,
          intake: get().intake,
          lender: get().lender,
          investor: get().investor,
          commercial: get().commercial,
        });
        set({ savedAt });
        return;
      }
      set({
        mode: snapshot.mode,
        slide: snapshot.slide,
        persona: snapshot.persona,
        intake: snapshot.intake,
        lender: snapshot.lender,
        investor: snapshot.investor,
        commercial: snapshot.commercial,
        savedAt: snapshot.savedAt,
      });
    },
  };
});
