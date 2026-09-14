import assert from "node:assert/strict";
import { test } from "node:test";
import { resources, resourceTemplates, readResource } from "@/lib/mcp/resources";
import type { McpContext } from "@/lib/mcp/context";

const anon: McpContext = {
  token: null,
  mode: "anonymous",
  clientId: null,
  clientName: null,
  clientType: null,
  clientVersion: null,
  workspaceId: null,
  getWorkspace: async () => null,
};

test("all static resources are registered with content", async () => {
  const uris = resources.map((r) => r.uri);
  assert.deepEqual(
    [...uris].sort(),
    [
      "property-pricer://docs/client-explanation-guide",
      "property-pricer://docs/figgy-crm-contract",
      "property-pricer://engine/contract",
      "property-pricer://engine/input-schema",
      "property-pricer://engine/output-schema",
      "property-pricer://engine/personas",
    ].sort(),
  );

  for (const resource of resources) {
    const result = await resource.read(resource.uri, anon);
    assert.ok(result.text.length > 40, `${resource.uri} returned no useful content`);
    assert.equal(result.uri, resource.uri);
  }
});

test("the two scenario resources are registered as URI templates", () => {
  assert.deepEqual(
    resourceTemplates.map((t) => t.uriTemplate).sort(),
    [
      "property-pricer://scenario/{scenarioId}",
      "property-pricer://scenario/{scenarioId}/engine-output",
    ].sort(),
  );
});

test("scenario resources require a workspace", async () => {
  await assert.rejects(
    () => readResource("property-pricer://scenario/00000000-0000-4000-8000-000000000000", anon),
    /requires a workspace/,
  );
});

test("input-schema and output-schema are valid JSON schema documents", async () => {
  const input = JSON.parse((await readResource("property-pricer://engine/input-schema", anon)).text);
  assert.equal(input.type, "object");
  assert.ok(input.properties.intake, "input schema must include the intake");
  assert.ok(input.properties.lender, "input schema must include the lender extension");
  assert.ok(input.properties.commercial, "input schema must include the commercial extension");

  const output = JSON.parse((await readResource("property-pricer://engine/output-schema", anon)).text);
  assert.equal(output.type, "object");
  for (const field of ["calcVersion", "inputHash", "expectedDomDays", "pStale120d", "netProceeds"]) {
    assert.ok(output.properties[field], `output schema is missing ${field}`);
  }
});
