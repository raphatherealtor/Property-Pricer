/**
 * MCP wire contracts (SERVER-ONLY).
 *
 * Every tool's input is a zod schema here, so validation, normalization and JSON
 * Schema emission (for `tools/list`) share one definition. The locked engine's
 * input shapes are reused from `@/lib/api/schemas` — which are themselves proven
 * against `src/engine/types.ts` at compile time — so an MCP client can never feed
 * this server a shape the engine would not understand.
 *
 * Nothing in this module holds a credential or a provider endpoint. Provider
 * *ids* appear as enum members (public labels), never as URLs or keys.
 */
import {
  commercialExtSchema,
  coreIntakeSchema,
  EXPORT_TYPES,
  investorExtSchema,
  lenderExtSchema,
  PERSONAS,
} from "../api/schemas.ts";
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Enums (mirrored by the DB CHECKs in db/mcp-schema-v1.sql — see
 * scripts/check-locks.mjs, which compares the two).
 * ------------------------------------------------------------------ */

export const MCP_CLIENT_TYPES = [
  "chatgpt",
  "claude",
  "grok",
  "mistral",
  "kimi",
  "deepseek",
  "local",
  "other",
] as const;

export const MCP_CALL_STATUSES = ["succeeded", "failed", "rejected"] as const;

/** OAuth 2.1 client auth methods (mirrored by mcp_oauth_clients.auth_method). */
export const MCP_OAUTH_AUTH_METHODS = ["public_pkce", "confidential_client"] as const;
/** OAuth token kinds (mirrored by mcp_oauth_tokens.kind). */
export const MCP_OAUTH_TOKEN_KINDS = ["access", "refresh"] as const;
/** Supported PKCE code challenge methods (OAuth 2.1 forbids `plain`). */
export const MCP_OAUTH_PKCE_METHODS = ["S256"] as const;

/**
 * The scopes the authorization server issues and the dispatcher enforces.
 * Re-exported from the client-safe wire schema so the OAuth-client registration
 * form renders the same list without importing a server module.
 */
export { MCP_OAUTH_SCOPES, type McpScope } from "../api/schemas.ts";

/** LLM vendors an MCP tool may name. `none` means "deterministic, no LLM". */
export const MCP_LLM_PROVIDERS = [
  "openai",
  "anthropic",
  "grok",
  "mistral",
  "kimi",
  "deepseek",
  "none",
] as const;

export const COMPARISON_MODES = ["client", "investment", "lender", "risk"] as const;
export const SUMMARY_TONES = ["calm", "direct", "premium", "educational"] as const;
export const EXPLAIN_AUDIENCES = [
  "client",
  "agent",
  "lender",
  "investor",
  "broker",
  "technical",
] as const;
export const EXPLAIN_STYLES = ["plain_english", "executive", "technical", "crm_note"] as const;
export const CRM_CHANNELS = ["sms", "email", "call_script"] as const;
export const CRM_AUDIENCES = ["seller", "buyer", "agent", "lender", "investor"] as const;

export type McpLlmProvider = (typeof MCP_LLM_PROVIDERS)[number];
export type McpComparisonMode = (typeof COMPARISON_MODES)[number];

/* ------------------------------------------------------------------ *
 * Tool inputs
 * ------------------------------------------------------------------ */

/** The full engine bundle, re-exported for tool result typing. */
const computeBundleSchema = z.object({
  intake: coreIntakeSchema,
  lender: lenderExtSchema,
  investor: investorExtSchema,
  commercial: commercialExtSchema,
});

/** Opaque JSON payload — validated/normalized by the tool, not by a fixed shape. */
const jsonObject = z.record(z.string(), z.unknown());

export const priceScenarioInputSchema = z.object({
  intake: coreIntakeSchema.passthrough(),
  // Extensions are optional and partial: the tool merges them over engine
  // defaults, so a client may send only the fields it knows (e.g. just noteRate).
  lender: jsonObject.optional(),
  investor: jsonObject.optional(),
  commercial: jsonObject.optional(),
  persona: z.enum(PERSONAS).default("listing"),
  returnTrace: z.boolean().default(true),
});

export const validateInputsSchema = z.object({
  draft: jsonObject,
  persona: z.enum(PERSONAS).optional(),
});

export const suggestInputsFromTextSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  persona: z.enum(PERSONAS).default("listing"),
  currentScenario: jsonObject.optional(),
});

export const applyInputPatchSchema = z.object({
  scenario: jsonObject,
  patch: jsonObject,
  priceAfterPatch: z.boolean().default(true),
});

export const explainMathSchema = z.object({
  engineOutput: jsonObject,
  persona: z.enum(PERSONAS).optional(),
  audience: z.enum(EXPLAIN_AUDIENCES).default("client"),
  style: z.enum(EXPLAIN_STYLES).default("plain_english"),
});

export const saveScenarioSchema = z.object({
  name: z.string().trim().min(1).max(160),
  persona: z.enum(PERSONAS),
  property: jsonObject.optional(),
  scenario: jsonObject,
  engineOutput: jsonObject.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export const loadScenarioSchema = z.object({ scenarioId: z.uuid() });

export const listScenariosSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(120).optional(),
  persona: z.enum(PERSONAS).optional(),
});

export const compareScenariosSchema = z.object({
  scenarioIds: z.array(z.uuid()).min(2).max(10),
  comparisonMode: z.enum(COMPARISON_MODES).default("client"),
});

export const generateClientSummarySchema = z.object({
  scenarioId: z.uuid(),
  tone: z.enum(SUMMARY_TONES).default("direct"),
  provider: z.enum(MCP_LLM_PROVIDERS).default("none"),
});

export const generateRiskReviewSchema = z.object({
  scenarioId: z.uuid(),
  persona: z.enum(PERSONAS).optional(),
  provider: z.enum(MCP_LLM_PROVIDERS).default("none"),
});

export const pushScenarioToFiggySchema = z.object({
  scenarioId: z.uuid(),
  leadId: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().email().max(320).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  createFollowUp: z.boolean().default(true),
});

export const draftCrmFollowupSchema = z.object({
  scenarioId: z.uuid(),
  channel: z.enum(CRM_CHANNELS).default("sms"),
  audience: z.enum(CRM_AUDIENCES).default("seller"),
});

export const exportScenarioSchema = z.object({
  scenarioId: z.uuid(),
  format: z.enum(EXPORT_TYPES),
});

export const getCapabilitiesSchema = z.object({});

export type PriceScenarioInput = z.infer<typeof priceScenarioInputSchema>;
export type ExplainMathInput = z.infer<typeof explainMathSchema>;
export type SaveScenarioInput = z.infer<typeof saveScenarioSchema>;

/* ------------------------------------------------------------------ *
 * JSON Schema emission (tools/list + the REST bridge)
 * ------------------------------------------------------------------ */

/** Draft-07 for maximum client compatibility across MCP SDKs. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
}

/** The engine's own input schema, emitted from the zod types so it cannot drift. */
export const ENGINE_INPUT_JSON_SCHEMA = toJsonSchema(computeBundleSchema);
