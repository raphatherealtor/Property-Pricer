import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const { listMcpTools, listMcpPrompts, handleMcpRequest } = await import(
  "../src/lib/mcp/server.ts"
);
const { tools } = await import("../src/lib/mcp/tools.ts");
const { resources, readResource } = await import("../src/lib/mcp/resources.ts");
const { prompts } = await import("../src/lib/mcp/prompts.ts");
const { resolveMcpContext } = await import("../src/lib/mcp/auth.ts");
const { priceScenarioInputSchema } = await import("../src/lib/mcp/schemas.ts");
const { engineLockViolations } = await import("./check-locks.mjs");
const { scanClientSecrets, FORBIDDEN_CLIENT_HOSTS } = await import(
  "./check-no-client-secrets.mjs"
);

test("tools/list exposes all 15 Property Pricer tools", () => {
  const names = listMcpTools().map((t) => t.name);
  assert.equal(names.length, 15);
  const expected = [
    "property_pricer.price_scenario",
    "property_pricer.validate_inputs",
    "property_pricer.suggest_inputs_from_text",
    "property_pricer.apply_input_patch",
    "property_pricer.explain_math",
    "property_pricer.save_scenario",
    "property_pricer.load_scenario",
    "property_pricer.list_scenarios",
    "property_pricer.compare_scenarios",
    "property_pricer.generate_client_summary",
    "property_pricer.generate_risk_review",
    "property_pricer.push_scenario_to_figgy",
    "property_pricer.draft_crm_followup",
    "property_pricer.export_scenario",
    "property_pricer.get_app_capabilities",
  ];
  assert.deepEqual([...names].sort(), [...expected].sort());
});

test("every tool carries a valid JSON schema", () => {
  for (const tool of listMcpTools()) {
    const schema = tool.inputSchema;
    assert.equal(schema.type, "object", `${tool.name}: inputSchema must be an object`);
    assert.ok(schema.properties, `${tool.name}: inputSchema must declare properties`);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 10, `${tool.name}: description too short`);
  }
});

test("price_scenario runs the locked engine and returns real figures", async () => {
  const { DEFAULT_INTAKE } = await import("../src/engine/defaults.ts");
  const tool = tools.find((t) => t.name === "property_pricer.price_scenario");
  assert.ok(tool);
  const result = await tool.run(
    tool.schema.parse({ intake: DEFAULT_INTAKE, returnTrace: false }),
    { token: null, mode: "anonymous", clientId: null, clientName: "test", clientType: "other", clientVersion: null, workspaceId: null, getWorkspace: async () => null },
  );
  assert.equal(result.ok, true);
  assert.equal(result.calcVersion, "1.6.1");
  assert.match(result.inputHash, /^[0-9a-f]{8}$/);
  assert.equal(typeof result.summary.expectedDomDays, "number");
  assert.ok(result.summary.expectedDomDays > 0);
  assert.ok(Number.isFinite(result.summary.netProceeds));
});

test("an invalid persona is rejected by the tool schema", async () => {
  const { DEFAULT_INTAKE } = await import("../src/engine/defaults.ts");
  const parsed = priceScenarioInputSchema.safeParse({ intake: DEFAULT_INTAKE, persona: "wizard" });
  assert.equal(parsed.success, false);
});

test("no unauthenticated call is allowed when auth is required", async () => {
  const original = process.env.MCP_REQUIRE_AUTH;
  delete process.env.MCP_REQUIRE_AUTH; // default is "true"
  try {
    await assert.rejects(
      () => resolveMcpContext(new Headers()),
      (err) => err.httpStatus === 401,
    );
  } finally {
    if (original === undefined) delete process.env.MCP_REQUIRE_AUTH;
    else process.env.MCP_REQUIRE_AUTH = original;
  }
});

