/**
 * MCP tool tests — the pure tools, which need no database.
 *
 * DB-touching tools are also covered for their *gating*: with an anonymous caller
 * they must refuse before touching storage, which is what `requireMcpWorkspace`
 * guarantees and what these tests assert without booting the DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COMMERCIAL, DEFAULT_INTAKE, DEFAULT_INVESTOR, DEFAULT_LENDER } from "@/engine/defaults";
import { tools } from "@/lib/mcp/tools";
import type { McpContext } from "@/lib/mcp/context";

const anon: McpContext = {
  token: null,
  mode: "anonymous",
  clientId: null,
  clientName: "test",
  clientType: "other",
  clientVersion: null,
  workspaceId: null,
  getWorkspace: async () => null,
};

function tool(name: string) {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `tool ${name} must be registered`);
  return found!;
}

async function run(name: string, args: unknown, ctx: McpContext = anon) {
  const t = tool(name);
  return t.run(t.schema.parse(args), ctx) as Promise<Record<string, unknown>>;
}

test("price_scenario returns engine output, summary and provenance", async () => {
  const result = await run("property_pricer.price_scenario", {
    intake: { ...DEFAULT_INTAKE },
    lender: { noteRate: 0.07 },
    persona: "listing",
    returnTrace: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.calcVersion, "1.6.1");
  assert.match(String(result.inputHash), /^[0-9a-f]{8}$/);
  assert.ok(result.engineOutput, "engineOutput must be present");
  const summary = result.summary as Record<string, unknown>;
  assert.equal(typeof summary.expectedDomDays, "number");
  assert.equal(summary.baselineValue, DEFAULT_INTAKE.baselineValue);
  assert.equal(summary.targetAsk, DEFAULT_INTAKE.targetPrice);
  assert.equal(summary.kappa_t, (result.engineOutput as { kappaT: number }).kappaT);
});

test("validate_inputs reports missing fields and normalizes valid ones", async () => {
  const bad = await run("property_pricer.validate_inputs", {
    draft: { zip: "92373" },
  });
  assert.equal(bad.valid, false);
  assert.ok(Array.isArray(bad.missingFields));
  assert.ok((bad.missingFields as string[]).length > 0);
  assert.ok(Array.isArray(bad.humanQuestions));

  const good = await run("property_pricer.validate_inputs", { draft: { ...DEFAULT_INTAKE } });
  assert.equal(good.valid, true);
  assert.deepEqual(good.missingFields, []);
});

test("suggest_inputs_from_text extracts facts deterministically and never invents", async () => {
  const result = await run("property_pricer.suggest_inputs_from_text", {
    text: "3 bed 2 bath in 90210, asking $750,000 with a $660,000 baseline, 1,900 sq ft, roof is 22 years old.",
    persona: "listing",
  });
  const patch = result.inputPatch as Record<string, unknown>;
  assert.equal(patch.zip, "90210");
  assert.equal(patch.baselineValue, 660_000);
  assert.equal(patch.targetPrice, 750_000);
  assert.equal(patch.glaSqft, 1900);
  assert.equal(patch.roofAge, 22);
  assert.equal(result.confidence, "high");
  assert.ok(Array.isArray(result.assumptions));
});

test("apply_input_patch merges and re-prices", async () => {
  const result = await run("property_pricer.apply_input_patch", {
    scenario: { intake: { ...DEFAULT_INTAKE } },
    patch: { intake: { baselineValue: 700_000 } },
    priceAfterPatch: true,
  });
  const engine = result.engineOutput as { inputHash: string } | null;
  assert.ok(engine?.inputHash, "priceAfterPatch must produce an engine output");
  assert.ok((result.changedFields as string[]).includes("intake"));
});

test("explain_math quotes figures and never changes them", async () => {
  const { computeScenario } = await import("@/lib/api/engine-bridge.server");
  const { output } = computeScenario(
    {
      intake: { ...DEFAULT_INTAKE },
      lender: { ...DEFAULT_LENDER },
      investor: { ...DEFAULT_INVESTOR },
      commercial: { ...DEFAULT_COMMERCIAL },
    },
    new Date().toISOString(),
  );
  const result = await run("property_pricer.explain_math", {
    engineOutput: output as unknown as Record<string, unknown>,
    audience: "client",
    style: "plain_english",
  });
  assert.equal(result.ok, true);
  const explanation = String(result.explanation);
  assert.ok(explanation.includes(String(output.expectedDomDays.toFixed(0))));
  const numbersUsed = result.numbersUsed as Record<string, unknown>;
  assert.equal(numbersUsed.expectedDomDays, output.expectedDomDays);
});

test("workspace-scoped tools refuse an anonymous caller", async () => {
  await assert.rejects(
    () => run("property_pricer.save_scenario", { name: "x", persona: "listing", scenario: { intake: { ...DEFAULT_INTAKE } } }),
    /requires a workspace/,
  );
  await assert.rejects(
    () => run("property_pricer.load_scenario", { scenarioId: "00000000-0000-4000-8000-000000000000" }),
    /requires a workspace/,
  );
});

test("get_app_capabilities lists the full tool and resource surface", async () => {
  const result = await run("property_pricer.get_app_capabilities", {});
  assert.equal(result.app, "Property Pricer");
  assert.equal((result.tools as string[]).length, 15);
  assert.ok((result.resources as string[]).length >= 6);
  assert.ok(Array.isArray(result.guardrails));
});
