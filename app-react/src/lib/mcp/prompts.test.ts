import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COMMERCIAL, DEFAULT_INTAKE, DEFAULT_INVESTOR, DEFAULT_LENDER } from "@/engine/defaults";
import { computeScenario } from "@/lib/api/engine-bridge.server";
import { buildPromptMessage, prompts } from "@/lib/mcp/prompts";

test("all six prompts are registered", () => {
  assert.deepEqual(
    prompts.map((p) => p.name).sort(),
    [
      "commercial_broker_memo",
      "figgy_crm_note",
      "investor_memo",
      "lender_risk_review",
      "listing_agent_strategy",
      "seller_pricing_summary",
    ].sort(),
  );
});

test("a prompt embeds the engine facts and the input hash", () => {
  const { facts } = computeScenario(
    {
      intake: { ...DEFAULT_INTAKE },
      lender: { ...DEFAULT_LENDER },
      investor: { ...DEFAULT_INVESTOR },
      commercial: { ...DEFAULT_COMMERCIAL },
    },
    "2026-01-01T00:00:00.000Z",
  );
  const [message] = buildPromptMessage(
    "Explain the read to the seller.",
    facts,
    "listing",
  );
  assert.equal(message.role, "user");
  assert.ok(message.content.includes(`input_hash ${facts.inputHash}`));
  assert.ok(message.content.includes(facts.caseId));
  assert.ok(message.content.includes("TASK"));
  assert.ok(message.content.includes("Explain the read to the seller."));
  // The prompt must carry the engine's figures and its grounding instruction.
  assert.ok(message.content.includes("ENGINE FACTS"));
  assert.ok(message.content.includes("Do not invent"));
});

test("each persona selects its own metric block", () => {
  const { facts } = computeScenario(
    {
      intake: { ...DEFAULT_INTAKE },
      lender: { ...DEFAULT_LENDER },
      investor: { ...DEFAULT_INVESTOR },
      commercial: { ...DEFAULT_COMMERCIAL },
    },
    "2026-01-01T00:00:00.000Z",
  );
  const lender = buildPromptMessage("lender", facts, "lender")[0].content;
  assert.ok(lender.includes("lesserOfValue"), "lender prompt must include lender metrics");

  const investor = buildPromptMessage("investor", facts, "investor")[0].content;
  assert.ok(investor.includes("irrAnnual"), "investor prompt must include investor metrics");
});
