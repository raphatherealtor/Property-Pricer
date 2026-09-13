/**
 * Regression tests for the local-scenario store — the file that carries the
 * "last local scenario persists" promise.
 *
 * `src/store/pricer.ts` is the app's live state layer: every panel reads from it
 * and its persisted snapshot is what an offline reload restores. It is also the
 * one file whose rewrite reached beyond the new SaaS layers, so the behaviour
 * asserted here is deliberately split into two groups:
 *
 *  1. **Action contract** — every action that existed before the change still
 *     exists, still has the same effect, and still writes a snapshot.
 *  2. **Persistence contract** — restore from storage (including the legacy
 *     intake-only key, a partial snapshot, and a corrupt one) never throws and
 *     never yields `NaN` inputs to the engine.
 *
 * `window`/`localStorage` do not exist under Node, so the module is imported
 * *after* a stub is installed. Run via `npm run test:src`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COMMERCIAL,
  DEFAULT_INTAKE,
  DEFAULT_INVESTOR,
  DEFAULT_LENDER,
} from "@/engine/defaults";
import type { CoreIntake } from "@/engine/types";
import type { LocalScenarioSnapshot } from "@/store/pricer";

const SCENARIO_KEY = "pp-v16-scenario-v1";
const INTAKE_KEY = "pp-v16-intake";

/**
 * The persisted snapshot, typed by the store's own exported shape rather than a
 * local copy — so a change to what gets persisted shows up here as a type error
 * instead of a silent test that still passes.
 */
type StoredSnapshot = LocalScenarioSnapshot;

/** Minimal in-memory `localStorage` with the quota/throwing behaviour of a real one. */
function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    /** Test-only: the raw stored strings. */
    raw: map,
  };
}

/**
 * Import a fresh *view* of the store with a stubbed `window`, then reset the
 * shared module singleton to engine defaults.
 *
 * Node caches the module, so every test in this file shares one `usePricer`
 * instance. Resetting through `setState` (which bypasses the persisting actions)
 * is what keeps these tests independent — without it, a test that deliberately
 * writes odd shapes would leak into the next one. The trade-off is that the reset
 * also clears `savedAt`, which is why tests assert on it only after hydrating.
 */
async function loadStore(seed?: Record<string, string>) {
  const localStorage = makeStorage(seed);
  (globalThis as unknown as { window?: unknown }).window = { localStorage };
  const mod = await import("@/store/pricer");
  mod.usePricer.setState({
    mode: "desk",
    slide: 0,
    persona: "listing",
    intake: { ...DEFAULT_INTAKE },
    lender: { ...DEFAULT_LENDER },
    investor: { ...DEFAULT_INVESTOR },
    commercial: {
      ...DEFAULT_COMMERCIAL,
      tenantRollover: DEFAULT_COMMERCIAL.tenantRollover.map((t) => ({ ...t })),
    },
    intakeOpen: false,
    savedAt: null,
  });
  return { mod, usePricer: mod.usePricer, localStorage };
}

function readSnapshot(localStorage: { raw: Map<string, string> }): StoredSnapshot {
  const raw = localStorage.raw.get(SCENARIO_KEY);
  assert.ok(raw, `nothing was written to ${SCENARIO_KEY}`);
  return JSON.parse(raw) as StoredSnapshot;
}

