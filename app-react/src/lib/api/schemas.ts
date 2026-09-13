/**
 * Wire contracts shared by the browser and the API layer (CLIENT-SAFE).
 *
 * This module holds zod schemas for every request body that crosses the
 * `createServerFn` boundary, plus the DTOs the browser is allowed to see. It
 * deliberately contains **no** server imports, so a React component can import
 * the types and validators without pulling `pg`/PGlite into the bundle.
 *
 * Two hard rules encoded here:
 *
 *  1. The client sends **inputs only** (`intake` / `lender` / `investor` /
 *     `commercial`). It never sends pricing numbers. The server recomputes the
 *     locked engine and stores that output, so a tampered or stale client cannot
 *     put invented math into `engine_output_json`.
 *  2. No DTO in this file has a field capable of carrying API-key material.
 *     Providers expose `hasKey` + `keyHint` only.
 */
import type {
  CommercialExt,
  CoreIntake,
  EngineOutput,
  InvestorExt,
  LenderExt,
  Persona,
} from "@/engine/types";
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Compile-time proof that these enums still match the locked engine.
 * `AssertTrue<Exact<…>>` fails to compile if a persona is added or
 * renamed in `src/engine/types.ts`, which is exactly when the DB CHECK
 * constraints in `db/app-schema-v1.sql` would also need revisiting.
 * ------------------------------------------------------------------ */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERSONAS = ["listing", "lender", "investor", "commercial"] as const;
export const AI_PROVIDER_IDS = ["openai", "anthropic", "grok", "mistral"] as const;
export const AI_PURPOSES = [
  "explain",
  "client_summary",
  "risk_review",
  "crm_note",
  "chat",
] as const;
export const EXPORT_TYPES = ["json", "pdf", "deck", "crm_payload"] as const;
export const LISTING_STATES = [
  "pre_listing",
  "active",
  "pending",
  "closed",
  "withdrawn",
] as const;
export const DOM_CLOCK_BASES = ["closed_only", "cumulative", "unknown"] as const;
export const ASSET_CLASSES = ["residential", "commercial"] as const;
export const TENANT_CREDITS = ["A", "BBB", "NR"] as const;

export type PersonaName = (typeof PERSONAS)[number];
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];
export type AiPurpose = (typeof AI_PURPOSES)[number];
export type ExportType = (typeof EXPORT_TYPES)[number];

export type PersonasMatchEngine = AssertTrue<Exact<PersonaName, Persona>>;

/**
 * Display names for each supported vendor. Deliberately the *only* provider
 * metadata that is client-safe: default endpoints, default models and the names
 * of the server's fallback env vars all live in `@/lib/ai/providers.server.ts`,
 * and `scripts/check-no-client-secrets.mjs` enforces that they never reach a
 * client bundle.
 *
 * The settings form therefore asks for a model/base URL as optional overrides
 * ("blank = provider default") instead of pre-filling vendor values — the server
 * applies its defaults when the field is empty.
 */
export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  grok: "xAI Grok",
  mistral: "Mistral",
};

/** Human labels for each narrative purpose, used by the AI panel's buttons. */
export const AI_PURPOSE_LABELS: Record<AiPurpose, { label: string; hint: string }> = {
  explain: { label: "Explain the read", hint: "Peer-analyst walkthrough of the figures" },
  client_summary: { label: "Client summary", hint: "Plain-language summary for the owner" },
  risk_review: { label: "Risk review", hint: "Downside, flags, and what would change it" },
  crm_note: { label: "CRM note", hint: "Terse note for the deal record" },
  chat: { label: "Ask a question", hint: "Answer from the engine facts only" },
};

const uuid = z.string().regex(UUID_RE, "must be a uuid");
/** `z.number()` already rejects NaN/Infinity in zod 4 — no `.finite()` needed. */
const finite = z.number();
const nonNegative = finite.min(0);
const positive = finite.positive();
const text = (max: number) => z.string().trim().max(max);

/** `{ id }` bodies (deletes, point reads). */
export const idInputSchema = z.object({ id: uuid });
export type IdInput = z.infer<typeof idInputSchema>;

/* ------------------------------------------------------------------ *
 * Engine inputs
 * ------------------------------------------------------------------ */

const tenantRollSchema = z.object({
  sqft: nonNegative,
  expiryMonth: nonNegative,
  annualRent: nonNegative,
  credit: z.enum(TENANT_CREDITS),
});

export const coreIntakeSchema = z.object({
  zip: text(12),
  baselineValue: positive,
  targetPrice: positive,
  listingState: z.enum(LISTING_STATES),
  actualDom: nonNegative.nullable(),
  uiiMonths: positive,
  medianDomZip: positive,
  domClockBasis: z.enum(DOM_CLOCK_BASES),
  glaSqft: positive,
  hvacAge: nonNegative,
  roofAge: nonNegative,
  whAge: nonNegative,
  assetClass: z.enum(ASSET_CLASSES),
});

