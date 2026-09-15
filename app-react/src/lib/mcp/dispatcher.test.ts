/**
 * MCP dispatcher / route tests.
 *
 * These exercise the same `handleMcpRequest` the HTTP routes call, with auth
 * configured via env. The global bearer token is used for the success paths; the
 * rejection path proves an unauthenticated call is refused before tool execution.
 * Audit is best-effort and (under Node, where the platform's DB bootstrap is
 * unavailable) silently no-ops, so these assertions never depend on a database.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { handleMcpRequest } from "@/lib/mcp/server";
import { handleMcpRestBridge } from "@/lib/mcp/http";
import { resolveMcpContext } from "@/lib/mcp/auth";
import { DEFAULT_INTAKE } from "@/engine/defaults";

const TOKEN = "test-mcp-token-123456";

beforeEach(() => {
  process.env.PROPERTY_PRICER_MCP_TOKEN = TOKEN;
  process.env.MCP_REQUIRE_AUTH = "true";
});

afterEach(() => {
  delete process.env.PROPERTY_PRICER_MCP_TOKEN;
  delete process.env.MCP_REQUIRE_AUTH;
});

function headers(token = TOKEN) {
  return new Headers({ authorization: `Bearer ${token}` });
}

test("initialize negotiates the protocol and server info", async () => {
  const result = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  })) as { result: { protocolVersion: string; serverInfo: { name: string; version: string } } };
  assert.ok(result.result.protocolVersion);
  assert.equal(result.result.serverInfo.name, "property-pricer");
  assert.equal(result.result.serverInfo.version, "1.6.1");
});

test("tools/list returns the registry and tools/call prices through the engine", async () => {
  const list = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  })) as { result: { tools: { name: string }[] } };
  assert.equal(list.result.tools.length, 15);

  const call = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "property_pricer.price_scenario", arguments: { intake: DEFAULT_INTAKE, returnTrace: false } },
  })) as { result: { isError?: boolean; structuredContent: { ok: boolean; inputHash: string } } };
  assert.notEqual(call.result.isError, true);
  assert.equal(call.result.structuredContent.ok, true);
  assert.match(call.result.structuredContent.inputHash, /^[0-9a-f]{8}$/);
});

test("the read-only profile exposes no mutation, AI, CRM, or export tools", async () => {
  const list = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 30,
    method: "tools/list",
  }, "read")) as { result: { tools: { name: string }[] } };
  const names = list.result.tools.map((tool) => tool.name);

  assert.deepEqual(names, [
    "property_pricer.price_scenario",
    "property_pricer.validate_inputs",
    "property_pricer.suggest_inputs_from_text",
    "property_pricer.explain_math",
    "property_pricer.load_scenario",
    "property_pricer.list_scenarios",
    "property_pricer.compare_scenarios",
  ]);

  const blocked = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 31,
    method: "tools/call",
    params: { name: "property_pricer.save_scenario", arguments: {} },
  }, "read")) as { result: { isError?: boolean; content: { text: string }[] } };
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.content[0].text, /Unknown tool/);
});

test("tools/call rejects an invalid persona with isError content, not a crash", async () => {
  const call = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "property_pricer.price_scenario", arguments: { intake: DEFAULT_INTAKE, persona: "wizard" } },
  })) as { result: { isError?: boolean; content: { text: string }[] } };
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /Invalid arguments/);
});

test("an unknown tool returns isError content", async () => {
  const call = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "property_pricer.nope", arguments: {} },
  })) as { result: { isError?: boolean } };
  assert.equal(call.result.isError, true);
});

test("resources/read returns the engine contract over JSON-RPC", async () => {
  const read = (await handleMcpRequest(headers(), {
    jsonrpc: "2.0",
    id: 6,
    method: "resources/read",
    params: { uri: "property-pricer://engine/contract" },
  })) as { result: { contents: { text: string }[] } };
  assert.match(read.result.contents[0].text, /locked and audited/);
});

test("an unauthenticated call is rejected before any tool runs", async () => {
  await assert.rejects(
    () => resolveMcpContext(new Headers()),
    (err: Error & { httpStatus?: number }) => err.httpStatus === 401,
  );
});

test("a wrong token is rejected", async () => {
  await assert.rejects(
    () => resolveMcpContext(headers("wrong-token")),
    (err: Error & { httpStatus?: number }) => err.httpStatus === 401,
  );
});

test("the REST bridge returns the documented shape, not the JSON-RPC envelope", async () => {
  const auth = { authorization: `Bearer ${TOKEN}` };

  const toolsList = await handleMcpRestBridge(
    new Request("http://x/api/mcp/tools/list", { method: "POST", headers: auth }),
    "/api/mcp/tools/list",
  );
  const listBody = (await toolsList.json()) as { tools?: unknown; jsonrpc?: unknown };
  assert.ok(Array.isArray(listBody.tools), "tools/list must return { tools: [...] }");
  assert.equal(listBody.jsonrpc, undefined, "the JSON-RPC envelope must not leak into the bridge");

  const call = await handleMcpRestBridge(
    new Request("http://x/api/mcp/tools/call", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name: "property_pricer.price_scenario",
        arguments: { intake: DEFAULT_INTAKE, returnTrace: false },
      }),
    }),
    "/api/mcp/tools/call",
  );
  const callBody = (await call.json()) as {
    ok: boolean;
    content: { type: string; json: { ok: boolean; inputHash: string } }[];
  };
  assert.equal(callBody.ok, true);
  assert.equal(callBody.content[0].type, "json");
  assert.match(callBody.content[0].json.inputHash, /^[0-9a-f]{8}$/);
});
