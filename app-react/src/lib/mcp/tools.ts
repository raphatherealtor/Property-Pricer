/**
 * MCP tools (SERVER-ONLY).
 *
 * Fifteen tools, all over the locked engine. The contract each one obeys:
 *
 *  - input is validated with the zod schema in `./schemas.ts`;
 *  - pricing is always recomputed server-side with `compute()` (`price_scenario`,
 *    `apply_input_patch`, `save_scenario` recompute rather than trusting a caller);
 *  - every response is structured JSON with `ok`, and carries `calcVersion` +
 *    `inputHash` wherever a figure came from the engine;
 *  - no secret is ever returned;
 *  - success/failure is audited by the dispatcher (`server.ts`), not here.
 *
 * DB-touching modules are imported *inside* the handlers (dynamic `import`), so
 * the pure tools can be exercised in tests without booting PGLite, and the
 * secrets scanner stays satisfied that no client bundle reaches a server module.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import { DEFAULT_COMMERCIAL, DEFAULT_INVESTOR, DEFAULT_LENDER } from "../../engine/defaults.ts";
import { computeScenario, type ScenarioFacts } from "../api/engine-bridge.server.ts";
import type {
  CommercialExt,
  ComputeBundle,
  CoreIntake,
  EngineOutput,
  InvestorExt,
  LenderExt,
} from "../../engine/types.ts";
import type { PersonaName } from "../api/schemas.ts";
import { requireMcpWorkspace } from "./context.ts";
import { invalidParams } from "./errors.ts";
import type { ToolDefinition } from "./registry.ts";
import {
  applyInputPatchSchema,
  compareScenariosSchema,
  draftCrmFollowupSchema,
  explainMathSchema,
  exportScenarioSchema,
  generateClientSummarySchema,
  generateRiskReviewSchema,
  getCapabilitiesSchema,
  listScenariosSchema,
  loadScenarioSchema,
  priceScenarioInputSchema,
  pushScenarioToFiggySchema,
  saveScenarioSchema,
  suggestInputsFromTextSchema,
  validateInputsSchema,
  toJsonSchema,
  type ExplainMathInput,
} from "./schemas.ts";

assertApiServerOnly("mcp/tools");

/* ------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------ */

/** Merge optional extension inputs over their engine defaults. */
function mergeExtension<T extends object>(base: T, extra: unknown): T {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return base;
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    if (key in merged) merged[key] = value;
  }
  return merged as T;
}

/**
 * Build the full engine bundle from (possibly partial) inputs, validating the
 * intake first so `compute()` can never be fed a NaN-producing shape.
 */