export const lenderExtSchema = z.object({
  ltv: finite.min(0).max(1.5),
  noteRate: finite.min(0).max(0.5),
  termMonths: positive,
  loanType: text(40),
  appraisedValue: nonNegative,
  programReserveMonths: nonNegative,
  contractPrice: nonNegative,
  noiAnnual: nonNegative,
});

export const investorExtSchema = z.object({
  purchasePrice: nonNegative,
  rentRollMonthly: nonNegative,
  holdYears: nonNegative,
  exitOvershootPct: finite,
  opexRatio: finite.min(0).max(1),
  ltv: finite.min(0).max(1.5),
  noteRate: finite.min(0).max(0.5),
  amortYears: positive,
  ioMonths: nonNegative,
});

export const commercialExtSchema = z.object({
  availableSf: nonNegative,
  monthlyAbsorbedSf: nonNegative,
  waltMonths: nonNegative,
  capRateEntryPct: finite.min(0).max(1),
  tenantRollover: z.array(tenantRollSchema).max(200),
  debtMaturityMonths: nonNegative,
});

/** The full input bundle: everything the locked engine needs, nothing more. */
export const computeBundleSchema = z.object({
  intake: coreIntakeSchema,
  lender: lenderExtSchema,
  investor: investorExtSchema,
  commercial: commercialExtSchema,
});

/* Compile-time proof the wire schemas still describe the engine's own shapes. */
export type IntakeSchemaMatchesEngine = AssertTrue<
  Exact<z.infer<typeof coreIntakeSchema>, CoreIntake>
>;
export type LenderSchemaMatchesEngine = AssertTrue<
  Exact<z.infer<typeof lenderExtSchema>, LenderExt>
>;
export type InvestorSchemaMatchesEngine = AssertTrue<
  Exact<z.infer<typeof investorExtSchema>, InvestorExt>
>;
export type CommercialSchemaMatchesEngine = AssertTrue<
  Exact<z.infer<typeof commercialExtSchema>, CommercialExt>
>;

/* ------------------------------------------------------------------ *
 * Properties
 * ------------------------------------------------------------------ */

export const propertyInputSchema = z.object({
  id: uuid.optional(),
  address: text(200).optional(),
  city: text(120).optional(),
  state: text(40).optional(),
  zip: text(12).optional(),
  propertyType: text(60).optional(),
});

export type PropertyInput = z.infer<typeof propertyInputSchema>;

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

export const scenarioSaveInputSchema = computeBundleSchema.extend({
  /** Existing scenario to update in place; omit to append a new revision. */
  id: uuid.optional(),
  name: text(160).min(1).default("Untitled Scenario"),
  persona: z.enum(PERSONAS),
  propertyId: uuid.optional(),
  /** Created on the fly when the scenario has no `propertyId` yet. */
  property: propertyInputSchema.omit({ id: true }).optional(),
  /**
   * The hash the browser computed for these inputs. Purely diagnostic: it lets
   * the response flag `inputHashDrift` when the deployed engine version differs
   * from the one the browser bundled. The stored hash is always the server's.
   */
  expectedInputHash: text(64).optional(),
});

export const scenarioListInputSchema = z.object({
  propertyId: uuid.optional(),
  persona: z.enum(PERSONAS).optional(),
  search: text(120).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(10_000).default(0),
});

export const scenarioHistoryInputSchema = z.object({
  id: uuid,
  limit: z.number().int().min(1).max(50).default(20),
});

/* ------------------------------------------------------------------ *
 * AI providers + runs
 * ------------------------------------------------------------------ */

export const aiProviderInputSchema = z.object({
  id: uuid.optional(),
  provider: z.enum(AI_PROVIDER_IDS),
  label: text(80).min(1),
  /** Write-only. Omit to keep the stored key; send "" to clear it. */
  apiKey: text(400).optional(),
  baseUrl: text(300).optional(),
  modelDefault: text(120).optional(),
  isEnabled: z.boolean().default(true),
});

export const aiRunInputSchema = computeBundleSchema.extend({
  scenarioId: uuid.optional(),
  providerId: uuid.optional(),
  provider: z.enum(AI_PROVIDER_IDS).optional(),
  purpose: z.enum(AI_PURPOSES).default("explain"),
  persona: z.enum(PERSONAS).default("listing"),
  /** Free-form operator question; only meaningful for `purpose: "chat"`. */
  question: text(2000).optional(),
});

