/**
 * Client-preset catalog + OpenAPI document tests.
 *
 * The presets are public onboarding metadata, so these assertions are mostly
 * about *shape and absence of secrets*: every preset carries the fields the
 * panel and the OpenAPI spec promise, the ids are stable, and no preset may
 * smuggle a credential. The OpenAPI document must match the live registry and
 * declare both security schemes (OAuth2 PKCE + bearer token).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getClientPreset, listClientPresetIds, listClientPresets } from "@/lib/mcp/clients";
import { buildOpenApiDocument } from "@/lib/mcp/openapi";

const EXPECTED_IDS = [
  "chatgpt",
  "claude",
  "grok",
  "mistral",
  "kimi",
  "zai",
  "deepseek",
  "generic-mcp",
  "generic-rest",
];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/, // OpenAI-style
  /AKIA[0-9A-Z]{16}/, // AWS access key
  /ghp_[A-Za-z0-9]{20,}/, // GitHub PAT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM keys
];

test("the catalog lists exactly the nine supported presets", () => {
  const presets = listClientPresets();
  assert.equal(presets.length, 9);
  assert.deepEqual(listClientPresetIds(), EXPECTED_IDS);
  assert.deepEqual(
    presets.map((p) => p.id),
    EXPECTED_IDS,
  );
});

test("every preset carries the promised onboarding fields", () => {
  for (const preset of listClientPresets()) {
    assert.ok(preset.id.length > 0, `${preset.id}: id`);
    assert.ok(preset.clientId.startsWith("property-pricer."), `${preset.id}: descriptive clientId`);
    assert.ok(preset.displayName.length > 0, `${preset.id}: displayName`);
    assert.ok(["mcp", "rest"].includes(preset.transport), `${preset.id}: transport`);
    assert.ok(["public_pkce", "confidential_client"].includes(preset.authMethod), `${preset.id}: authMethod`);
    assert.ok(preset.defaultScopes.length > 0, `${preset.id}: scopes`);
    assert.ok(preset.description.length > 0, `${preset.id}: description`);
    assert.ok(preset.setupInstructions.length > 0, `${preset.id}: setupInstructions`);
    assert.ok(preset.configSnippet.length > 0, `${preset.id}: configSnippet`);
  }
});

test("preset ids and client ids are unique", () => {
  const presets = listClientPresets();
  assert.equal(new Set(presets.map((p) => p.id)).size, presets.length);
  assert.equal(new Set(presets.map((p) => p.clientId)).size, presets.length);
});

test("native-MCP presets use public PKCE; REST presets are confidential where the platform is key-based", () => {
  const claude = getClientPreset("claude");
  assert.ok(claude);
  assert.equal(claude.transport, "mcp");
  assert.equal(claude.authMethod, "public_pkce");
  assert.ok(claude.allowedRedirectUriPatterns.includes("http://localhost:*"));
  assert.match(claude.configSnippet, /"mcpServers"/);
  assert.match(claude.configSnippet, /\/api\/mcp/);

  const chatgpt = getClientPreset("chatgpt");
  assert.ok(chatgpt);
  assert.equal(chatgpt.transport, "rest");
  assert.equal(chatgpt.authMethod, "confidential_client");
  assert.match(chatgpt.configSnippet, /\/api\/openapi\.json/);

  const genericMcp = getClientPreset("generic-mcp");
  assert.ok(genericMcp);
  assert.equal(genericMcp.transport, "mcp");
  assert.equal(genericMcp.authMethod, "public_pkce");
});

test("getClientPreset returns null for unknown ids", () => {
  assert.equal(getClientPreset("nope"), null);
});

test("no preset carries a hardcoded secret, and the token appears only as a placeholder", () => {
  const serialized = JSON.stringify(listClientPresets("https://example.com"));
  for (const pattern of SECRET_PATTERNS) {
    assert.doesNotMatch(serialized, pattern);
  }
  // The real env var name must never appear in anything served to a client.
  assert.doesNotMatch(serialized, /PROPERTY_PRICER_MCP_TOKEN/);
  assert.match(serialized, /YOUR_MCP_TOKEN/);
});

test("the base URL is substituted into instructions and snippets", () => {
  const claude = getClientPreset("claude", "https://pricer.example.com");
  assert.ok(claude);
  assert.match(claude.configSnippet, /https:\/\/pricer\.example\.com\/api\/mcp/);

  const rest = getClientPreset("generic-rest", "https://pricer.example.com");
  assert.ok(rest);
  assert.match(rest.setupInstructions, /https:\/\/pricer\.example\.com\/api\/openapi\.json/);

  // No template token may survive rendering.
  for (const preset of listClientPresets("https://pricer.example.com")) {
    assert.doesNotMatch(preset.setupInstructions, /__BASE_URL__/);
    assert.doesNotMatch(preset.configSnippet, /__BASE_URL__/);
  }
});

test("the OpenAPI document is 3.1.0 and matches the live registry", () => {
  const doc = buildOpenApiDocument("https://pricer.example.com") as {
    openapi: string;
    info: { version: string };
    servers: { url: string }[];
    paths: Record<string, unknown>;
    components: {
      securitySchemes: Record<string, Record<string, unknown>>;
    };
  };

  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.version, "1.6.1");
  assert.equal(doc.servers[0].url, "https://pricer.example.com");

  // Both transports and the onboarding routes are present.
  for (const path of [
    "/api/mcp",
    "/api/mcp/tools/list",
    "/api/mcp/tools/call",
    "/api/mcp/resources/list",
    "/api/mcp/resources/read",
    "/api/mcp/prompts/list",
    "/api/mcp/prompts/get",
    "/api/mcp/clients/presets",
    "/api/mcp/clients/{id}/setup",
  ]) {
    assert.ok(doc.paths[path], `missing path ${path}`);
  }

  // OAuth2 authorization code + PKCE, and the bearer token fallback.
  const oauth = doc.components.securitySchemes.mcpOAuth;
  assert.equal(oauth.type, "oauth2");
  const flow = oauth.flows as { authorizationCode: Record<string, unknown> };
  assert.ok(flow.authorizationCode, "authorizationCode flow");
  assert.equal(flow.authorizationCode["x-pkce"], true);

  const bearer = doc.components.securitySchemes.mcpBearer;
  assert.equal(bearer.type, "http");
  assert.equal(bearer.scheme, "bearer");
});
