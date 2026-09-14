/**
 * MCP resources (SERVER-ONLY).
 *
 * Static resources are text documents derived from the locked engine's contract;
 * the two scenario resources are URI templates that read from the database. All
 * of them are read-only and audited like any other call.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import { requireMcpWorkspace } from "./context.ts";
import { ENGINE_INPUT_JSON_SCHEMA } from "./schemas.ts";
import type { ResourceDefinition } from "./registry.ts";

assertApiServerOnly("mcp/resources");

const ENGINE_CONTRACT = `# Property Pricer engine contract

The pricing engine is **locked and audited**. \`src/engine/\` is a frozen math SDK:

- No caller may modify the engine (enforced by scripts/engine.lock.json, whose
  SHA-256 pin fails the build on any change).
- No mock pricing numbers exist anywhere: every figure returned by a tool was
  produced by \`compute()\` from validated inputs, or read back verbatim from a
  stored engine output.
- The engine re-runs server-side whenever pricing is required; a client can send
  only inputs, never a price.

## Survival model

Base weekly sale hazard from Gilbukh (2025): 9.8% week 1, 8.4% week 2, then a
decaying tail to a 1.8%/week stale floor. Median base time-on-market is 27.1282
weeks.

## Market warp κ_t

The closed-median DOM is inflated to an all-listings median with
\`infl(k) = k ≤ 1 ? 1.45 : 1 + 0.45·exp(−(k−1)/2)\`, solved by 8 fixed-point
iterations.

## Price time-dilation κ_eff

\`κ_eff = max(0.05, κ_t · max(0.22, (1 − u_eff)^1.15))\`, where
\`u_eff = clamp((ask/baseline − 1.03) / 0.20, 0, 1)\`.

## Readouts

- E[DOM] (capped at 182 days), p50 DOM, P(sold ≤ 2 weeks), P(stale > 120 days)
- survival-weighted expected discount, expected sale price, net proceeds
- cost of testing (anchored net minus test-the-ask net)

## Flags

VELOCITY_TENSION, CENSORING_INFLATION_APPLIED, TERMINAL_HVAC, TERMINAL_ROOF,
TERMINAL_WH, EXTREME_OVERSHOOT, SPARSE_ZIP, STALE_LISTING. Each flag is a caveat,
never a value adjustment.`;

const PERSONAS_DOC = `# Persona definitions

- **Listing Agent** (\`listing\`): expected DOM, discount, sale price, net proceeds,
  cost of testing, optimal ask.
- **Mortgage Lender** (\`lender\`): lesser-of value, loan amount, gap cash, monthly
  PITI, post-close reserve, winner's curse uplift, stress LTV, DSCR reserves.
- **Equity Investor** (\`investor\`): levered and cash IRR, cap rate entry/exit,
  erosion dollars/bps, extra carry, hold years.
- **Commercial Broker** (\`commercial\`): WALT runway, marketing runway, absorption
  months, vacancy transmission, HHI/top-3 concentration, DSCR after reserves.`;

const OUTPUT_SCHEMA_DOC = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Property Pricer engine output (curated)",
    type: "object",
    properties: {
      calcVersion: { type: "string", description: "Locked engine version (e.g. 1.6.1)" },
      inputHash: { type: "string", description: "Stable hash of the inputs" },
      caseId: { type: "string" },
      marketTemp: { enum: ["HOT", "WARM", "BALANCED", "COOL", "COLD"] },
      readConfidence: { enum: ["HIGH", "MEDIUM", "LOW"] },
      uEff: { type: "number" },
      kappaT: { type: "number" },
      kappaEff: { type: "number" },
      kappaUii: { type: "number" },
      tension: { type: "number" },
      expectedDomDays: { type: "number" },
      remainingDomDays: { type: "number" },
      p50DomDays: { type: "number" },
      pStale120d: { type: "number" },
      pSold2wk: { type: "number" },
      expectedDiscountPct: { type: "number" },
      expectedSalePrice: { type: "number" },
      carryTotal: { type: "number" },
      costOfTesting: { type: "number" },
      scaledHoldback: { type: "number" },
      netProceeds: { type: "number" },
      netProceedsAnchored: { type: "number" },
      flags: { type: "array", items: { type: "string" } },
    },
  },
  null,
  2,
);

const CLIENT_GUIDE = `# How to talk to a client about the read

- Lead with expected time on market and the stale-listing probability, not the
  discount — a seller hears "how long" before "how much less".
- Quote engine figures exactly; never say "approximately".
- Frame the cost of testing as the price of the chance to do better, not a fee.
- If a system is flagged terminal (HVAC/roof/water heater), disclose it before the
  number, because a terminal flag is the caveat the buyer will find anyway.
- Never present a LOW-confidence read as a fact.`;

const FIGGY_CONTRACT = `# Figgy CRM payload contract

The outbound payload is built server-side from a fresh engine export:

- source: "property-pricer", sourceLabel, generatedAt
- scenario: name, persona, caseId, calcVersion, inputHash
- property: zip, address, city, state, assetClass, glaSqft
- read: marketTemp, readConfidence, flags, listingState, baselineValue, targetPrice, actualDom
- calibrations, survival, economics, metrics (persona-specific)
- _meta.note: values are locked-engine outputs; do not edit by hand

Auth: Bearer token (encrypted at rest). Webhook: HMAC-SHA256 of the raw body over
the connection's webhook_secret.`;

/** Parse a concrete scenario resource URI into { kind, scenarioId } or null. */
function parseScenarioUri(uri: string): { scenarioId: string; engineOutputOnly: boolean } | null {
  const match = uri.match(/^property-pricer:\/\/scenario\/([0-9a-f-]{36})(\/engine-output)?$/i);
  if (!match) return null;
  return { scenarioId: match[1], engineOutputOnly: Boolean(match[2]) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const resourceTemplates: { uriTemplate: string; name: string; description: string; mimeType: string }[] = [
  {
    uriTemplate: "property-pricer://scenario/{scenarioId}",
    name: "Saved scenario",
    description: "A saved scenario's inputs, persona extensions and engine output.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "property-pricer://scenario/{scenarioId}/engine-output",
    name: "Saved scenario engine output",
    description: "Only the stored engine output for a saved scenario.",
    mimeType: "application/json",
  },
];

export const resources: ResourceDefinition[] = [
  {
    uri: "property-pricer://engine/contract",
    name: "Engine contract",
    description: "How the locked engine works and what it guarantees.",
    mimeType: "text/markdown",
    read: async (uri) => ({ uri, mimeType: "text/markdown", text: ENGINE_CONTRACT }),
  },
  {
    uri: "property-pricer://engine/personas",
    name: "Persona definitions",
    description: "The four personas and the metrics each one sees.",
    mimeType: "text/markdown",
    read: async (uri) => ({ uri, mimeType: "text/markdown", text: PERSONAS_DOC }),
  },
  {
    uri: "property-pricer://engine/input-schema",
    name: "Engine input schema",
    description: "The intake/lender/investor/commercial input schema, emitted from the zod types.",
    mimeType: "application/json",
    read: async (uri) => ({ uri, mimeType: "application/json", text: JSON.stringify(ENGINE_INPUT_JSON_SCHEMA, null, 2) }),
  },
  {
    uri: "property-pricer://engine/output-schema",
    name: "Engine output schema",
    description: "The engine output fields a client can rely on.",
    mimeType: "application/json",
    read: async (uri) => ({ uri, mimeType: "application/json", text: OUTPUT_SCHEMA_DOC }),
  },
  {
    uri: "property-pricer://docs/client-explanation-guide",
    name: "Client explanation guide",
    description: "How to explain results to a property owner without inventing numbers.",
    mimeType: "text/markdown",
    read: async (uri) => ({ uri, mimeType: "text/markdown", text: CLIENT_GUIDE }),
  },
  {
    uri: "property-pricer://docs/figgy-crm-contract",
    name: "Figgy CRM contract",
    description: "The Figgy outbound payload and webhook contract.",
    mimeType: "text/markdown",
    read: async (uri) => ({ uri, mimeType: "text/markdown", text: FIGGY_CONTRACT }),
  },
];

/** Read any resource URI — static, or a concrete scenario template URI. */
export async function readResource(
  uri: string,
  ctx: import("./context.ts").McpContext,
): Promise<{ uri: string; mimeType: string; text: string }> {
  const parsed = parseScenarioUri(uri);
  if (parsed && UUID_RE.test(parsed.scenarioId)) {
    const workspace = await requireMcpWorkspace(ctx);
    const { getScenario } = await import("../api/store.server.ts");
    const scenario = await getScenario(workspace, parsed.scenarioId);
    if (!scenario) {
      const { notFound } = await import("./errors.ts");
      throw notFound(`scenario ${parsed.scenarioId} not found`);
    }
    const body = parsed.engineOutputOnly
      ? scenario.engineOutput
      : {
          id: scenario.id,
          name: scenario.name,
          persona: scenario.persona,
          calcVersion: scenario.calcVersion,
          inputHash: scenario.inputHash,
          intake: scenario.intake,
          lender: scenario.lender,
          investor: scenario.investor,
          commercial: scenario.commercial,
          engineOutput: scenario.engineOutput,
        };
    return { uri, mimeType: "application/json", text: JSON.stringify(body, null, 2) };
  }

  for (const resource of resources) {
    if (resource.uri === uri) return resource.read(uri, ctx);
  }
  const { notFound } = await import("./errors.ts");
  throw notFound(`unknown resource: ${uri}`);
}