test("resources/read returns the engine contract", async () => {
  const ctx = { token: null, mode: "anonymous", clientId: null, clientName: null, clientType: null, clientVersion: null, workspaceId: null, getWorkspace: async () => null };
  const contract = await readResource("property-pricer://engine/contract", ctx);
  assert.match(contract.text, /locked and audited/);
  assert.match(contract.text, /compute\(\)/);

  const personas = await readResource("property-pricer://engine/personas", ctx);
  assert.match(personas.text, /Listing Agent/);
  assert.match(personas.text, /Commercial Broker/);

  const inputSchema = await readResource("property-pricer://engine/input-schema", ctx);
  const parsed = JSON.parse(inputSchema.text);
  assert.equal(parsed.type, "object");
  assert.ok(parsed.properties.intake, "input-schema must describe the intake");
});

test("prompts/list exposes all six prompts with valid arguments", () => {
  assert.equal(listMcpPrompts().length, 6);
  for (const prompt of listMcpPrompts()) {
    assert.ok(prompt.arguments, `${prompt.name}: missing arguments schema`);
    assert.ok(prompt.arguments.properties?.scenarioId, `${prompt.name}: missing scenarioId`);
  }
});

test("the mcp_calls audit table is defined in the reviewed DDL", () => {
  const sql = readFileSync(join(APP_ROOT, "..", "db", "mcp-schema-v1.sql"), "utf8");
  for (const column of [
    "workspace_id",
    "client_id",
    "user_id",
    "client_name",
    "client_version",
    "tool_name",
    "resource_uri",
    "prompt_name",
    "request_json",
    "response_json",
    "status",
    "error",
    "created_at",
  ]) {
    assert.ok(sql.includes(column), `mcp_calls is missing column ${column}`);
  }
  assert.ok(sql.includes("idx_mcp_calls_tool"));
  assert.ok(sql.includes("idx_mcp_calls_workspace"));
  assert.ok(sql.includes("idx_mcp_clients_workspace"));
});

test("src/engine is unchanged", () => {
  assert.deepEqual(engineLockViolations(APP_ROOT), [], "src/engine/ must be untouched");
});

test("client bundle contains no MCP token or provider secret env names", () => {
  // Source scan is the deterministic proxy: what is in src/ is what gets bundled.
  assert.deepEqual(scanClientSecrets(APP_ROOT), []);

  // The MCP acceptance criteria are narrower than the platform's full env list:
  // the MCP token/config names and the provider secret names/hosts. (The
  // platform's own client bundle already contains unrelated strings such as
  // "BETTER_AUTH_SECRET" — pre-existing, outside this feature's scope.)
  const mcpNeedles = [
    "PROPERTY_PRICER_MCP_TOKEN",
    "MCP_REQUIRE_AUTH",
    "MCP_PUBLIC_BASE_URL",
    "KIMI_API_KEY",
    "MOONSHOT_API_KEY",
    "DEEPSEEK_API_KEY",
    ...FORBIDDEN_CLIENT_HOSTS,
  ];

  const staticDir = join(APP_ROOT, ".vercel", "output", "static");
  if (!existsSync(staticDir)) return;
  const assets = join(staticDir, "assets");
  if (!existsSync(assets)) return;
  for (const entry of readdirSync(assets)) {
    if (!entry.endsWith(".js")) continue;
    const text = readFileSync(join(assets, entry), "utf8");
    for (const needle of mcpNeedles) {
      assert.ok(!text.includes(needle), `built bundle ${entry} leaks "${needle}"`);
    }
  }
});

test("the JSON-RPC dispatcher answers initialize without a database", async () => {
  const original = process.env.PROPERTY_PRICER_MCP_TOKEN;
  process.env.PROPERTY_PRICER_MCP_TOKEN = "test-token-123456";
  process.env.MCP_REQUIRE_AUTH = "false";
  try {
    const headers = new Headers({ authorization: "Bearer test-token-123456" });
    const result = await handleMcpRequest(headers, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    assert.equal(result.result.serverInfo.name, "property-pricer");
  } finally {
    if (original === undefined) delete process.env.PROPERTY_PRICER_MCP_TOKEN;
    else process.env.PROPERTY_PRICER_MCP_TOKEN = original;
    delete process.env.MCP_REQUIRE_AUTH;
  }
});

// Keep the TS imports referenced (the loader resolves them; this test file is
// deliberately the only .mjs that imports TS, via the ts-test-loader).
void resources;
void prompts;
void statSync;
