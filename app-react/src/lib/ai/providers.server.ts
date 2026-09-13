/**
 * AI provider adapters (SERVER-ONLY).
 *
 * Every OpenAI / Anthropic / Grok / Mistral call in this app goes through
 * `callChatProvider`. The browser has no provider code path at all: the UI calls
 * a `createServerFn`, the handler resolves a workspace key from the encrypted
 * vault (or the server env fallback), and only the *text* comes back.
 *
 * Guarantees this module enforces:
 *
 *  - The API key never appears in a thrown error, a log line, or a response
 *    body — `redact()` scrubs it from any vendor message before it propagates.
 *  - Every request is bounded by an `AbortController` timeout, so a hung vendor
 *    cannot hold a server-function invocation open indefinitely.
 *  - Base URLs are validated as absolute http(s) before use, so a stored value
 *    cannot turn into a `file:`/relative fetch.
 */
import { env } from "../env.server.ts";
import { assertApiServerOnly } from "../api/server-only.ts";
import { toJsonObject, type AiProviderId, type JsonObject } from "../api/schemas.ts";

assertApiServerOnly("ai/providers.server");

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export type ChatRequest = {
  provider: AiProviderId;
  apiKey: string;
  /** Overrides the provider default; validated before use. */
  baseUrl?: string | null;
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type ChatResult = {
  text: string;
  model: string;
  finishReason: string | null;
  /** Flat scalar usage counters (nested vendor details are dropped). */
  usage: JsonObject | null;
  latencyMs: number;
};

/** Raised for any upstream failure; `message` is always safe to show a user. */
export class ProviderError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

type ProviderProfile = {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  model: string;
  envKeys: string[];
  /** Anthropic is the only non-OpenAI-shaped wire format here. */
  dialect: "openai" | "anthropic";
};

/**
 * The authoritative vendor table: endpoint, default model, fallback env var names,
 * and wire dialect. This is the one place in the repo that names a provider
 * endpoint, which is why it is server-only — `scripts/check-no-client-secrets.mjs`
 * fails the build if a client-bundled file ever mentions one.
 */
function profile(id: AiProviderId, envKeys: string[]): ProviderProfile {
  switch (id) {
    case "anthropic":
      return {
        id,
        label: "Anthropic Claude",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-5",
        envKeys,
        dialect: "anthropic",
      };
    case "grok":
      return {
        id,
        label: "xAI Grok",
        baseUrl: "https://api.x.ai/v1",
        model: "grok-4",
        envKeys,
        dialect: "openai",
      };
    case "mistral":
      return {
        id,
        label: "Mistral",
        baseUrl: "https://api.mistral.ai/v1",
        model: "mistral-large-latest",
        envKeys,
        dialect: "openai",
      };
    case "openai":
    default:
      return {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        envKeys,
        dialect: "openai",
      };
  }
}

export const PROVIDER_PROFILES: Record<AiProviderId, ProviderProfile> = {
  openai: profile("openai", ["OPENAI_API_KEY"]),
  anthropic: profile("anthropic", ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]),
  grok: profile("grok", ["GROK_API_KEY", "XAI_API_KEY"]),
  mistral: profile("mistral", ["MISTRAL_API_KEY"]),
};

export function defaultBaseUrl(provider: AiProviderId): string {
  return PROVIDER_PROFILES[provider].baseUrl;
}

export function defaultModel(provider: AiProviderId): string {
  return PROVIDER_PROFILES[provider].model;
}

/**
 * Server env fallback key. Lets an operator run a workspace without storing a
 * key in the database (useful on a single-tenant deploy); the browser is never
 * told the value — only that one resolved.
 */
export function envApiKeyFor(provider: AiProviderId): string | null {
  for (const key of PROVIDER_PROFILES[provider].envKeys) {
    const value = env(key);
    if (value) return value;
  }
  return null;
}

export function hasEnvKeyFor(provider: AiProviderId): boolean {
  return envApiKeyFor(provider) !== null;
}

/** Scrub a credential out of any string that could be logged or returned. */
function redact(text: string, apiKey: string): string {
  let out = String(text);
  if (apiKey && apiKey.length >= 8) {
    out = out.split(apiKey).join("[redacted]");
  }
  // Vendor error bodies occasionally echo `"api_key":"…"` or a bearer header.
  return out
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]")
    .replace(/("?(?:api[_-]?key|authorization|x-api-key)"?\s*[:=]\s*"?)[^",}\s]{8,}/gi, "$1[redacted]");
}

