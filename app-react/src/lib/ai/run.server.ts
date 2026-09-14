/**
 * Server-side narrative runner (SERVER-ONLY) — the MCP layer's LLM entry point.
 *
 * The `createServerFn` wrappers in `src/lib/api/ai.ts` own the browser path; the
 * MCP tools need the *same* provider orchestration reachable from a plain function.
 * This module is that shared seam: it resolves the provider key (workspace row,
 * then server env), records an `ai_runs` row, calls the vendor, and finishes the
 * row. It never exposes a key and never trusts client-sent pricing — callers pass
 * engine *facts*, which `prompt.server` turns into a grounded prompt.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import type { AiPurpose, PersonaName, AiProviderId } from "../api/schemas.ts";
import type { WorkspaceContext } from "../api/store.server.ts";
import type { ScenarioFacts } from "../api/engine-bridge.server.ts";
import { buildPrompt } from "./prompt.server.ts";
import {
  callChatProvider,
  defaultModel,
  envApiKeyFor,
  ProviderError,
  type LlmProviderId,
} from "./providers.server.ts";

assertApiServerOnly("ai/run.server");

export type NarrativeResult =
  | {
      ok: true;
      text: string;
      provider: string;
      model: string;
      usage: Record<string, string | number | boolean | null> | null;
      latencyMs: number;
      runId: string;
    }
  | { ok: false; code: string; message: string; runId: string | null };

export async function runNarrativeServerSide(args: {
  workspace: WorkspaceContext;
  scenarioId: string | null;
  provider: LlmProviderId;
  purpose: AiPurpose;
  persona: PersonaName;
  facts: ScenarioFacts;
  question?: string;
}): Promise<NarrativeResult> {
  const {
    listAiProviderRows,
    aiProviderSecret,
    createAiRun,
    finishAiRun,
  } = await import("../api/store.server.ts");

  const { workspace, scenarioId, provider, purpose, persona, facts, question } = args;

  // The four DB-constrained vendors may carry a workspace row; kimi/deepseek are
  // env-key only (they are not in the audited `ai_providers` enum).
  const dbProvider = provider as AiProviderId;
  const isDbProvider = dbProvider === provider;
  let rowKey = null as string | null;
  let model: string | null = null;

  if (isDbProvider) {
    const rows = await listAiProviderRows(workspace);
    const row = rows.find((r) => r.provider === provider && r.is_enabled) ?? null;
    if (row) {
      rowKey = aiProviderSecret(row);
      model = row.model_default?.trim() || null;
    }
  }

  const apiKey = rowKey ?? envApiKeyFor(provider);
  if (!apiKey) {
    return {
      ok: false,
      code: "provider_not_configured",
      message:
        `${provider} has no API key available for this workspace (and no server ` +
        `env fallback). Add one in Cloud → Providers, or set the server key.`,
      runId: null,
    };
  }

  const { system, messages, record } = buildPrompt({ purpose, persona, facts, question });

  const runId = await createAiRun(workspace, {
    scenarioId,
    provider,
    model: model ?? defaultModel(provider),
    purpose,
    prompt: {
      ...record,
      provider,
      model: model ?? defaultModel(provider),
      readConfidence: facts.readConfidence,
      marketTemp: facts.marketTemp,
      flags: facts.flags,
    },
  });

  try {
    const result = await callChatProvider({
      provider,
      apiKey,
      baseUrl: null,
      model: model ?? defaultModel(provider),
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
      text: result.text,
      provider,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      runId,
    };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : "provider_failed";
    const message = err instanceof Error ? err.message : "The provider call failed.";
    await finishAiRun(workspace, { id: runId, status: "failed", error: message });
    return { ok: false, code, message, runId };
  }
}
