/**
 * MCP client onboarding presets (SERVER-ONLY).
 *
 * A read-only catalog of the AI platforms a Property Pricer operator is most
 * likely to connect, plus the two generic entries (a native MCP client and a
 * plain REST/OpenAPI client). Each preset is a template — an OAuth `client_id`
 * is a *descriptive identifier*, not a credential, and every redirect URI and
 * scope is public, well-known onboarding data. No platform secret, key or token
 * lives in this module: the bearer token appears only as the `YOUR_MCP_TOKEN`
 * placeholder, exactly like the admin panel.
 *
 * The catalog is served over `GET /api/mcp/clients/presets` and
 * `GET /api/mcp/clients/{id}/setup` and rendered by the Cloud → MCP panel.
 */
import { assertApiServerOnly } from "../api/server-only.ts";

assertApiServerOnly("mcp/clients");

export type ClientAuthMethod = "public_pkce" | "confidential_client";
export type ClientTransport = "mcp" | "rest";

/** The shape served to the browser and to external operators. */
export type ClientPresetDto = {
  id: string;
  /** OAuth public client identifier — descriptive, NOT a secret. */
  clientId: string;
  displayName: string;
  transport: ClientTransport;
  authMethod: ClientAuthMethod;
  allowedRedirectUriPatterns: string[];
  defaultScopes: string[];
  description: string;
  /** Markdown-ish setup instructions with `{baseUrl}` already substituted. */
  setupInstructions: string;
  /** The copy-paste block (MCP config JSON, or REST bridge lines). */
  configSnippet: string;
};

type ClientPresetTemplate = {
  id: string;
  clientId: string;
  displayName: string;
  transport: ClientTransport;
  authMethod: ClientAuthMethod;
  allowedRedirectUriPatterns: string[];
  defaultScopes: string[];
  description: string;
  setup: string;
  snippet: string;
};

const DEFAULT_SCOPES = ["mcp:tools", "mcp:resources", "mcp:prompts"] as const;
const B = "__BASE_URL__";

function mcpConfigJson(baseUrl: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      mcpServers: {
        "property-pricer": {
          ...extra,
          url: `${baseUrl}/api/mcp`,
          headers: { Authorization: "Bearer YOUR_MCP_TOKEN" },
        },
      },
    },
    null,
    2,
  );
}

function restBridgeLines(baseUrl: string): string {
  return [
    "Connect through the REST bridge (OpenAPI 3.1 published at the first URL):",
    "",
    `OpenAPI  ${baseUrl}/api/openapi.json`,
    `Tools    POST ${baseUrl}/api/mcp/tools/list`,
    `Call     POST ${baseUrl}/api/mcp/tools/call`,
    `Resource GET  ${baseUrl}/api/mcp/resources/list`,
    `Prompts  GET  ${baseUrl}/api/mcp/prompts/list`,
    "",
    "Always send the header:",
    "Authorization: Bearer YOUR_MCP_TOKEN",
  ].join("\n");
}