export const aiRunListInputSchema = z.object({
  scenarioId: uuid.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

/* ------------------------------------------------------------------ *
 * CRM (Figgy AI)
 * ------------------------------------------------------------------ */

export const crmConnectionInputSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(8)
    .max(300)
    .regex(/^https?:\/\/[^\s]+$/i, "must be an absolute http(s) URL")
    .refine((v) => v.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)/.test(v), {
      message: "must use https (http is allowed only for localhost development)",
    }),
  /** Write-only. Omit to keep the stored key; send "" to clear it. */
  apiKey: text(400).optional(),
  /** Write-only. Omit to keep the stored secret; send "" to clear it. */
  webhookSecret: text(400).optional(),
  isEnabled: z.boolean().default(true),
});

export const crmPushInputSchema = computeBundleSchema.extend({
  scenarioId: uuid.optional(),
  name: text(160).min(1).default("Untitled Scenario"),
  persona: z.enum(PERSONAS),
  eventType: text(80).default("scenario.upsert"),
});

export const crmEventsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

/* ------------------------------------------------------------------ *
 * DTOs (browser-visible shapes — no secret material, ever)
 * ------------------------------------------------------------------ */

export type WorkspaceDto = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  displayName: string | null;
};

export type PropertyDto = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyType: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScenarioSummaryDto = {
  id: string;
  propertyId: string | null;
  name: string;
  persona: PersonaName;
  caseId: string | null;
  inputHash: string;
  calcVersion: string;
  createdAt: string;
  updatedAt: string;
  headline: {
    expectedDomDays: number | null;
    pStale120d: number | null;
    expectedSalePrice: number | null;
    costOfTesting: number | null;
    marketTemp: string | null;
    readConfidence: string | null;
  };
};

/**
 * Vendor usage blobs (`{ prompt_tokens, completion_tokens }` and friends) are
 * forwarded so the UI can show cost-adjacent counters. Typed as a flat scalar map
 * on purpose: the server strips anything nested before it crosses the
 * `createServerFn` boundary, so the declared type and the runtime value always
 * agree — and it satisfies TanStack Start's serializable-return check, which
 * rejects an untyped `Record<string, unknown>`.
 */
export type JsonObject = Record<string, string | number | boolean | null>;

/** Narrow an arbitrary value to a flat scalar map (used for provider usage). */
export function toJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      out[key] = item;
    }
    // Nested objects/arrays are dropped rather than sent as an untyped blob.
  }
  return out;
}

export type ScenarioDto = ScenarioSummaryDto & {
  intake: CoreIntake;
  lender: LenderExt | null;
  investor: InvestorExt | null;
  commercial: CommercialExt | null;
  /**
   * The stored `engine_output_json`. Typed as the engine's own `EngineOutput`
   * because the **server** is the only writer of that column and it always writes
   * a `compute()` result. `calcVersion` is stored alongside it, so a row produced
   * by a different engine version is detectable.
   */
  engineOutput: EngineOutput;
};

export type ScenarioHistoryDto = {
  scenarioId: string;
  inputHash: string;
  calcVersion: string;
  name: string;
  persona: PersonaName;
  createdAt: string;
  isCurrent: boolean;
};

export type ScenarioExportDto = {
  id: string;
  scenarioId: string;
  exportType: ExportType;
  fileUrl: string | null;
  createdAt: string;
  hasPayload: boolean;
};

export type AiProviderDto = {
  id: string;
  provider: AiProviderId;
  label: string;
  baseUrl: string | null;
  modelDefault: string | null;
  isEnabled: boolean;
  /** False when the row has no stored key and no server env fallback resolves. */
  hasKey: boolean;
  /** "sk-l…3f9a", derived server-side from the decrypted key. Never the key. */
  keyHint: string | null;
  /** True when the key comes from server env rather than this workspace row. */
  usesEnvKey: boolean;
  createdAt: string;
};

export type AiRunDto = {
  id: string;
  scenarioId: string | null;
  provider: string;
  model: string;
  purpose: AiPurpose;
  status: "queued" | "running" | "succeeded" | "failed";
  text: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  usage: JsonObject | null;
  inputHash: string | null;
};

export type CrmConnectionDto = {
  id: string;
  provider: string;
  baseUrl: string;
  isEnabled: boolean;
  hasKey: boolean;
  keyHint: string | null;
  hasWebhookSecret: boolean;
  webhookPath: string;
  createdAt: string;
};

export type CrmSyncEventDto = {
  id: string;
  scenarioId: string | null;
  connectionId: string | null;
  direction: "outbound" | "inbound";
  eventType: string;
  status: "queued" | "succeeded" | "failed";
  error: string | null;
  createdAt: string;
};

export type CloudStatusDto = {
  workspace: WorkspaceDto;
  vaultDurable: boolean;
  providers: AiProviderDto[];
  crm: CrmConnectionDto | null;
};
