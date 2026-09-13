/**
 * Saved-scenario API: the history layer behind the Cloud → Scenarios tab.
 *
 * The important property of `saveScenario` is what it does **not** accept: the
 * request carries inputs only. The handler recomputes with the locked engine
 * (`@/lib/api/engine-bridge.server`), so `engine_output_json`, `calc_version` and
 * `input_hash` are always authoritative and can never be a client's invention.
 *
 * `expectedInputHash` is echoed back as `inputHashDrift` so a UI running a stale
 * bundled engine is visible instead of silently diverging from the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { cloudMiddleware } from "./context.ts";
import {
  idInputSchema,
  scenarioHistoryInputSchema,
  scenarioListInputSchema,
  scenarioSaveInputSchema,
  type IdInput,
  type ScenarioDto,
  type ScenarioHistoryDto,
  type ScenarioSummaryDto,
} from "./schemas.ts";

export type SaveScenarioResult = {
  ok: true;
  scenario: ScenarioDto;
  /** Authoritative server-computed values for this save. */
  computed: { caseId: string; inputHash: string; calcVersion: string };
  /** True when the browser's hash disagreed with the server's recomputation. */
  inputHashDrift: boolean;
  /** True when the save appended a new row instead of revising one. */
  created: boolean;
};

type SaveScenarioInput = ReturnType<typeof scenarioSaveInputSchema.parse>;
type ScenarioListInput = ReturnType<typeof scenarioListInputSchema.parse>;

/**
 * Persist the current scenario. Recomputes the engine output server-side, then
 * appends a revision (`id` omitted) or updates the existing row in place.
 */
export const saveScenario = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): SaveScenarioInput => scenarioSaveInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SaveScenarioResult> => {
    const { workspaceFor, createScenario, updateScenario, upsertProperty, createScenarioExport } =
      await import("./store.server.ts");
    const { computeScenario } = await import("./engine-bridge.server.ts");

    const workspace = await workspaceFor(context);
    const exportedAt = new Date().toISOString();
    const bundle = {
      intake: data.intake,
      lender: data.lender,
      investor: data.investor,
      commercial: data.commercial,
    };
    const { output, facts } = computeScenario(bundle, exportedAt);

    // A scenario saved before any property existed gets one attached now, so
    // history grouping and CRM pushes have a stable subject.
    let propertyId = data.propertyId ?? null;
    if (!propertyId && data.property) {
      const property = await upsertProperty(workspace, data.property);
      propertyId = property.id;
    }

    const payload = {
      intake: data.intake,
      lender: data.lender,
      investor: data.investor,
      commercial: data.commercial,
    };
    const common = {
      name: data.name,
      persona: data.persona,
      propertyId,
      payload,
      engineOutput: output,
      calcVersion: output.calcVersion,
      inputHash: output.inputHash,
    };

    let scenario: ScenarioDto | null = null;
    let created = true;
    if (data.id) {
      scenario = await updateScenario(workspace, { id: data.id, ...common });
      if (!scenario) throw new Error("Saved scenario not found in this workspace.");
      created = false;
    } else {
      scenario = await createScenario(workspace, common);
    }

    // Every save also lands in `scenario_exports` as a json export: that table is
    // the audit trail of what was produced, and it keeps the deck/PDF/CRM export
    // types in one history rather than a parallel one.
    await createScenarioExport(workspace, {
      scenarioId: scenario.id,
      exportType: "json",
      payload: facts,
    });

    return {
      ok: true,
      scenario,
      computed: {
        caseId: output.caseId,
        inputHash: output.inputHash,
        calcVersion: output.calcVersion,
      },
      inputHashDrift:
        typeof data.expectedInputHash === "string" &&
        data.expectedInputHash.length > 0 &&
        data.expectedInputHash !== output.inputHash,
      created,
    };
  });

export const listSavedScenarios = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): ScenarioListInput => scenarioListInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScenarioSummaryDto[]> => {
    const { workspaceFor, listScenarios } = await import("./store.server.ts");
    return listScenarios(await workspaceFor(context), data);
  });

export const getSavedScenario = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): IdInput => idInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScenarioDto | null> => {
    const { workspaceFor, getScenario } = await import("./store.server.ts");
    return getScenario(await workspaceFor(context), data.id);
  });

export const deleteSavedScenario = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): IdInput => idInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
    const { workspaceFor, deleteScenario } = await import("./store.server.ts");
    return { deleted: await deleteScenario(await workspaceFor(context), data.id) };
  });

export const getScenarioHistory = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): ReturnType<typeof scenarioHistoryInputSchema.parse> =>
    scenarioHistoryInputSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<ScenarioHistoryDto[]> => {
    const { workspaceFor, listScenarioHistory } = await import("./store.server.ts");
    return listScenarioHistory(await workspaceFor(context), data.id, data.limit);
  });

/*
 * Deliberately absent, for the same reason as `saveProperty` above: a
 * `renameSavedScenario` wrapper and explicit export-record/list wrappers have no
 * caller. Revisions are recorded by `saveScenario` (which accepts an `id` to
 * revise in place) and every save already writes a `json` row to
 * `scenario_exports`, so both write paths are live server-side and exercised —
 * only the redundant client verbs are omitted until a UI needs them.
 */