const TEMPLATES: ClientPresetTemplate[] = [
  {
    id: "chatgpt",
    clientId: "property-pricer.chatgpt",
    displayName: "ChatGPT",
    transport: "rest",
    authMethod: "confidential_client",
    allowedRedirectUriPatterns: ["https://chatgpt.com/aip/*/oauth/callback"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "ChatGPT connects via a custom GPT / Action using this server's OpenAPI spec. OpenAI's OAuth flow is confidential (a client secret is issued per Action), so register a confidential client and paste the callback OpenAI shows you.",
    setup: [
      "1. In ChatGPT, create a custom GPT and add an Action.",
      `2. Point the Action's OpenAPI schema at ${B}/api/openapi.json.`,
      "3. In the Action's OAuth settings, choose OAuth and copy the callback URL OpenAI displays into this server's allowed redirect URIs.",
      "4. Register a confidential client for this preset and provide ChatGPT the client id and secret.",
      "5. Use the bearer MCP token as the fallback if you skip OAuth for a single-user Action.",
      "",
      "Allowed redirect URI pattern: https://chatgpt.com/aip/*/oauth/callback",
    ].join("\n"),
    snippet: restBridgeLines(B),
  },
  {
    id: "claude",
    clientId: "property-pricer.claude",
    displayName: "Claude (Desktop & Claude.ai)",
    transport: "mcp",
    authMethod: "public_pkce",
    allowedRedirectUriPatterns: ["http://localhost:*", "https://claude.ai/*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Claude Desktop and Claude.ai connect over native MCP (Streamable HTTP) using OAuth 2.0 with PKCE and a loopback redirect — a public client, no secret.",
    setup: [
      "1. In Claude Desktop, open Settings → Developer → Edit Config.",
      "2. Paste the config block below (replace YOUR_MCP_TOKEN with the server's bearer token).",
      "3. For OAuth, register a *public* client (PKCE) with the loopback redirect http://localhost:* — no client secret.",
      "4. Restart Claude Desktop; the property-pricer tools appear on the next prompt.",
      "",
      "Allowed redirect URI patterns: http://localhost:* and https://claude.ai/*",
    ].join("\n"),
    snippet: mcpConfigJson(B, { type: "http" }),
  },
  {
    id: "grok",
    clientId: "property-pricer.grok",
    displayName: "Grok (xAI)",
    transport: "mcp",
    authMethod: "public_pkce",
    allowedRedirectUriPatterns: ["http://localhost:*", "https://grok.com/*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Grok's MCP client connects over native MCP using OAuth 2.0 with PKCE (public client) and a loopback redirect.",
    setup: [
      "1. Add an MCP server in Grok pointing at the endpoint below.",
      "2. Use OAuth (public client, PKCE) with the loopback redirect http://localhost:*.",
      "3. If Grok's client does not offer OAuth, paste the config block with the bearer token instead.",
      "",
      "Allowed redirect URI patterns: http://localhost:* and https://grok.com/*",
    ].join("\n"),
    snippet: mcpConfigJson(B, { type: "http" }),
  },
  {
    id: "mistral",
    clientId: "property-pricer.mistral",
    displayName: "Mistral (Le Chat)",
    transport: "rest",
    authMethod: "confidential_client",
    allowedRedirectUriPatterns: ["https://chat.mistral.ai/*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Mistral's platform is API-key based. Connect it as a confidential client through the REST bridge, using the bearer MCP token (or a client secret) rather than a PKCE loopback.",
    setup: [
      "1. In Le Chat / the Mistral platform, register a tool or plugin using an OpenAPI schema.",
      `2. Point it at ${B}/api/openapi.json.`,
      "3. Authenticate with the bearer MCP token (single shared token) or a confidential client secret.",
      "4. There is no standard Mistral OAuth loopback; keep the bearer token fallback for simplicity.",
      "",
      "Allowed redirect URI pattern (if OAuth is used): https://chat.mistral.ai/*",
    ].join("\n"),
    snippet: restBridgeLines(B),
  },
  {
    id: "kimi",
    clientId: "property-pricer.kimi",
    displayName: "Kimi (Moonshot)",
    transport: "rest",
    authMethod: "confidential_client",
    allowedRedirectUriPatterns: ["https://platform.moonshot.ai/*", "https://kimi.moonshot.cn/*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Moonshot's Kimi platform is OpenAI-compatible and API-key based. Connect it through the REST bridge with the bearer MCP token or a confidential client secret.",
    setup: [
      "1. In the Moonshot platform, register a tool/plugin with an OpenAPI schema.",
      `2. Point it at ${B}/api/openapi.json.`,
      "3. Authenticate with the bearer MCP token (or a confidential client secret).",
      "4. There is no public Kimi OAuth loopback; the bearer fallback is the simplest wiring.",
      "",
      "Allowed redirect URI patterns (if OAuth is used): https://platform.moonshot.ai/* and https://kimi.moonshot.cn/*",
    ].join("\n"),
    snippet: restBridgeLines(B),
  },
  {
    id: "zai",
    clientId: "property-pricer.zai",
    displayName: "Z.ai",
    transport: "rest",
    authMethod: "confidential_client",
    allowedRedirectUriPatterns: ["https://z.ai/*", "https://chat.z.ai/*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Z.ai exposes an OpenAI-compatible API. Connect it through the REST bridge with the bearer MCP token or a confidential client secret.",
    setup: [
      "1. In Z.ai, register a tool/plugin using an OpenAPI schema.",
      `2. Point it at ${B}/api/openapi.json.`,
      "3. Authenticate with the bearer MCP token (or a confidential client secret).",
      "4. Z.ai has no documented OAuth loopback for MCP; use the bearer fallback.",
      "",
      "Allowed redirect URI patterns (if OAuth is used): https://z.ai/* and https://chat.z.ai/*",
    ].join("\n"),
    snippet: restBridgeLines(B),
  },
  {
    id: "deepseek",
    clientId: "property-pricer.deepseek",
    displayName: "DeepSeek",
    transport: "rest",
    authMethod: "confidential_client",
    allowedRedirectUriPatterns: ["https://platform.deepseek.com/*", "https://chat.deepseek.com/*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "DeepSeek exposes an OpenAI-compatible API. Connect it through the REST bridge with the bearer MCP token or a confidential client secret.",
    setup: [
      "1. In the DeepSeek platform, register a tool/plugin using an OpenAPI schema.",
      `2. Point it at ${B}/api/openapi.json.`,
      "3. Authenticate with the bearer MCP token (or a confidential client secret).",
      "4. DeepSeek has no documented OAuth loopback for MCP; use the bearer fallback.",
      "",
      "Allowed redirect URI patterns (if OAuth is used): https://platform.deepseek.com/* and https://chat.deepseek.com/*",
    ].join("\n"),
    snippet: restBridgeLines(B),
  },
  {
    id: "generic-mcp",
    clientId: "property-pricer.mcp-client",
    displayName: "Generic MCP client",
    transport: "mcp",
    authMethod: "public_pkce",
    allowedRedirectUriPatterns: ["http://localhost:*", "https://*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Any MCP-capable client (Cursor, Windsurf, a bespoke agent, …) over native Streamable HTTP. Public PKCE by default; fall back to the bearer token when the client has no OAuth loop.",
    setup: [
      "1. Point the client at the MCP endpoint below.",
      "2. Prefer OAuth (public client, PKCE) with a loopback or https redirect.",
      "3. If the client only supports a bearer header, use the config block with YOUR_MCP_TOKEN.",
      "",
      "Allowed redirect URI patterns: http://localhost:* and https://*",
    ].join("\n"),
    snippet: mcpConfigJson(B),
  },
  {
    id: "generic-rest",
    clientId: "property-pricer.rest-client",
    displayName: "Generic REST / OpenAPI client",
    transport: "rest",
    authMethod: "public_pkce",
    allowedRedirectUriPatterns: ["https://*"],
    defaultScopes: [...DEFAULT_SCOPES],
    description:
      "Any HTTP client (n8n, Zapier, Postman, a custom script, …) using the REST bridge and the published OpenAPI 3.1 spec. Bearer MCP token is the simplest auth; OAuth PKCE is available for web apps.",
    setup: [
      "1. Import the OpenAPI spec into the client.",
      `2. Spec URL: ${B}/api/openapi.json`,
      "3. Send the bearer token on every call:",
      "   Authorization: Bearer YOUR_MCP_TOKEN",
      "4. For a browser/web app, use OAuth PKCE with your https redirect instead.",
      "",
      "Allowed redirect URI pattern (OAuth web app): https://*",
    ].join("\n"),
    snippet: restBridgeLines(B),
  },
];

function render(value: string, baseUrl: string): string {
  return value.split(B).join(baseUrl.replace(/\/+$/, ""));
}

export function listClientPresets(baseUrl = "https://YOUR_DOMAIN"): ClientPresetDto[] {
  const host = baseUrl.replace(/\/+$/, "");
  return TEMPLATES.map((t) => ({
    id: t.id,
    clientId: t.clientId,
    displayName: t.displayName,
    transport: t.transport,
    authMethod: t.authMethod,
    allowedRedirectUriPatterns: [...t.allowedRedirectUriPatterns],
    defaultScopes: [...t.defaultScopes],
    description: t.description,
    setupInstructions: render(t.setup, host),
    configSnippet: render(t.snippet, host),
  }));
}

export function getClientPreset(id: string, baseUrl = "https://YOUR_DOMAIN"): ClientPresetDto | null {
  const found = TEMPLATES.find((t) => t.id === id);
  return found ? listClientPresets(baseUrl).find((p) => p.id === id) ?? null : null;
}

/** The preset ids, for tests and the OpenAPI spec's `enum`. */
export function listClientPresetIds(): string[] {
  return TEMPLATES.map((t) => t.id);
}
