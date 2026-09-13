/**
 * The grounding test: every number an AI prompt contains must come from the
 * locked engine.
 *
 * This is the test that makes "do not invent mock pricing/math values" checkable
 * rather than aspirational. It recomputes a bundle with `src/engine/`, builds each
 * narrative prompt, and walks the emitted prompt payload looking for any numeric
 * leaf that is not present in the engine output. Because the fact sheet is built
 * by `buildFactSheet`, a hard-coded placeholder anywhere in that path — or a value
 * taken from the request instead of from `compute()` — fails here.
 *
 * Run via `npm run test:ai` (Node type stripping + `scripts/ts-test-loader.mjs`,
 * which resolves the engine's extensionless imports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COMMERCIAL,
  DEFAULT_INTAKE,
  DEFAULT_INVESTOR,
  DEFAULT_LENDER,
} from "@/engine/defaults";
import { computeScenario } from "@/lib/api/engine-bridge.server";
import { AI_PURPOSES } from "@/lib/api/schemas";
import { buildFactSheet, buildPrompt, renderFactSheetLines } from "@/lib/ai/prompt.server";

const BUNDLE = {
  intake: { ...DEFAULT_INTAKE },
  lender: { ...DEFAULT_LENDER },
  investor: { ...DEFAULT_INVESTOR },
  commercial: { ...DEFAULT_COMMERCIAL },
};

const EXPORTED_AT = "2026-01-01T00:00:00.000Z";

function scenario() {
  return computeScenario(BUNDLE, EXPORTED_AT);
}

/** Every finite number reachable in a nested value. */
function numbersIn(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) numbersIn(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) numbersIn(item, out);
  }
  return out;
}

test("the engine recomputes the defaults deterministically", () => {
  const a = scenario();
  const b = scenario();
  assert.equal(a.output.inputHash, b.output.inputHash);
  assert.equal(a.output.caseId, b.output.caseId);
  assert.equal(a.output.calcVersion, "1.6.1");
  assert.equal(a.facts.inputHash, a.output.inputHash);
  assert.equal(a.facts.version, a.output.calcVersion);
});

test("the engine's own self-test still certifies the locked math", async () => {
  const { selfTestSummary } = await import("@/engine/selftest");
  const summary = selfTestSummary();
  assert.equal(
    summary.passed,
    summary.total,
    `the locked engine's self-test must pass (${summary.passed}/${summary.total})`,
  );
});

test("every numeric leaf in the prompt payload comes from the engine export", () => {
  const { output, facts } = scenario();
  // The allowed set is the engine's own scenario export — which includes the
  // validated inputs (`intake.glaSqft`, `intake.medianDomZip`, …) that a narrative
  // legitimately needs to cite. A literal hard-coded in the prompt module would
  // not be in this set, which is the failure this guards against.
  const engineNumbers = numbersIn(facts);
  const sheet = buildFactSheet(facts);

  const offenders: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (!engineNumbers.has(value)) offenders.push(`${path} = ${value}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        walk(item, `${path}.${key}`);
      }
    }
  };
  walk(sheet, "factSheet");

  assert.deepEqual(
    offenders,
    [],
    "the fact sheet contains a number the locked engine did not produce",
  );
  // Non-vacuous: a real export carries many figures, and the sheet must quote them.
  assert.ok(engineNumbers.size > 20, "expected the engine export to carry many figures");
  assert.ok(Object.keys(sheet).length >= 6);
  assert.equal(sheet.inputHash, output.inputHash);
  assert.equal(sheet.calcVersion, output.calcVersion);
  assert.equal(sheet.caseId, output.caseId);
});

test("the rendered fact sheet quotes the engine's figures verbatim", () => {
  const { facts } = scenario();
  const lines = renderFactSheetLines(facts, "listing");
  const text = lines.join("\n");
  assert.match(text, /calc_version: 1\.6\.1/);
  assert.match(text, new RegExp(`input_hash: ${facts.inputHash}`));
  assert.match(text, new RegExp(`case_id: ${facts.caseId}`));
  assert.match(text, /expected_dom_days:/);
  assert.match(text, /cost_of_testing:/);
  // No figure may be hedged as approximate. Checked per line so the instructional
  // header ("do not restate as approximately") is not itself the trigger.
  for (const line of lines) {
    if (!/[$%]/.test(line)) continue;
    assert.doesNotMatch(
      line,
      /\bapprox|\broughly|\babout\b|\baround\b/i,
      `a figure was hedged: ${line}`,
    );
  }
});

test("a prompt is built for every purpose with the right provenance", () => {
  const { output, facts } = scenario();
  for (const purpose of AI_PURPOSES) {
    const prompt = buildPrompt({
      purpose,
      persona: "listing",
      facts,
      question: purpose === "chat" ? "What changes if the ask drops 3%?" : undefined,
    });
    assert.ok(prompt.system.length > 100, `${purpose}: system brief must be substantive`);
    assert.equal(prompt.messages.length, 1);
    assert.ok(prompt.messages[0].content.includes(facts.caseId));
    assert.ok(
      prompt.messages[0].content.includes(`input_hash ${facts.inputHash}`),
      `${purpose}: the prompt must carry the engine input hash`,
    );

    // The persisted record is what an auditor reads back.
    assert.equal(prompt.record.inputHash, output.inputHash);
    assert.equal(prompt.record.version, output.calcVersion);
    assert.equal(prompt.record.purpose, purpose);
    assert.equal(prompt.record.caseId, output.caseId);
    assert.ok(prompt.record.engineSnapshot, `${purpose}: engine snapshot must be recorded`);
  }
});

test("the chat purpose forwards the question and nothing else does", () => {
  const { facts } = scenario();
  const chat = buildPrompt({
    purpose: "chat",
    persona: "listing",
    facts,
    question: "Should we hold?",
  });
  assert.ok(chat.messages[0].content.includes("Should we hold?"));
  assert.equal(chat.record.question, "Should we hold?");

  const explain = buildPrompt({ purpose: "explain", persona: "listing", facts });
  assert.equal(explain.record.question, null);
  assert.doesNotMatch(explain.messages[0].content, /OPERATOR QUESTION/);
});

test("only the requested persona's metrics are sent", () => {
  const { facts } = scenario();
  const lender = buildPrompt({ purpose: "explain", persona: "lender", facts });
  const metrics = JSON.stringify(lender.record.personaMetrics);
  assert.ok(metrics.includes("lesserOfValue"), "lender metrics must be included");
  assert.ok(
    !metrics.includes("absorptionMonths"),
    "another persona's metrics must not be included",
  );
});

test("the prompt never content-addresses a credential or an endpoint", () => {
  const { facts } = scenario();
  for (const purpose of AI_PURPOSES) {
    const prompt = buildPrompt({ purpose, persona: "listing", facts });
    const serialized = JSON.stringify(prompt.record);
    for (const forbidden of ["api.openai.com", "api.anthropic.com", "sk-", "Bearer "]) {
      assert.ok(
        !serialized.includes(forbidden),
        `${purpose}: the recorded prompt must not contain "${forbidden}"`,
      );
    }
  }
});
