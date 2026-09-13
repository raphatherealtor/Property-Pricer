/**
 * Figgy AI CRM connector (SERVER-ONLY).
 *
 * Outbound: a workspace's saved scenario is pushed to Figgy's REST API with the
 * key decrypted from `crm_connections.encrypted_api_key`. The payload is built
 * from the engine's own export, so nothing reaches the CRM that the engine did
 * not compute.
 *
 * Inbound: Figgy posts events to `/api/crm/figgy/webhook?connection=<uuid>`.
 * Because that route has no session, the connection id in the query is the only
 * tenant hint and is therefore trusted *only* together with an HMAC signature
 * (or an exact webhook-secret header) computed over the raw body. The webhook
 * secret is stored plaintext in `crm_connections.webhook_secret` — it is a
 * shared verification token, not a credential we present to a third party, and
 * the schema specifies that column type.
 *
 * Neither direction ever returns the API key to a caller.
 */
import { hmacSha256Hex, secretsMatch, signaturesMatch } from "../crypto/secrets.server.ts";
import { assertApiServerOnly } from "../api/server-only.ts";
import { env } from "../env.server.ts";
import type { ScenarioFacts } from "../api/engine-bridge.server.ts";
import type { PersonaName } from "../api/schemas.ts";

assertApiServerOnly("crm/figgy.server");

/** Fallback base URL; `FIGGY_BASE_URL` overrides it for self-hosted deployments. */
export const FIGGY_DEFAULT_BASE_URL = "https://api.figgy.ai";
/** Fallback push path; `FIGGY_SCENARIO_PATH` overrides it. */
export const FIGGY_SCENARIO_PATH = "/api/v1/scenarios";

const DEFAULT_TIMEOUT_MS = 30_000;

export function figgyScenarioPath(): string {
  const configured = env("FIGGY_SCENARIO_PATH");
  if (!configured) return FIGGY_SCENARIO_PATH;
  return configured.startsWith("/") ? configured : `/${configured}`;
}

export function figgyEnvApiKey(): string | null {
  return env("FIGGY_API_KEY") ?? null;
}

export function figgyBaseUrl(): string {
  return env("FIGGY_BASE_URL") ?? FIGGY_DEFAULT_BASE_URL;
}

/* ------------------------------------------------------------------ *
 * Outbound payload
 * ------------------------------------------------------------------ */

/**
 * The CRM-facing projection of a scenario. Every field traces to `ScenarioFacts`
 * (a `buildScenarioExport` result) — there is no computed value here that the
 * locked engine did not produce.
 */
