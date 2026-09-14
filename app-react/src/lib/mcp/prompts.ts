/**
 * MCP prompts (SERVER-ONLY).
 *
 * Each prompt loads a saved scenario, recomputes the locked engine server-side, and
 * embeds the engine's own fact sheet — so an LLM client receives the exact numbers
 * to use and an instruction to use nothing else. The templates are deterministic;
 * only the scenario data varies.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import { DEFAULT_COMMERCIAL, DEFAULT_INVESTOR, DEFAULT_LENDER } from "../../engine/defaults.ts";
import { computeScenario } from "../api/engine-bridge.server.ts";
import { renderFactSheetLines } from "../ai/prompt.server.ts";
import type { PersonaName } from "../api/schemas.ts";
import type { McpContext } from "./context.ts";
import { requireMcpWorkspace } from "./context.ts";
import type { PromptDefinition } from "./registry.ts";
import { z } from "zod";

assertApiServerOnly("mcp/prompts");

const GROUNDING =
  "You are Property Pricer's narrative layer. Use ONLY the engine facts below. " +
  "Do not invent, approximate, or perform new arithmetic on any figure.";

function userMessage(content: string): { role: "user"; content: string }[] {
  return [{ role: "user", content }];
}

/**
 * The pure prompt-rendering step, exported so tests can assert a prompt embeds the
 * engine's exact facts (input hash and figures) without a database round-trip.
 */
export function buildPromptMessage(
  instructions: string,
  facts: import("../api/engine-bridge.server.ts").ScenarioFacts,
  persona: PersonaName,
): { role: "user"; content: string }[] {
  const lines = renderFactSheetLines(facts, persona);
  const content = `${GROUNDING}\n\nENGINE FACTS (calc_version ${facts.version}, input_hash ${facts.inputHash})\n${lines.join("\n")}\n\nTASK\n${instructions}`;
  return userMessage(content);
}

async function render(
  scenarioId: string,
  ctx: McpContext,
  persona: PersonaName,
  instructions: string,
): Promise<{ description: string; messages: { role: "user"; content: string }[] }> {
  const workspace = await requireMcpWorkspace(ctx);
  const { getScenario } = await import("../api/store.server.ts");
  const scenario = await getScenario(workspace, scenarioId);
  if (!scenario) {
    const { notFound } = await import("./errors.ts");
    throw notFound(`scenario ${scenarioId} not found`);
  }
  const { facts } = computeScenario(
    {
      intake: scenario.intake,
      lender: scenario.lender ?? DEFAULT_LENDER,
      investor: scenario.investor ?? DEFAULT_INVESTOR,
      commercial: scenario.commercial ?? DEFAULT_COMMERCIAL,
    },
    new Date().toISOString(),
  );
  const lines = renderFactSheetLines(facts, persona);
  const content = `${GROUNDING}\n\nENGINE FACTS (calc_version ${facts.version}, input_hash ${facts.inputHash})\n${lines.join("\n")}\n\nTASK\n${instructions}`;
  return {
    description: instructions.split("\n")[0] ?? "",
    messages: userMessage(content),
  };
}

export const prompts: PromptDefinition[] = [
  {
    name: "seller_pricing_summary",
    description: "Explain the read to a seller using locked engine numbers only.",
    argumentsSchema: z.object({ scenarioId: z.uuid(), tone: z.string().optional() }),
    get(args, ctx) {
      const { scenarioId } = args as { scenarioId: string };
      return render(
        scenarioId,
        ctx,
        "listing",
        [
          "Write a seller-facing pricing summary. Cover: asking-price risk, expected DOM,",
          "stale-listing probability, expected discount, net proceeds, and the suggested",
          "seller next step. Plain language, no engine variable names (never write kappa,",
          "u_eff, holdback). 140-200 words.",
        ].join(" "),
      );
    },
  },
  {
    name: "listing_agent_strategy",
    description: "Generate a listing strategy: posture, testing risk, talking points, objections.",
    argumentsSchema: z.object({ scenarioId: z.uuid() }),
    get(args, ctx) {
      const { scenarioId } = args as { scenarioId: string };
      return render(
        scenarioId,
        ctx,
        "listing",
        [
          "Generate a listing strategy for the agent: recommended price posture, the risk",
          "of testing high, three talking points, two likely objections with counters, and a",
          "follow-up action.",
        ].join(" "),
      );
    },
  },
  {
    name: "lender_risk_review",
    description: "Lender risk: appraisal gap, LTV stress, winner's curse, DSCR, underwriting flags.",
    argumentsSchema: z.object({ scenarioId: z.uuid() }),
    get(args, ctx) {
      const { scenarioId } = args as { scenarioId: string };
      return render(
        scenarioId,
        ctx,
        "lender",
        [
          "Analyze the lender view: appraisal gap cash, LTV stress, winner's-curse uplift,",
          "DSCR reserve pressure, and any underwriting flags in the engine output.",
        ].join(" "),
      );
    },
  },
  {
    name: "investor_memo",
    description: "Investor memo: levered vs cash IRR, cap-rate spread, stale impact, holdback, go/no-go.",
    argumentsSchema: z.object({ scenarioId: z.uuid() }),
    get(args, ctx) {
      const { scenarioId } = args as { scenarioId: string };
      return render(
        scenarioId,
        ctx,
        "investor",
        [
          "Write an investor memo: levered vs cash IRR, cap-rate spread, stale-listing",
          "impact, holdback risk, and an explicit go/no-go recommendation grounded in the",
          "figures.",
        ].join(" "),
      );
    },
  },
  {
    name: "commercial_broker_memo",
    description: "Commercial broker memo: WALT runway, marketing runway, absorption, vacancy, debt.",
    argumentsSchema: z.object({ scenarioId: z.uuid() }),
    get(args, ctx) {
      const { scenarioId } = args as { scenarioId: string };
      return render(
        scenarioId,
        ctx,
        "commercial",
        [
          "Write a commercial broker memo: WALT runway, marketing runway, absorption",
          "months, vacancy transmission, and debt-maturity risk.",
        ].join(" "),
      );
    },
  },
  {
    name: "figgy_crm_note",
    description: "A Figgy CRM note: short summary, key risks, next step, follow-up wording.",
    argumentsSchema: z.object({ scenarioId: z.uuid(), contactType: z.string().optional() }),
    get(args, ctx) {
      const { scenarioId, contactType } = args as { scenarioId: string; contactType?: string };
      return render(
        scenarioId,
        ctx,
        "listing",
        [
          `Create a CRM note${contactType ? ` for a ${contactType} contact` : ""}: a short`,
          "summary, the key risks, one next step, and suggested follow-up wording. Under",
          "120 words, plain text.",
        ].join(" "),
      );
    },
  },
];
