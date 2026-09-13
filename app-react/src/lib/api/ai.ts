/**
 * AI API: provider configuration + server-side narrative runs.
 *
 * Two rules drive the shape of this module:
 *
 *  1. Requests never carry numbers or credentials. A run takes engine *inputs*,
 *     recomputes them server-side, and the provider key is resolved inside the
 *     handler from the encrypted vault (or the server env fallback). The browser
 *     learns the provider, the model, and the returned text — nothing else.
 *  2. A provider failure is a *result*, not an exception. Every run is recorded
 *     on `ai_runs` (running → succeeded/failed) and returned as a discriminated
 *     object, so the UI can show the operator exactly why nothing came back
 *     instead of a generic crash.
 */
import { createServerFn } from "@tanstack/react-start";
import { cloudMiddleware } from "./context.ts";
import {
  AI_PROVIDER_IDS,
  aiProviderInputSchema,
  aiRunInputSchema,
  aiRunListInputSchema,
  idInputSchema,
  type AiProviderDto,
  type AiProviderId,
  type AiRunDto,
  type AiPurpose,
  type IdInput,
  type JsonObject,
} from "./schemas.ts";

export type AiRunResult =
  | {
      ok: true;
      runId: string;
      provider: AiProviderId;
      model: string;
      purpose: AiPurpose;
      text: string;
      finishReason: string | null;
      usage: JsonObject | null;
      latencyMs: number;
      /** Provenance for the narrative: the engine output it was written from. */
      calcVersion: string;
      inputHash: string;
      caseId: string;
    }
  | {
      ok: false;
      runId: string | null;
      code: string;
      message: string;
    };

type SaveProviderInput = ReturnType<typeof aiProviderInputSchema.parse>;
type AiRunInput = ReturnType<typeof aiRunInputSchema.parse>;

export const listAiProviders = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<AiProviderDto[]> => {
    const { workspaceFor, listAiProviderRows, aiProviderDto } = await import(
      "./store.server.ts"
    );
    const { hasEnvKeyFor } = await import("../ai/providers.server.ts");
    const rows = await listAiProviderRows(await workspaceFor(context));
    return rows.map((row) => aiProviderDto(row, hasEnvKeyFor(row.provider)));
  });

/** Create or update a workspace provider. The key is write-only. */
export const saveAiProvider = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): SaveProviderInput => aiProviderInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AiProviderDto> => {
    const { workspaceFor, upsertAiProvider, aiProviderDto } = await import(
      "./store.server.ts"
    );
    const { hasEnvKeyFor } = await import("../ai/providers.server.ts");
    const row = await upsertAiProvider(await workspaceFor(context), data);
    return aiProviderDto(row, hasEnvKeyFor(row.provider));
  });

export const deleteAiProvider = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): IdInput => idInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
    const { workspaceFor, deleteAiProvider: remove } = await import("./store.server.ts");
    return { deleted: await remove(await workspaceFor(context), data.id) };
  });

export const listAiRunHistory = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): ReturnType<typeof aiRunListInputSchema.parse> =>
    aiRunListInputSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<AiRunDto[]> => {
    const { workspaceFor, listAiRuns } = await import("./store.server.ts");
    return listAiRuns(await workspaceFor(context), data);
  });

/**
 * Run one narrative purpose against the current scenario.
 *
 * Provider resolution order: an explicit `providerId`, then the first enabled row
 * for the requested `provider`, then the first enabled row that has any key
 * (workspace or env), then the first provider with a server env key at all. The
 * chosen provider/model is echoed back so the UI never has to guess.
 */
