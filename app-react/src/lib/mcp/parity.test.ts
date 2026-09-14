/**
 * UI-action ↔ MCP-tool parity contract tests.
 *
 * The parity table (`parity.ts`) must be a bijection against the live tool
 * registry: every UI action maps to exactly one real tool, and every registered
 * tool is reachable from exactly one UI action. The contract also proves the MCP
 * surface covers the whole locked-engine surface the UI exposes — personas,
 * inputs, scenarios, flags, exports and Figgy CRM sync.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { UI_ACTION_PARITY } from "@/lib/mcp/parity";
import { listMcpTools } from "@/lib/mcp/server";
import { PERSONAS, EXPORT_TYPES } from "@/lib/api/schemas";
import { MCP_OAUTH_SCOPES } from "@/lib/mcp/schemas";

test("the parity table is a bijection against the live tool registry", () => {
  const registered = listMcpTools().map((t) => t.name).sort();
  const parityTools = UI_ACTION_PARITY.map((p) => p.tool).sort();

  // Every parity row names a real tool, exactly once.
  assert.equal(new Set(parityTools).size, parityTools.length, "parity tools must be unique");
  for (const tool of parityTools) {
    assert.ok(registered.includes(tool), `${tool} is not a registered MCP tool`);
  }

  // And every registered tool is covered by exactly one UI action.
  assert.deepEqual(parityTools, registered, "parity table and tool registry must match 1:1");
});

test("every parity scope is a real OAuth scope", () => {
  for (const row of UI_ACTION_PARITY) {
    for (const scope of row.scopes) {
      assert.ok((MCP_OAUTH_SCOPES as readonly string[]).includes(scope), `${scope} is not a supported scope`);
    }
  }
});

test("the MCP surface covers every engine surface the UI exposes", () => {
  const tools = new Set(listMcpTools().map((t) => t.name));

  // Personas: price_scenario / save_scenario accept a persona and the engine
  // personas union is what the wire schema pins (compile-time + locks).
  assert.equal(PERSONAS.length, 4, "four personas: listing, lender, investor, commercial");
  assert.ok(tools.has("property_pricer.price_scenario"));

  // Inputs: intake + lender/investor/commercial extensions.
  for (const inputTool of [
    "property_pricer.apply_input_patch",
    "property_pricer.validate_inputs",
    "property_pricer.suggest_inputs_from_text",
  ]) {
    assert.ok(tools.has(inputTool), `${inputTool} covers input editing/validation`);
  }

  // Scenarios: save/load/list/compare.
  for (const scenarioTool of [
    "property_pricer.save_scenario",
    "property_pricer.load_scenario",
    "property_pricer.list_scenarios",
    "property_pricer.compare_scenarios",
  ]) {
    assert.ok(tools.has(scenarioTool), `${scenarioTool} covers scenario lifecycle`);
  }

  // Math: price + explain.
  assert.ok(tools.has("property_pricer.price_scenario"));
  assert.ok(tools.has("property_pricer.explain_math"));

  // Exports: all four formats.
  assert.deepEqual([...EXPORT_TYPES].sort(), ["crm_payload", "deck", "json", "pdf"]);
  assert.ok(tools.has("property_pricer.export_scenario"));

  // Figgy CRM sync: push + draft follow-up.
  assert.ok(tools.has("property_pricer.push_scenario_to_figgy"));
  assert.ok(tools.has("property_pricer.draft_crm_followup"));
});