async function toBundle(input: {
  intake: unknown;
  lender?: unknown;
  investor?: unknown;
  commercial?: unknown;
}): Promise<ComputeBundle> {
  const { coreIntakeSchema } = await import("../api/schemas.ts");
  const parsed = coreIntakeSchema.safeParse(input.intake);
  if (!parsed.success) {
    throw invalidParams(`invalid intake: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return {
    intake: parsed.data as CoreIntake,
    lender: mergeExtension<LenderExt>(DEFAULT_LENDER, input.lender),
    investor: mergeExtension<InvestorExt>(DEFAULT_INVESTOR, input.investor),
    commercial: mergeExtension<CommercialExt>(DEFAULT_COMMERCIAL, input.commercial),
  };
}

/** The numeric summary block every pricing response shares. */
function summaryOf(output: EngineOutput, intake: { baselineValue: number; targetPrice: number }) {
  return {
    caseId: output.caseId,
    baselineValue: intake.baselineValue,
    targetAsk: intake.targetPrice,
    expectedDomDays: output.expectedDomDays,
    p50DomDays: output.p50DomDays,
    expectedDiscountPct: output.expectedDiscountPct,
    netProceeds: output.netProceeds,
    kappa_t: output.kappaT,
    kappa_eff: output.kappaEff,
    marketTemp: output.marketTemp,
    readConfidence: output.readConfidence,
    flags: [...output.flags],
  };
}

function num(o: Record<string, unknown>, key: string): number | null {
  const value = o[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Tool definitions
 * ------------------------------------------------------------------ */

export const tools: ToolDefinition[] = [
  /* A. price_scenario -------------------------------------------------- */
  {
    name: "property_pricer.price_scenario",
    description:
      "Run the locked Property Pricer engine against supplied property inputs and " +
      "return the full deterministic pricing read. Inputs are re-priced server-side " +
      "with compute(); no caller-sent numbers are trusted.",
    schema: priceScenarioInputSchema,
    inputSchema: toJsonSchema(priceScenarioInputSchema),
    tier: "general",
    async run(args) {
      const input = args as Parameters<typeof toBundle>[0];
      const bundle = await toBundle(input);
      const { output } = computeScenario(bundle, new Date().toISOString());
      return {
        ok: true,
        calcVersion: output.calcVersion,
        inputHash: output.inputHash,
        persona: (args as { persona: PersonaName }).persona,
        engineOutput: output,
        summary: summaryOf(output, bundle.intake as { baselineValue: number; targetPrice: number }),
      };
    },
  },

  /* B. validate_inputs ------------------------------------------------- */
  {
    name: "property_pricer.validate_inputs",
    description:
      "Validate a draft set of property inputs and report what is missing or out of " +
      "range, with normalized values and the human questions needed to complete them.",
    schema: validateInputsSchema,
    inputSchema: toJsonSchema(validateInputsSchema),
    tier: "general",
    async run(args) {
      const { draft } = args as { draft: Record<string, unknown> };
      const { coreIntakeSchema } = await import("../api/schemas.ts");

      const intakeResult = coreIntakeSchema.safeParse(draft);
      const issues: { field: string; message: string }[] = [];
      if (!intakeResult.success) {
        for (const issue of intakeResult.error.issues) {
          issues.push({
            field: issue.path.join(".") || "(root)",
            message: issue.message,
          });
        }
      }

      const normalized = intakeResult.success ? (intakeResult.data as Record<string, unknown>) : {};
      const missingFields = issues.map((i) => i.field);
      const humanQuestions = missingFields.map((f) => `What is the ${f}?`);

      return {
        ok: true,
        valid: issues.length === 0,
        normalized,
        warnings: issues,
        missingFields,
        humanQuestions,
      };
    },
  },

  /* C. suggest_inputs_from_text ---------------------------------------- */
  {
    name: "property_pricer.suggest_inputs_from_text",
    description:
      "Parse plain-language property facts (price, ZIP, square footage, days on " +
      "market, system ages) into structured app inputs. Deterministic extraction " +
      "only — no number is invented; unmatched facts are surfaced as questions.",
    schema: suggestInputsFromTextSchema,
    inputSchema: toJsonSchema(suggestInputsFromTextSchema),
    tier: "general",
    async run(args) {
      const { text } = args as { text: string };
      const patch: Record<string, unknown> = {};
      const assumptions: string[] = [];
      const questions: string[] = [];
      const fieldsUsed: string[] = [];
      const fieldsIgnored: string[] = [];

      const zipMatch = text.match(/\b\d{5}(?:-\d{4})?\b/);
      if (zipMatch) {
        patch.zip = zipMatch[0].slice(0, 5);
        fieldsUsed.push("zip");
      } else {
        questions.push("What ZIP code is the property in?");
      }

      const money = [...text.matchAll(/\$\s?(\d[\d,]*)(?:\.\d+)?\s?(k|m)?/gi)]
        .map((m) => {
          let value = Number(m[1].replace(/,/g, ""));
          const suffix = (m[2] ?? "").toLowerCase();
          if (suffix === "k") value *= 1_000;
          if (suffix === "m") value *= 1_000_000;
          return value;
        })
        .filter((v) => Number.isFinite(v) && v > 0);
      if (money.length >= 2) {
        const sorted = [...money].sort((a, b) => a - b);
        patch.baselineValue = sorted[0];
        patch.targetPrice = sorted[sorted.length - 1];
        assumptions.push(
          `Interpreting the lower figure ($${sorted[0].toLocaleString()}) as baseline value and the higher ($${sorted[sorted.length - 1].toLocaleString()}) as the asking price.`,
        );
        fieldsUsed.push("baselineValue", "targetPrice");
      } else if (money.length === 1) {
        patch.baselineValue = money[0];
        assumptions.push(`Treating $${money[0].toLocaleString()} as the baseline value.`);
        fieldsUsed.push("baselineValue");
        questions.push("What asking price are you testing?");
      } else {
        questions.push("What is the property value / asking price?");
      }

      const sqft = text.match(/(\d[\d,]*)\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i);
      if (sqft) {
        patch.glaSqft = Number(sqft[1].replace(/,/g, ""));
        fieldsUsed.push("glaSqft");
      }

      const dom = text.match(/(\d+)\s*days?\s*(?:on\s*market|dom)/i);
      if (dom) {
        patch.actualDom = Number(dom[1]);
        fieldsUsed.push("actualDom");
      }

      const age = (system: string) => {
        const m = text.match(new RegExp(`${system}[^.]*?(\\d+)\\s*years?`, "i"));
        return m ? Number(m[1]) : null;
      };
      const hvac = age("hvac");
      const roof = age("roof");
      const wh = age("water\\s*heater");
      if (hvac !== null) {
        patch.hvacAge = hvac;
        fieldsUsed.push("hvacAge");
      }
      if (roof !== null) {
        patch.roofAge = roof;
        fieldsUsed.push("roofAge");
      }
      if (wh !== null) {
        patch.whAge = wh;
        fieldsUsed.push("whAge");
      }

      const state = text.match(/\b(pre-?list(?:ing)?|active|pending|closed|withdrawn)\b/i);
      if (state) {
        const map: Record<string, string> = {
          prelist: "pre_listing",
          "pre-list": "pre_listing",
          prelisting: "pre_listing",
          "pre-listing": "pre_listing",
          active: "active",
          pending: "pending",
          closed: "closed",
          withdrawn: "withdrawn",
        };
        const key = state[1].toLowerCase().replace(/\s+/g, "");
        patch.listingState = map[key] ?? "pre_listing";
        fieldsUsed.push("listingState");
      }

      if (fieldsUsed.length === 0) {
        questions.push(
          "I could not extract any known field from that text — include a ZIP, price, or square footage.",
        );
      }

      const confidence =
        fieldsUsed.length >= 4 ? "high" : fieldsUsed.length >= 2 ? "medium" : "low";

      return {
        ok: true,
        inputPatch: patch,
        confidence,
        assumptions,
        questions,
        fieldsUsed,
        fieldsIgnored,
      };
    },
  },

  /* D. apply_input_patch ----------------------------------------------- */
  {
    name: "property_pricer.apply_input_patch",
    description:
      "Apply a structured patch to an existing scenario and (optionally) re-price it. " +
      "Returns the changed fields and, when priceAfterPatch is true, a fresh engine run.",
    schema: applyInputPatchSchema,
    inputSchema: toJsonSchema(applyInputPatchSchema),
    tier: "general",
    async run(args) {
      const { scenario, patch, priceAfterPatch } = args as {
        scenario: Record<string, unknown>;
        patch: Record<string, unknown>;
        priceAfterPatch: boolean;
      };
      const intake = mergeExtension<Record<string, unknown>>(
        { ...((scenario.intake as Record<string, unknown>) ?? scenario) },
        patch.intake ?? {},
      );
      const next: Record<string, unknown> = {
        intake,
        lender: mergeExtension(scenario.lender as Record<string, unknown> | undefined ?? {}, patch.lender ?? {}),
        investor: mergeExtension(scenario.investor as Record<string, unknown> | undefined ?? {}, patch.investor ?? {}),
        commercial: mergeExtension(scenario.commercial as Record<string, unknown> | undefined ?? {}, patch.commercial ?? {}),
      };

      const changedFields: string[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        changedFields.push(key);
      }
      for (const key of Object.keys(patch.intake ?? {})) {
        if (!changedFields.includes(`intake.${key}`)) changedFields.push(`intake.${key}`);
      }

      let engineOutput: EngineOutput | null = null;
      let scenarioOut = next;
      if (priceAfterPatch) {
        const bundle = await toBundle(next as unknown as { intake: unknown; lender?: unknown; investor?: unknown; commercial?: unknown });
        const computed = computeScenario(bundle, new Date().toISOString());
        engineOutput = computed.output;
        scenarioOut = { ...next, calcVersion: computed.output.calcVersion, inputHash: computed.output.inputHash };
      }

      return {
        ok: true,
        scenario: scenarioOut,
        engineOutput,
        changedFields,
      };
    },
  },

  /* E. explain_math ---------------------------------------------------- */
  {
    name: "property_pricer.explain_math",
    description:
      "Explain an engine output in plain language without changing any number. Every " +
      "figure quoted is read verbatim from the supplied engineOutput.",
    schema: explainMathSchema,
    inputSchema: toJsonSchema(explainMathSchema),
    tier: "general",
    async run(args) {
      const input = args as ExplainMathInput & { engineOutput: Record<string, unknown> };
      return { ok: true, ...explainEngineOutput(input.engineOutput, input.persona, input.audience, input.style) };
    },
  },

  /* F. save_scenario --------------------------------------------------- */
  {
    name: "property_pricer.save_scenario",
    description:
      "Save a scenario to the workspace database. The engine is re-run server-side " +
      "from the supplied inputs, so the stored output is authoritative. `tags` are " +
      "accepted for callers' bookkeeping but have no column in the schema and are not persisted.",
    schema: saveScenarioSchema,
    inputSchema: toJsonSchema(saveScenarioSchema),
    tier: "general",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const input = args as {
        name: string;
        persona: PersonaName;
        property?: Record<string, unknown>;
        scenario: Record<string, unknown>;
        engineOutput?: unknown;
        tags?: string[];
      };
      const { createScenario, upsertProperty, createScenarioExport } = await import("../api/store.server.ts");

      const bundle = await toBundle(input.scenario as unknown as { intake: unknown; lender?: unknown; investor?: unknown; commercial?: unknown });
      const { output, facts } = computeScenario(bundle, new Date().toISOString());

      let propertyId: string | null = null;
      if (input.property && Object.keys(input.property).length > 0) {
        const property = await upsertProperty(workspace, {
          address: typeof input.property.address === "string" ? input.property.address : undefined,
          city: typeof input.property.city === "string" ? input.property.city : undefined,
          state: typeof input.property.state === "string" ? input.property.state : undefined,
          zip: typeof input.property.zip === "string" ? input.property.zip : undefined,
          propertyType: typeof input.property.propertyType === "string" ? input.property.propertyType : undefined,
        });
        propertyId = property.id;
      }

      const scenario = await createScenario(workspace, {
        name: input.name,
        persona: input.persona,
        propertyId,
        payload: {
          intake: bundle.intake,
          lender: bundle.lender,
          investor: bundle.investor,
          commercial: bundle.commercial,
        },
        engineOutput: output,
        calcVersion: output.calcVersion,
        inputHash: output.inputHash,
      });

      await createScenarioExport(workspace, {
        scenarioId: scenario.id,
        exportType: "json",
        payload: facts,
      });

      return {
        ok: true,
        scenarioId: scenario.id,
        propertyId,
        savedAt: scenario.updatedAt,
        calcVersion: output.calcVersion,
        inputHash: output.inputHash,
      };
    },
  },

  /* G. load_scenario --------------------------------------------------- */
  {
    name: "property_pricer.load_scenario",
    description: "Load a saved scenario by id, returning its inputs, engine output and property.",
    schema: loadScenarioSchema,
    inputSchema: toJsonSchema(loadScenarioSchema),
    tier: "general",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioId } = args as { scenarioId: string };
      const { getScenario, getProperty } = await import("../api/store.server.ts");
      const scenario = await getScenario(workspace, scenarioId);
      if (!scenario) {
        return { ok: false, scenarioId, error: "scenario not found" };
      }
      const property = scenario.propertyId ? await getProperty(workspace, scenario.propertyId) : null;
      return {
        ok: true,
        scenario: {
          id: scenario.id,
          name: scenario.name,
          persona: scenario.persona,
          calcVersion: scenario.calcVersion,
          inputHash: scenario.inputHash,
          createdAt: scenario.createdAt,
          updatedAt: scenario.updatedAt,
          intake: scenario.intake,
          lender: scenario.lender,
          investor: scenario.investor,
          commercial: scenario.commercial,
        },
        engineOutput: scenario.engineOutput,
        property,
      };
    },
  },

  /* H. list_scenarios -------------------------------------------------- */
  {
    name: "property_pricer.list_scenarios",
    description: "List saved scenarios in the workspace, newest first.",
    schema: listScenariosSchema,
    inputSchema: toJsonSchema(listScenariosSchema),
    tier: "general",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { limit, query, persona } = args as { limit: number; query?: string; persona?: PersonaName };
      const { listScenarios } = await import("../api/store.server.ts");
      const scenarios = await listScenarios(workspace, { limit, offset: 0, search: query, persona });
      return { ok: true, scenarios };
    },
  },

  /* I. compare_scenarios ----------------------------------------------- */
  {
    name: "property_pricer.compare_scenarios",
    description:
      "Compare two or more saved scenarios by a mode (client, investment, lender, risk) " +
      "and return a deterministic winner, tradeoffs, table and recommendation.",
    schema: compareScenariosSchema,
    inputSchema: toJsonSchema(compareScenariosSchema),
    tier: "general",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioIds, comparisonMode } = args as { scenarioIds: string[]; comparisonMode: string };
      const { getScenario } = await import("../api/store.server.ts");
      const scenarios = [];
      for (const id of scenarioIds) {
        const s = await getScenario(workspace, id);
        if (s) scenarios.push(s);
      }
      if (scenarios.length < 2) {
        return { ok: false, error: "at least two of the given scenarios must exist" };
      }
      const result = compareEngineOutputs(
        scenarios.map((s) => ({ id: s.id, name: s.name, persona: s.persona, out: s.engineOutput })),
        comparisonMode,
      );
      return { ok: true, comparison: result };
    },
  },

  /* J. generate_client_summary ----------------------------------------- */
  {
    name: "property_pricer.generate_client_summary",
    description:
      "Generate a client-facing summary from a saved scenario's engine output. With " +
      "provider 'none' the text is deterministic; otherwise it is produced by the " +
      "named provider from the engine facts only.",
    schema: generateClientSummarySchema,
    inputSchema: toJsonSchema(generateClientSummarySchema),
    tier: "ai",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioId, tone, provider } = args as {
        scenarioId: string;
        tone: string;
        provider: (typeof import("./schemas.ts").MCP_LLM_PROVIDERS)[number];
      };
      const { getScenario } = await import("../api/store.server.ts");
      const scenario = await getScenario(workspace, scenarioId);
      if (!scenario) return { ok: false, error: "scenario not found" };

      const { facts } = computeScenario(
        {
          intake: scenario.intake,
          lender: scenario.lender ?? DEFAULT_LENDER,
          investor: scenario.investor ?? DEFAULT_INVESTOR,
          commercial: scenario.commercial ?? DEFAULT_COMMERCIAL,
        },
        new Date().toISOString(),
      );

      if (provider !== "none") {
        const { runNarrativeServerSide } = await import("../ai/run.server.ts");
        const result = await runNarrativeServerSide({
          workspace,
          scenarioId,
          provider,
          purpose: "client_summary",
          persona: scenario.persona,
          facts,
        });
        if (!result.ok) return { ok: false, error: result.message, aiRunId: result.runId };
        return {
          ok: true,
          summary: result.text,
          bullets: splitBullets(result.text),
          recommendedScript: null,
          aiRunId: result.runId,
          calcVersion: facts.version,
          inputHash: facts.inputHash,
        };
      }

      const text = deterministicClientSummary(facts, tone);
      return {
        ok: true,
        summary: text,
        bullets: splitBullets(text),
        recommendedScript: text,
        aiRunId: null,
        calcVersion: facts.version,
        inputHash: facts.inputHash,
      };
    },
  },

  /* K. generate_risk_review -------------------------------------------- */
  {
    name: "property_pricer.generate_risk_review",
    description:
      "Produce a risk review for a saved scenario from its engine output and flags.",
    schema: generateRiskReviewSchema,
    inputSchema: toJsonSchema(generateRiskReviewSchema),
    tier: "ai",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioId, provider } = args as { scenarioId: string; provider: string };
      const { getScenario } = await import("../api/store.server.ts");
      const scenario = await getScenario(workspace, scenarioId);
      if (!scenario) return { ok: false, error: "scenario not found" };

      const { facts } = computeScenario(
        {
          intake: scenario.intake,
          lender: scenario.lender ?? DEFAULT_LENDER,
          investor: scenario.investor ?? DEFAULT_INVESTOR,
          commercial: scenario.commercial ?? DEFAULT_COMMERCIAL,
        },
        new Date().toISOString(),
      );

      if (provider !== "none") {
        const { runNarrativeServerSide } = await import("../ai/run.server.ts");
        const result = await runNarrativeServerSide({
          workspace,
          scenarioId,
          provider: provider as never,
          purpose: "risk_review",
          persona: scenario.persona,
          facts,
        });
        if (!result.ok) return { ok: false, error: result.message, aiRunId: result.runId };
        return {
          ok: true,
          riskReview: { headline: firstLine(result.text), majorRisks: [], mitigations: [], talkTrack: result.text },
          aiRunId: result.runId,
          calcVersion: facts.version,
          inputHash: facts.inputHash,
        };
      }

      return {
        ok: true,
        riskReview: deterministicRiskReview(facts, scenario.persona),
        aiRunId: null,
        calcVersion: facts.version,
        inputHash: facts.inputHash,
      };
    },
  },

  /* L. push_scenario_to_figgy ------------------------------------------ */
  {
    name: "property_pricer.push_scenario_to_figgy",
    description:
      "Push a saved scenario to Figgy AI CRM. The payload is rebuilt from the stored " +
      "engine output; the attempt and its outcome are recorded in crm_sync_events.",
    schema: pushScenarioToFiggySchema,
    inputSchema: toJsonSchema(pushScenarioToFiggySchema),
    tier: "crm",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioId, leadId, contactEmail, contactPhone, createFollowUp } = args as {
        scenarioId: string;
        leadId?: string;
        contactEmail?: string;
        contactPhone?: string;
        createFollowUp: boolean;
      };
      const { getScenario, listCrmConnectionRows, crmConnectionSecrets, recordCrmSyncEvent } =
        await import("../api/store.server.ts");
      const { buildFiggyPayload, pushScenarioToFiggy, figgyEnvApiKey } = await import("../crm/figgy.server.ts");

      const scenario = await getScenario(workspace, scenarioId);
      if (!scenario) return { ok: false, error: "scenario not found" };

      const rows = await listCrmConnectionRows(workspace);
      const connection = rows[0];
      if (!connection) return { ok: false, error: "no Figgy CRM connection configured for this workspace" };
      if (!connection.is_enabled) return { ok: false, error: "the Figgy CRM connection is disabled" };

      const { apiKey } = crmConnectionSecrets(connection);
      const key = apiKey ?? figgyEnvApiKey();
      if (!key) return { ok: false, error: "no Figgy API key configured for this connection" };

      const { facts } = computeScenario(
        {
          intake: scenario.intake,
          lender: scenario.lender ?? DEFAULT_LENDER,
          investor: scenario.investor ?? DEFAULT_INVESTOR,
          commercial: scenario.commercial ?? DEFAULT_COMMERCIAL,
        },
        new Date().toISOString(),
      );

      const payload = buildFiggyPayload({
        facts,
        name: scenario.name,
        persona: scenario.persona,
        property: null,
        generatedAt: new Date().toISOString(),
        sourceLabel: workspace.workspaceName,
      });
      if (leadId) (payload as Record<string, unknown>).leadId = leadId;
      if (contactEmail) (payload as Record<string, unknown>).contactEmail = contactEmail;
      if (contactPhone) (payload as Record<string, unknown>).contactPhone = contactPhone;
      (payload as Record<string, unknown>).createFollowUp = createFollowUp;

      const result = await pushScenarioToFiggy({
        baseUrl: connection.base_url,
        apiKey: key,
        payload,
        eventType: "scenario.upsert",
      });

      await recordCrmSyncEvent({
        workspaceId: workspace.workspaceId,
        scenarioId,
        connectionId: connection.id,
        direction: "outbound",
        eventType: "scenario.upsert",
        request: { caseId: facts.caseId, inputHash: facts.inputHash },
        response: result.ok ? result.body : null,
        status: result.ok ? "succeeded" : "failed",
        error: result.ok ? null : result.error,
      });

      return {
        ok: result.ok,
        figgyId:
          result.ok && result.body && typeof result.body === "object"
            ? String((result.body as Record<string, unknown>).id ?? (result.body as Record<string, unknown>).figgyId ?? "")
            : "",
        crmSyncEventId: null,
        status: result.ok ? "succeeded" : "failed",
        error: result.ok ? null : result.error,
      };
    },
  },

  /* M. draft_crm_followup ---------------------------------------------- */
  {
    name: "property_pricer.draft_crm_followup",
    description:
      "Draft a CRM follow-up (SMS, email or call script) from a saved scenario's " +
      "engine output, deterministic and number-faithful.",
    schema: draftCrmFollowupSchema,
    inputSchema: toJsonSchema(draftCrmFollowupSchema),
    tier: "general",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioId, channel, audience } = args as {
        scenarioId: string;
        channel: string;
        audience: string;
      };
      const { getScenario } = await import("../api/store.server.ts");
      const scenario = await getScenario(workspace, scenarioId);
      if (!scenario) return { ok: false, error: "scenario not found" };

      const { facts } = computeScenario(
        {
          intake: scenario.intake,
          lender: scenario.lender ?? DEFAULT_LENDER,
          investor: scenario.investor ?? DEFAULT_INVESTOR,
          commercial: scenario.commercial ?? DEFAULT_COMMERCIAL,
        },
        new Date().toISOString(),
      );
      const { buildFiggyPayload } = await import("../crm/figgy.server.ts");

      const follow = draftFollowup(facts, channel, audience);
      return {
        ok: true,
        ...follow,
        crmPayload: buildFiggyPayload({
          facts,
          name: scenario.name,
          persona: scenario.persona,
          property: null,
          generatedAt: new Date().toISOString(),
          sourceLabel: workspace.workspaceName,
        }),
      };
    },
  },

  /* N. export_scenario ------------------------------------------------- */
  {
    name: "property_pricer.export_scenario",
    description:
      "Export a saved scenario in one of json, pdf, deck or crm_payload format. " +
      "json and crm_payload are built server-side; pdf/deck record the export row and " +
      "return a payload the client's print pipeline renders.",
    schema: exportScenarioSchema,
    inputSchema: toJsonSchema(exportScenarioSchema),
    tier: "general",
    async run(args, ctx) {
      const workspace = await requireMcpWorkspace(ctx);
      const { scenarioId, format } = args as { scenarioId: string; format: "json" | "pdf" | "deck" | "crm_payload" };
      const { getScenario, createScenarioExport } = await import("../api/store.server.ts");

      const scenario = await getScenario(workspace, scenarioId);
      if (!scenario) return { ok: false, error: "scenario not found" };

      const { facts } = computeScenario(
        {
          intake: scenario.intake,
          lender: scenario.lender ?? DEFAULT_LENDER,
          investor: scenario.investor ?? DEFAULT_INVESTOR,
          commercial: scenario.commercial ?? DEFAULT_COMMERCIAL,
        },
        new Date().toISOString(),
      );

      let payload: unknown;
      if (format === "json") {
        payload = facts;
      } else if (format === "crm_payload") {
        const { buildFiggyPayload } = await import("../crm/figgy.server.ts");
        payload = buildFiggyPayload({
          facts,
          name: scenario.name,
          persona: scenario.persona,
          property: null,
          generatedAt: new Date().toISOString(),
          sourceLabel: workspace.workspaceName,
        });
      } else {
        payload = {
          format,
          scenarioId,
          caseId: facts.caseId,
          inputHash: facts.inputHash,
          calcVersion: facts.version,
          generatedAt: new Date().toISOString(),
          note: "pdf/deck rendering happens client-side; this row records the export.",
        };
      }

      const row = await createScenarioExport(workspace, {
        scenarioId,
        exportType: format,
        payload,
      });

      return {
        ok: row !== null,
        exportId: row?.id ?? null,
        format,
        payload,
        fileUrl: null,
      };
    },
  },

  /* O. get_app_capabilities -------------------------------------------- */
  {
    name: "property_pricer.get_app_capabilities",
    description:
      "Return what this MCP server can do: personas, tools, resources and guardrails.",
    schema: getCapabilitiesSchema,
    inputSchema: toJsonSchema(getCapabilitiesSchema),
    tier: "general",
    async run() {
      const { listToolNames } = await import("./server.ts");
      const { listResourceUris } = await import("./server.ts");
      return {
        ok: true,
        app: "Property Pricer",
        version: "1.6.1",
        personas: ["listing", "lender", "investor", "commercial"],
        tools: listToolNames(),
        resources: listResourceUris(),
        guardrails: [
          "engine is locked and audited",
          "no mock pricing numbers",
          "all pricing uses the locked compute()",
          "no API keys in browser bundles",
          "all LLM/MCP calls are server-side",
        ],
      };
    },
  },
];

/* ------------------------------------------------------------------ *
 * Deterministic text generation (number-faithful; no LLM, no invention)
 * ------------------------------------------------------------------ */

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function explainEngineOutput(
  out: Record<string, unknown>,
  persona: string | undefined,
  audience: string,
  style: string,
) {
  const expectedDomDays = num(out, "expectedDomDays");
  const p50 = num(out, "p50DomDays");
  const pStale = num(out, "pStale120d");
  const p2wk = num(out, "pSold2wk");
  const disc = num(out, "expectedDiscountPct");
  const net = num(out, "netProceeds");
  const sale = num(out, "expectedSalePrice");
  const cot = num(out, "costOfTesting");
  const kappaT = num(out, "kappaT");
  const kappaEff = num(out, "kappaEff");
  const flags = Array.isArray(out.flags) ? (out.flags as string[]) : [];
  const marketTemp = typeof out.marketTemp === "string" ? out.marketTemp : null;
  const confidence = typeof out.readConfidence === "string" ? out.readConfidence : null;

  const numbersUsed: Record<string, unknown> = {
    expectedDomDays,
    p50DomDays: p50,
    pStale120d: pStale,
    pSold2wk: p2wk,
    expectedDiscountPct: disc,
    netProceeds: net,
    expectedSalePrice: sale,
    costOfTesting: cot,
    kappaT,
    kappaEff,
    marketTemp,
    readConfidence: confidence,
    flags,
  };

  const explanation: string[] = [];
  if (expectedDomDays !== null) {
    explanation.push(
      `The engine projects an expected time on market of ${expectedDomDays.toFixed(0)} days, with a median of ${p50?.toFixed(0) ?? "n/a"} days.`,
    );
  }
  if (pStale !== null) {
    explanation.push(
      `The probability the listing goes stale (over 120 days) is ${(pStale * 100).toFixed(1)}%.`,
    );
  }
  if (p2wk !== null) {
    explanation.push(`The chance of selling within two weeks is ${(p2wk * 100).toFixed(1)}%.`);
  }
  if (disc !== null && sale !== null) {
    explanation.push(
      `The expected discount is ${(disc * 100).toFixed(2)}%, giving an expected sale price of ${money(sale)}.`,
    );
  }
  if (net !== null) {
    explanation.push(`Expected net proceeds are ${money(net)}.`);
  }
  if (cot !== null) {
    explanation.push(`The cost of testing the current ask is ${money(cot)}.`);
  }
  if (explanation.length === 0) {
    explanation.push("No numeric fields were found on the supplied engineOutput.");
  }

  const keyDrivers: string[] = [];
  if (kappaEff !== null) keyDrivers.push(`market pace warp κ_eff ${kappaEff.toFixed(4)}`);
  if (kappaT !== null) keyDrivers.push(`submarket warp κ_t ${kappaT.toFixed(4)}`);
  if (marketTemp) keyDrivers.push(`market temperature ${marketTemp}`);
  if (flags.length) keyDrivers.push(`engine flags: ${flags.join(", ")}`);

  const risks: string[] = [];
  if (pStale !== null && pStale > 0.2) risks.push("elevated stale-listing probability");
  if (confidence === "LOW") risks.push("low read confidence — inputs are sparse or conflicting");
  for (const flag of flags) {
    if (/TERMINAL/.test(flag)) risks.push(`a system is flagged terminal (${flag})`);
  }
  if (risks.length === 0) risks.push("no material risk flags on this read");

  const nextSteps: string[] = [
    cot !== null && cot <= 0
      ? "Testing this ask costs nothing beyond carry — the read supports the current posture."
      : "Review the cost of testing before committing to this ask.",
    flags.length ? "Resolve the engine flags before presenting the number." : "Present the number as-is.",
  ];

  // persona/audience/style shape the framing without touching a figure.
  const styleLead =
    style === "executive"
      ? "Executive summary."
      : style === "crm_note"
        ? "CRM note."
        : style === "technical"
          ? "For an analyst."
          : "";
  const audienceLead =
    audience === "client" ? "For the owner:" : audience === "technical" ? "For an analyst:" : "";
  const personaNote = persona && persona !== "listing" ? `(${persona} view)` : "";
  const framing = [styleLead, audienceLead, personaNote].filter(Boolean).join(" ");

  return {
    explanation: framing ? `${framing} ${explanation.join(" ")}` : explanation.join(" "),
    keyDrivers,
    risks,
    nextSteps,
    numbersUsed,
  };
}

function splitBullets(text: string): string[] {
  return text
    .split(/\n|•/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function firstLine(text: string): string {
  return text.split(/\n/)[0]?.trim() ?? "";
}

function deterministicClientSummary(facts: ScenarioFacts, tone: string): string {
  const s = facts.survival;
  const e = facts.economics;
  const lead = tone === "calm" ? "Here is the picture." : "Here is the number.";
  return [
    lead,
    `Your home is valued at ${money(facts.intake.baselineValue)} and we are testing ${money(facts.intake.targetPrice)}.`,
    `The market is ${facts.marketTemp.toLowerCase()}; the engine expects about ${s.expectedDomDays.toFixed(0)} days on market, with a ${(s.pStale120d * 100).toFixed(0)}% chance of going stale beyond 120 days.`,
    `After an expected discount of ${(s.expectedDiscountPct * 100).toFixed(1)}%, the expected sale price is ${money(s.expectedSalePrice)} and expected net proceeds are ${money(e.netProceeds)}.`,
    `The cost of testing this price is ${money(e.costOfTesting)}.`,
  ].join(" ");
}

function deterministicRiskReview(facts: ScenarioFacts, persona: PersonaName) {
  const risks: string[] = [];
  const mitigations: string[] = [];
  const headline = `Risk review (${persona}) — ${facts.marketTemp} market, ${facts.readConfidence} confidence`;

  if (facts.survival.pStale120d > 0.2) {
    risks.push(`high stale-listing probability (${(facts.survival.pStale120d * 100).toFixed(0)}%)`);
    mitigations.push("revisit the asking price or stage the home before listing");
  }
  if (facts.economics.costOfTesting > 0) {
    risks.push(`positive cost of testing (${money(facts.economics.costOfTesting)})`);
    mitigations.push("confirm the seller accepts the carry cost of testing high");
  }
  for (const flag of facts.flags) {
    if (/TERMINAL/.test(flag)) {
      risks.push(`terminal system flag ${flag}`);
      mitigations.push("disclose and price in the flagged system before listing");
    }
  }
  if (facts.flags.includes("EXTREME_OVERSHOOT")) {
    risks.push("extreme overshoot flagged");
    mitigations.push("pull the ask back toward value");
  }
  if (risks.length === 0) {
    risks.push("no material risks flagged");
    mitigations.push("proceed with the current read");
  }
  return { headline, majorRisks: risks, mitigations, talkTrack: `${headline}. ${risks.join(" ")}` };
}

function compareEngineOutputs(
  rows: { id: string; name: string; persona: string; out: EngineOutput }[],
  mode: string,
) {
  const key = (out: EngineOutput): number => {
    switch (mode) {
      case "investment":
        return out.investor?.irrAnnual ?? 0;
      case "lender":
        return -(out.lender?.stressLtv ?? 0);
      case "risk":
        return -(out.pStale120d * 100 + out.flags.length * 3);
      case "client":
      default:
        return out.netProceeds;
    }
  };
  const scored = rows.map((r) => ({ ...r, score: key(r.out) }));
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  const table = scored.map((r) => ({
    id: r.id,
    name: r.name,
    persona: r.persona,
    caseId: r.out.caseId,
    inputHash: r.out.inputHash,
    calcVersion: r.out.calcVersion,
    expectedDomDays: r.out.expectedDomDays,
    pStale120d: r.out.pStale120d,
    expectedDiscountPct: r.out.expectedDiscountPct,
    expectedSalePrice: r.out.expectedSalePrice,
    netProceeds: r.out.netProceeds,
    costOfTesting: r.out.costOfTesting,
    flags: r.out.flags,
  }));

  const tradeoffs: string[] = [];
  if (scored.length > 1) {
    const diff = winner.out.netProceeds - scored[1].out.netProceeds;
    tradeoffs.push(
      `"${winner.name}" leads "${scored[1].name}" by ${money(diff)} in expected net proceeds (${mode} view).`,
    );
  }

  return {
    winner: winner.name,
    tradeoffs,
    table,
    recommendation: `In the ${mode} comparison, "${winner.name}" wins on the engine's own numbers.`,
  };
}

function draftFollowup(facts: ScenarioFacts, channel: string, audience: string) {
  const subject =
    channel === "email"
      ? `Your Property Pricer read for ${facts.intake.zip}`
      : "Your pricing read";
  const cta =
    audience === "seller"
      ? "Want to walk through the number?"
      : audience === "buyer"
        ? "Want to see the property?"
        : "Shall we schedule a call?";
  const body =
    channel === "sms"
      ? `Hi — your Property Pricer read is ready: expected ${facts.survival.expectedDomDays.toFixed(0)} days on market at a ${(facts.survival.expectedDiscountPct * 100).toFixed(1)}% expected discount. ${cta}`
      : channel === "call_script"
        ? `Opening: "I ran your property through our pricing engine. It expects ${facts.survival.expectedDomDays.toFixed(0)} days on market with a ${(facts.survival.pStale120d * 100).toFixed(0)}% chance of going stale." ${cta}`
        : `Hello,\n\nYour Property Pricer read is ready. The engine expects ${facts.survival.expectedDomDays.toFixed(0)} days on market and an expected discount of ${(facts.survival.expectedDiscountPct * 100).toFixed(1)}%.\n\n${cta}\n\n— Property Pricer`;
  return { subject, body, cta };
}