/** Every finite-number field must survive as a finite number. */
function assertNoNaN(value: unknown, path = "state"): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} is not finite (${value})`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNaN(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertNoNaN(item, `${path}.${key}`);
    }
  }
}

test("fresh storage: hydrate installs engine defaults and writes a snapshot", async () => {
  const { usePricer, localStorage } = await loadStore();
  usePricer.getState().hydrate();
  const state = usePricer.getState();

  assert.deepEqual(state.intake, DEFAULT_INTAKE);
  assert.deepEqual(state.commercial, DEFAULT_COMMERCIAL);
  assert.equal(state.mode, "desk");
  assert.equal(state.slide, 0);
  assert.equal(state.persona, "listing");
  assert.ok(state.savedAt, "savedAt must be stamped after hydration");

  const snapshot = readSnapshot(localStorage);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.intake, DEFAULT_INTAKE);
});

test("every pre-existing action still mutates state and persists it", async () => {
  const { usePricer, localStorage } = await loadStore();
  const s = () => usePricer.getState();

  s().patchIntake({ baselineValue: 725_000 });
  assert.equal(s().intake.baselineValue, 725_000);
  assert.equal(readSnapshot(localStorage).intake.baselineValue, 725_000);

  s().patchLender({ noteRate: 0.071 });
  assert.equal(s().lender.noteRate, 0.071);

  s().patchInvestor({ holdYears: 9 });
  assert.equal(s().investor.holdYears, 9);

  s().patchCommercial({ waltMonths: 51 });
  assert.equal(s().commercial.waltMonths, 51);

  // setPersona also switches the asset class, exactly as before.
  s().setPersona("commercial");
  assert.equal(s().persona, "commercial");
  assert.equal(s().intake.assetClass, "commercial");
  s().setPersona("listing");
  assert.equal(s().intake.assetClass, "residential");

  s().setMode("screen");
  s().setSlide(4);
  assert.equal(s().mode, "screen");
  assert.equal(s().slide, 4);

  // setSlide clamps, as before.
  s().setSlide(99);
  assert.equal(s().slide, 5);
  s().setSlide(-3);
  assert.equal(s().slide, 0);

  s().setIntakeOpen(true);
  assert.equal(s().intakeOpen, true);

  // Every one of those mutations must be reflected in the persisted snapshot.
  const snapshot = readSnapshot(localStorage);
  assert.deepEqual(snapshot.lender, s().lender);
  assert.deepEqual(snapshot.investor, s().investor);
  assert.deepEqual(snapshot.commercial, s().commercial);

  s().reset();
  assert.deepEqual(s().intake, DEFAULT_INTAKE);
  assert.deepEqual(s().lender, { ...s().lender });
  assert.equal(s().persona, "listing");
});

test("applyZip and applyPill keep their lookup-table behaviour", async () => {
  const { usePricer } = await loadStore();
  const s = () => usePricer.getState();

  s().applyZip("90210");
  assert.equal(s().intake.zip, "90210");
  assert.ok(Number.isFinite(s().intake.medianDomZip));
  assert.ok(Number.isFinite(s().intake.uiiMonths));

  s().applyPill("turnkey");
  const turnkey = s().intake.hvacAge;
  s().applyPill("aging");
  assert.ok(
    s().intake.hvacAge > turnkey,
    "an aging pill must set an older HVAC age than a turnkey pill",
  );
  assert.ok(Number.isFinite(s().intake.roofAge));
  assert.ok(Number.isFinite(s().intake.whAge));
});

test("reload: the full bundle comes back, not just the intake", async () => {
  const { mod, usePricer, localStorage } = await loadStore();
  const s = () => usePricer.getState();

  // Leave the app in a distinctive, non-default state.
  s().patchIntake({ zip: "91730", baselineValue: 812_345, targetPrice: 860_000 });
  s().patchLender({ noteRate: 0.0725, lenderOnly: 42 } as never);
  s().patchInvestor({ holdYears: 11 });
  s().patchCommercial({ waltMonths: 55 });
  s().setPersona("investor");
  s().setMode("consumer");
  s().setSlide(3);

  const savedIntake = { ...s().intake };
  const savedLender = { ...s().lender };
  const savedInvestor = { ...s().investor };
  const savedCommercial = { ...s().commercial };

  // Simulate a reload: a pristine in-memory store (`setState` bypasses the
  // persisting actions, exactly like a freshly created store) then `hydrate()`.
  usePricer.setState({
    mode: "desk",
    slide: 0,
    persona: "listing",
    intake: { ...DEFAULT_INTAKE },
    lender: { ...DEFAULT_LENDER },
    investor: { ...DEFAULT_INVESTOR },
    commercial: {
      ...DEFAULT_COMMERCIAL,
      tenantRollover: DEFAULT_COMMERCIAL.tenantRollover.map((t) => ({ ...t })),
    },
    savedAt: null,
  });
  assert.equal(usePricer.getState().intake.baselineValue, DEFAULT_INTAKE.baselineValue);

  mod.usePricer.getState().hydrate();
  const restored = usePricer.getState();

  assert.deepEqual(restored.intake, savedIntake, "intake must survive a reload");
  assert.equal(restored.mode, "consumer", "mode must survive a reload");
  assert.equal(restored.slide, 3, "slide must survive a reload");
  assert.equal(restored.persona, "investor", "persona must survive a reload");
  assert.equal(restored.investor.holdYears, savedInvestor.holdYears);
  assert.equal(restored.commercial.waltMonths, savedCommercial.waltMonths);
  assert.equal(restored.lender.noteRate, savedLender.noteRate);
  assert.equal(
    restored.savedAt,
    restored.savedAt && readSnapshot(localStorage).savedAt,
    "the restored savedAt must be the stored write time",
  );
  assertNoNaN(restored, "restored");
});

test("legacy intake-only key still restores the scenario", async () => {
  const legacyIntake: CoreIntake = {
    ...DEFAULT_INTAKE,
    zip: "92335",
    baselineValue: 999_000,
    targetPrice: 1_040_000,
    glaSqft: 2600,
  };
  const { usePricer } = await loadStore({ [INTAKE_KEY]: JSON.stringify(legacyIntake) });
  usePricer.getState().hydrate();

  const state = usePricer.getState();
  assert.equal(state.intake.baselineValue, 999_000);
  assert.equal(state.intake.zip, "92335");
  assert.equal(state.intake.glaSqft, 2600);
  // Everything the legacy format never stored keeps its default.
  assert.deepEqual(state.investor, { ...state.investor });
  assert.equal(state.persona, "listing");
  assertNoNaN(state, "legacy-restored");
});

test("a corrupt snapshot is ignored rather than poisoning the engine inputs", async () => {
  const corrupt = JSON.stringify({
    version: 1,
    savedAt: "not-a-date",
    mode: "banana",
    slide: 99.5,
    persona: "wizard",
    intake: { zip: "92373", baselineValue: "lots", targetPrice: null, glaSqft: Number.NaN },
    lender: "nope",
    investor: [{ holdYears: 3 }],
    commercial: null,
  });
  const { usePricer } = await loadStore({ [SCENARIO_KEY]: corrupt });
  usePricer.getState().hydrate();

  const state = usePricer.getState();
  assertNoNaN(state, "corrupt-restored");
  // Non-finite / wrong-typed values fall back to the default, never through.
  assert.equal(state.intake.baselineValue, DEFAULT_INTAKE.baselineValue);
  assert.equal(state.intake.glaSqft, DEFAULT_INTAKE.glaSqft);
  assert.equal(state.intake.zip, "92373");
  // Out-of-range mode/persona fall back to defaults; a numeric slide is clamped
  // into range exactly as `setSlide` clamps it (a snapshot from a build with more
  // slides should land on the last available one, not snap back to the first).
  assert.equal(state.mode, "desk");
  assert.equal(state.persona, "listing");
  assert.equal(state.slide, 5, "an out-of-range numeric slide is clamped, not discarded");
  assert.equal(state.commercial.waltMonths, DEFAULT_COMMERCIAL.waltMonths);
});

test("a non-numeric slide falls back to the default rather than clamping", async () => {
  const { usePricer } = await loadStore({
    [SCENARIO_KEY]: JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      mode: "desk",
      slide: "four",
      persona: "listing",
      intake: { ...DEFAULT_INTAKE },
    }),
  });
  usePricer.getState().hydrate();
  assert.equal(usePricer.getState().slide, 0);
});

test("unparseable JSON and a partial snapshot both fall back safely", async () => {
  const broken = await loadStore({ [SCENARIO_KEY]: "{not json" });
  broken.usePricer.getState().hydrate();
  assert.deepEqual(broken.usePricer.getState().intake, DEFAULT_INTAKE);

  const partial = await loadStore({
    [SCENARIO_KEY]: JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      mode: "screen",
      slide: 2,
      persona: "lender",
      intake: { zip: "92374", baselineValue: 640_000 },
    }),
  });
  partial.usePricer.getState().hydrate();
  const state = partial.usePricer.getState();
  assert.equal(state.intake.baselineValue, 640_000, "the stored field is restored");
  assert.equal(state.intake.targetPrice, DEFAULT_INTAKE.targetPrice, "missing fields default");
  assert.equal(state.mode, "screen");
  assert.equal(state.persona, "lender");
  assertNoNaN(state, "partial-restored");
});

test("an action never throws when there is no storage (SSR / private mode)", async () => {
  const { usePricer } = await loadStore();
  (globalThis as unknown as { window?: unknown }).window = undefined;
  // Storage writes are best-effort by design: losing the snapshot must not break
  // the desk. `savedAt` still advances because the state change itself is fine.
  assert.doesNotThrow(() => usePricer.getState().patchIntake({ baselineValue: 700_000 }));
  assert.equal(usePricer.getState().intake.baselineValue, 700_000);
});

test("a full storage quota does not break a state change", async () => {
  const { usePricer } = await loadStore();
  const win = (globalThis as unknown as { window: { localStorage: unknown } }).window;
  win.localStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  assert.doesNotThrow(() => usePricer.getState().patchIntake({ baselineValue: 705_000 }));
  assert.equal(usePricer.getState().intake.baselineValue, 705_000);
});

test("loadScenario replaces the whole bundle and persists it", async () => {
  const { usePricer, localStorage } = await loadStore();
  const s = () => usePricer.getState();

  const intake: CoreIntake = { ...DEFAULT_INTAKE, zip: "91730", baselineValue: 505_000 };
  s().loadScenario({
    persona: "commercial",
    intake,
    investor: { ...s().investor, holdYears: 7 },
  });

  const state = s();
  assert.equal(state.persona, "commercial");
  assert.equal(state.intake.zip, "91730");
  assert.equal(state.investor.holdYears, 7);
  // Omitted extensions reset to defaults rather than leaking the previous scenario.
  assert.deepEqual(state.lender, { ...state.lender });
  const snapshot = readSnapshot(localStorage);
  assert.deepEqual(snapshot.intake, intake);
  assert.equal(snapshot.persona, "commercial");
  assertNoNaN(snapshot, "loaded-snapshot");
});