function resolveEndpoint(baseUrl: string | null | undefined, provider: AiProviderId): string {
  const raw = (baseUrl?.trim() || defaultBaseUrl(provider)).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) {
    throw new ProviderError(
      "invalid_base_url",
      `base URL must be an absolute http(s) URL (got ${raw.slice(0, 40)})`,
    );
  }
  const dialect = PROVIDER_PROFILES[provider].dialect;
  return `${raw}${dialect === "anthropic" ? "/messages" : "/chat/completions"}`;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function clampInt(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** One shape for a non-2xx vendor response, with the body kept for the audit log. */
async function readError(res: Response, apiKey: string): Promise<{ message: string; body: unknown }> {
  const raw = await res.text().catch(() => "");
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    /* keep the text */
  }
  const message = redact(
    typeof body === "object" && body !== null
      ? String(
          (body as { error?: { message?: string }; message?: string }).error?.message ??
            (body as { message?: string }).message ??
            raw,
        )
      : raw || `HTTP ${res.status}`,
    apiKey,
  );
  return { message: message.slice(0, 600) || `HTTP ${res.status}`, body };
}

function extractOpenAiText(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as Record<string, unknown>;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  // Some OpenAI-compatible servers return the newer content-part array.
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
          ? String((part as { text: string }).text)
          : "",
      )
      .join("");
  }
  if (typeof first?.text === "string") return first.text;
  return "";
}

function extractAnthropicText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
        ? String((part as { text: string }).text)
        : "",
    )
    .join("");
}

/**
 * Call a provider's chat/completions surface and return the assistant text.
 *
 * `system` is passed as a top-level `system` string on Anthropic and as a
 * leading `system` message on the OpenAI-shaped providers, so callers only
 * describe *what* they want said once.
 */
export async function callChatProvider(request: ChatRequest): Promise<ChatResult> {
  const profile = PROVIDER_PROFILES[request.provider];
  if (!profile) {
    throw new ProviderError("unknown_provider", `unknown provider "${request.provider}"`);
  }
  if (!request.apiKey || request.apiKey.trim().length < 8) {
    throw new ProviderError(
      "provider_not_configured",
      `${profile.label} has no API key. Add one in Cloud → Providers, or set ` +
        `${profile.envKeys[0]} on the server.`,
    );
  }

  const apiKey = request.apiKey.trim();
  const endpoint = resolveEndpoint(request.baseUrl, request.provider);
  const model = request.model?.trim() || profile.model;
  const maxTokens = clampInt(request.maxTokens, 16, 8192) ?? 1024;
  const temperature =
    request.temperature !== undefined && Number.isFinite(request.temperature)
      ? Math.max(0, Math.min(2, request.temperature))
      : undefined;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  let body: Record<string, unknown>;

  if (profile.dialect === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      max_tokens: maxTokens,
      system: request.system,
      messages: request.messages.filter((m) => m.role !== "system").map(toWireMessage),
      ...(temperature !== undefined ? { temperature } : {}),
    };
  } else {
    headers.authorization = `Bearer ${apiKey}`;
    body = {
      model,
      messages: [{ role: "system", content: request.system }, ...request.messages.map(toWireMessage)],
      // `max_tokens` is omitted for OpenAI: its reasoning families return 400 for
      // the legacy field, and omitting it lets the server pick a sane cap.
      ...(request.provider === "openai" ? {} : { max_tokens: maxTokens }),
      ...(temperature !== undefined ? { temperature } : {}),
    };
  }

  const controller = new AbortController();
  const timeoutMs = clampInt(request.timeoutMs, 1_000, 180_000) ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === "AbortError") {
      throw new ProviderError(
        "provider_timeout",
        `${profile.label} did not respond within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    throw new ProviderError(
      "provider_unreachable",
      `${profile.label} request failed: ${redact(
        err instanceof Error ? err.message : String(err),
        apiKey,
      )}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const { message } = await readError(res, apiKey);
    throw new ProviderError("provider_error", `${profile.label} returned ${res.status}: ${message}`, res.status);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ProviderError("provider_bad_response", `${profile.label} returned a non-JSON body.`);
  }

  const text =
    profile.dialect === "anthropic"
      ? extractAnthropicText(payload)
      : extractOpenAiText(payload);

  if (!text.trim()) {
    throw new ProviderError(
      "provider_empty_response",
      `${profile.label} returned no text (the prompt may have been refused).`,
    );
  }

  const usage = toJsonObject(payload.usage);

  const finishReason =
    profile.dialect === "anthropic"
      ? typeof payload.stop_reason === "string"
        ? payload.stop_reason
        : null
      : (() => {
          const choices = payload.choices;
          if (!Array.isArray(choices) || choices.length === 0) return null;
          const reason = (choices[0] as { finish_reason?: unknown })?.finish_reason;
          return typeof reason === "string" ? reason : null;
        })();

  return {
    text: text.trim(),
    model: typeof payload.model === "string" && payload.model ? payload.model : model,
    finishReason,
    usage,
    latencyMs: Date.now() - startedAt,
  };
}

function toWireMessage(message: ChatMessage): { role: ChatRole; content: string } {
  return { role: message.role, content: message.content };
}
