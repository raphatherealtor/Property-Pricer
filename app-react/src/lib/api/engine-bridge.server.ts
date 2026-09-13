/**
 * The single bridge between the API layer and the locked engine (SERVER-ONLY).
 *
 * `src/engine/` is a frozen, self-tested SDK: this module only *calls* it. It
 * exists so every server path that needs authoritative numbers — saving a
 * scenario, running an AI narrative, pushing to the CRM — recomputes from
 * validated inputs in exactly one place. A request can therefore never supply a
 * figure that reaches the database or a prompt; it can only supply inputs.
 */
import { compute } from "../../engine/compute.ts";
import { buildScenarioExport } from "../../engine/export.ts";
import type { ComputeBundle, EngineOutput } from "../../engine/types.ts";
import { assertApiServerOnly } from "./server-only.ts";

assertApiServerOnly("api/engine-bridge.server");

/** The engine's own scenario export, as produced by `src/engine/export.ts`. */
export type ScenarioFacts = ReturnType<typeof buildScenarioExport>;

export type ComputedScenario = {
  output: EngineOutput;
  facts: ScenarioFacts;
};

/**
 * Recompute a bundle with the locked engine. `exportedAt` is caller-supplied so
 * one request produces a byte-stable export.
 */
export function computeScenario(
  bundle: ComputeBundle,
  exportedAt: string,
): ComputedScenario {
  const output = compute(bundle);
  return { output, facts: buildScenarioExport(bundle, output, exportedAt) };
}

/** Re-exported so callers never import `src/engine` directly. */
export { compute, buildScenarioExport };
export type { ComputeBundle, EngineOutput };
export type { CoreIntake, InvestorExt, LenderExt, CommercialExt } from "../../engine/types.ts";