export function buildFiggyPayload(args: {
  facts: ScenarioFacts;
  name: string;
  persona: PersonaName;
  property?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  generatedAt: string;
  sourceLabel: string;
}): Record<string, unknown> {
  const { facts, name, persona, property, generatedAt, sourceLabel } = args;
  const personaMetrics =
    persona === "lender"
      ? facts.personas.lender
      : persona === "investor"
        ? facts.personas.investor
        : persona === "commercial"
          ? facts.personas.commercial
          : facts.personas.listing;

  return {
    source: "property-pricer",
    sourceLabel,
    generatedAt,
    scenario: {
      name,
      persona,
      caseId: facts.caseId,
      calcVersion: facts.version,
      inputHash: facts.inputHash,
    },
    property: {
      zip: facts.intake.zip,
      address: property?.address ?? null,
      city: property?.city ?? null,
      state: property?.state ?? null,
      assetClass: facts.intake.assetClass,
      glaSqft: facts.intake.glaSqft,
    },
    read: {
      marketTemp: facts.marketTemp,
      readConfidence: facts.readConfidence,
      flags: facts.flags,
      listingState: facts.intake.listingState,
      baselineValue: facts.intake.baselineValue,
      targetPrice: facts.intake.targetPrice,
      actualDom: facts.intake.actualDom,
    },
    calibrations: facts.calibrations,
    survival: facts.survival,
    economics: facts.economics,
    metrics: personaMetrics,
    _meta: {
      note: "Values are outputs of the locked Property Pricer engine. Do not edit by hand.",
      engine: "property-pricer",
      engineVersion: facts.version,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Outbound push
 * ------------------------------------------------------------------ */

export type FiggyPushResult =
  | { ok: true; status: number; body: unknown; durationMs: number }
  | { ok: false; status: number | null; error: string; body: unknown; durationMs: number };

function resolveUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(`Figgy base URL must be absolute http(s) (got ${base.slice(0, 40)})`);
  }
  return `${base}${path}`;
}

/**
 * Push one scenario payload to Figgy. Never throws for a vendor/network failure:
 * the caller records the outcome as a `crm_sync_events` row either way, which is
 * what makes a failed sync visible in the UI instead of disappearing.
 */
export async function pushScenarioToFiggy(args: {
  baseUrl: string;
  apiKey: string;
  payload: Record<string, unknown>;
  eventType?: string;
  timeoutMs?: number;
}): Promise<FiggyPushResult> {
  const startedAt = Date.now();
  const url = resolveUrl(args.baseUrl, figgyScenarioPath());
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${args.apiKey}`,
        "x-figgy-event": args.eventType ?? "scenario.upsert",
        "user-agent": "property-pricer/1.6.1",
      },
      body: JSON.stringify(args.payload),
      signal: controller.signal,
    });
    const raw = await res.text().catch(() => "");
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      /* keep text */
    }
    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `Figgy returned HTTP ${res.status}`,
        body,
        durationMs,
      };
    }
    return { ok: true, status: res.status, body, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const aborted = (err as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      status: null,
      error: aborted
        ? "Figgy did not respond before the request timed out."
        : err instanceof Error
          ? err.message
          : String(err),
      body: null,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Inbound webhook
 * ------------------------------------------------------------------ */

export type SignatureVerdict =
  | { ok: true; scheme: "hmac" | "shared-secret" }
  | { ok: false; reason: string };

/** Header names Figgy (and most webhook senders) use for the HMAC digest. */
const SIGNATURE_HEADERS = [
  "x-figgy-signature",
  "x-signature",
  "x-hub-signature-256",
  "x-webhook-signature",
];

function normalizedSignature(raw: string): string {
  return raw.trim().replace(/^sha256=/i, "").trim();
}

/**
 * Verify an inbound request against the connection's stored `webhook_secret`.
 *
 * Accepts either a `sha256=<hex>` HMAC over the raw body, a bare hex digest, or
 * an exact shared-secret header — and fails closed on everything else, including
 * a connection with no secret configured (which would otherwise be an open
 * endpoint).
 */
export function verifyFiggyRequest(args: {
  webhookSecret: string | null;
  rawBody: string;
  headers: Headers;
}): SignatureVerdict {
  const secret = args.webhookSecret?.trim();
  if (!secret) {
    return {
      ok: false,
      reason:
        "connection has no webhook secret configured; inbound delivery is refused " +
        "until one is set (Cloud → CRM → rotate secret)",
    };
  }

  const headerSecret =
    args.headers.get("x-figgy-webhook-secret") ?? args.headers.get("x-webhook-secret");
  if (headerSecret && secretsMatch(secret, headerSecret.trim())) {
    return { ok: true, scheme: "shared-secret" };
  }

  const expected = hmacSha256Hex(secret, args.rawBody);
  for (const name of SIGNATURE_HEADERS) {
    const provided = args.headers.get(name);
    if (!provided) continue;
    if (signaturesMatch(expected, normalizedSignature(provided))) {
      return { ok: true, scheme: "hmac" };
    }
  }

  return { ok: false, reason: "signature mismatch" };
}

export type FiggyInboundEvent = {
  eventType: string;
  /** Either an `inputHash`, a `caseId`, or an external CRM record id. */
  inputHash: string | null;
  caseId: string | null;
  externalId: string | null;
  note: string | null;
  action: "noop" | "handshake" | "send_scenario" | "record_note";
};

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Normalize the handful of Figgy event shapes this connector understands. An
 * unrecognized event is reported as `noop` and still logged — the CRM must never
 * be able to make this endpoint guess.
 */
export function interpretFiggyEvent(body: unknown): FiggyInboundEvent {
  const root =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;

  const eventType =
    pickString(root, ["event", "event_type", "eventType", "type"]) ?? "unknown";
  const inputHash = pickString(data, ["input_hash", "inputHash"]);
  const caseId = pickString(data, ["case_id", "caseId"]);
  const externalId = pickString(data, ["external_id", "externalId", "record_id", "id"]);
  const note = pickString(data, ["note", "body", "message", "text"]);

  const normalized = eventType.toLowerCase();
  if (
    normalized === "handshake" ||
    normalized === "ping" ||
    normalized === "webhook.test" ||
    normalized === "webhook_test"
  ) {
    return { eventType, inputHash, caseId, externalId, note, action: "handshake" };
  }
  if (
    normalized === "scenario.request" ||
    normalized === "scenario_request" ||
    normalized === "scenario.pull" ||
    normalized === "scenario.query"
  ) {
    return { eventType, inputHash, caseId, externalId, note, action: "send_scenario" };
  }
  if (normalized === "scenario.note" || normalized === "note.created" || normalized === "note") {
    return { eventType, inputHash, caseId, externalId, note, action: "record_note" };
  }
  return { eventType, inputHash, caseId, externalId, note, action: "noop" };
}

/** Cap the raw body we are willing to read from an unauthenticated endpoint. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;