export const runScenarioAi = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): AiRunInput => aiRunInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AiRunResult> => {
    const {
      workspaceFor,
      listAiProviderRows,
      getAiProviderRow,
      aiProviderSecret,
      createAiRun,
      finishAiRun,
    } = await import("./store.server.ts");
    const { computeScenario } = await import("./engine-bridge.server.ts");
    const { buildPrompt } = await import("../ai/prompt.server.ts");
    const {
      callChatProvider,
      defaultModel,
      envApiKeyFor,
      ProviderError,
    } = await import("../ai/providers.server.ts");

    const workspace = await workspaceFor(context);

    // 1. Authoritative numbers — recomputed here, never accepted from the caller.
    const { output, facts } = computeScenario(
      {
        intake: data.intake,
        lender: data.lender,
        investor: data.investor,
        commercial: data.commercial,
      },
      new Date().toISOString(),
    );

    const { system, messages, record } = buildPrompt({
      purpose: data.purpose,
      persona: data.persona,
      facts,
      question: data.question,
    });

    // 2. Provider + key resolution (all server-side).
    const rows = await listAiProviderRows(workspace);
    let row = null as (typeof rows)[number] | null;
    if (data.providerId) {
      // Targeted lookup for an explicitly chosen provider, so a stale id is
      // reported as such rather than silently falling back to another vendor.
      row = await getAiProviderRow(workspace, data.providerId);
      if (!row) {
        return {
          ok: false,
          runId: null,
          code: "provider_not_found",
          message: "That provider configuration no longer exists in this workspace.",
        };
      }
    } else if (data.provider) {
      row = rows.find((r) => r.provider === data.provider && r.is_enabled) ?? null;
    } else {
      row =
        rows.find((r) => r.is_enabled && (r.encrypted_api_key || envApiKeyFor(r.provider))) ??
        null;
    }

    const envFallbackProvider = AI_PROVIDER_IDS.find((id) => envApiKeyFor(id) !== null);
    const provider: AiProviderId | null =
      row?.provider ?? data.provider ?? envFallbackProvider ?? null;

    if (!provider) {
      return {
        ok: false,
        runId: null,
        code: "provider_not_configured",
        message:
          "No AI provider is configured. Add a key in Cloud → Providers, or set a " +
          "server API key environment variable.",
      };
    }

    const apiKey = (row ? aiProviderSecret(row) : null) ?? envApiKeyFor(provider);
    if (!apiKey) {
      return {
        ok: false,
        runId: null,
        code: "provider_not_configured",
        message: `${provider} has no API key stored for this workspace and no server key is set.`,
      };
    }

    const model = row?.model_default?.trim() || defaultModel(provider);

    // 3. Record the run before calling out, so an interrupted request still
    //    leaves a visible `running` row rather than nothing at all.
    let runId: string;
    try {
      runId = await createAiRun(workspace, {
        scenarioId: data.scenarioId ?? null,
        provider,
        model,
        purpose: data.purpose,
        prompt: {
          ...record,
          provider,
          model,
          readConfidence: output.readConfidence,
          marketTemp: output.marketTemp,
          flags: output.flags,
        },
      });
    } catch (err) {
      return {
        ok: false,
        runId: null,
        code: "run_not_recorded",
        message:
          err instanceof Error
            ? err.message
            : "Could not record the AI run in this workspace.",
      };
    }

    try {
      const result = await callChatProvider({
        provider,
        apiKey,
        baseUrl: row?.base_url ?? null,
        model,
        system,
        messages,
      });

      await finishAiRun(workspace, {
        id: runId,
        status: "succeeded",
        response: {
          text: result.text,
          usage: result.usage,
          finishReason: result.finishReason,
          latencyMs: result.latencyMs,
          model: result.model,
        },
      });

      return {
        ok: true,
        runId,
        provider,
        model: result.model,
        purpose: data.purpose,
        text: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        latencyMs: result.latencyMs,
        calcVersion: output.calcVersion,
        inputHash: output.inputHash,
        caseId: output.caseId,
      };
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : "provider_failed";
      const message =
        err instanceof Error ? err.message : "The provider call failed.";
      await finishAiRun(workspace, { id: runId, status: "failed", error: message });
      return { ok: false, runId, code, message };
    }
  });
