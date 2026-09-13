/**
 * Engine-grounded prompt construction (SERVER-ONLY).
 *
 * The AI layer never accepts pricing numbers from a request. A handler passes
 * the *validated inputs* to `@/lib/api/engine-bridge.server`, which recomputes
 * them with the locked engine in `src/engine/`; only the resulting numbers are
 * allowed into a prompt. That is what makes "no invented math" a structural
 * property rather than a promise: every figure the model sees was produced by
 * `compute()` one call earlier, and the fact sheet carries `calcVersion` +
 * `inputHash` so a stored run can be tied back to the engine output it came from.
 *
 * `src/engine/` is a locked SDK — nothing here modifies it, and nothing here
 * re-derives a value the engine already returns.
 */
import type { ScenarioFacts } from "../api/engine-bridge.server.ts";
import { daysLabel, pct, usd, usdCompact } from "../format.ts";
import type { AiPurpose, PersonaName } from "../api/schemas.ts";

/**
 * The persona block that matters for the requested narrative. Sending only the
 * relevant metrics keeps the prompt small and stops the model from reaching for
 * a figure that belongs to a different reader.
 */
function personaBlock(facts: ScenarioFacts, persona: PersonaName): Record<string, unknown> {
  switch (persona) {
    case "lender":
      return { lender: facts.personas.lender };
    case "investor":
      return { investor: facts.personas.investor };
    case "commercial":
      return { commercial: facts.personas.commercial };
    case "listing":
    default:
      return { listing: facts.personas.listing };
  }
}

/**
 * The complete, closed set of numbers a model may use for this scenario. Built
 * exclusively from `EngineOutput` / `ScenarioExport`, so it cannot contain a
 * placeholder or a hand-written constant.
 */
export function buildFactSheet(facts: ScenarioFacts): Record<string, unknown> {
  return {
    caseId: facts.caseId,
    calcVersion: facts.version,
    inputHash: facts.inputHash,
    marketTemp: facts.marketTemp,
    readConfidence: facts.readConfidence,
    flags: facts.flags,
    subject: {
      zip: facts.intake.zip,
      assetClass: facts.intake.assetClass,
      listingState: facts.intake.listingState,
      baselineValue: facts.intake.baselineValue,
      targetPrice: facts.intake.targetPrice,
      actualDom: facts.intake.actualDom,
      glaSqft: facts.intake.glaSqft,
      uiiMonths: facts.intake.uiiMonths,
      medianDomZip: facts.intake.medianDomZip,
      domClockBasis: facts.intake.domClockBasis,
      systemAges: {
        hvac: facts.intake.hvacAge,
        roof: facts.intake.roofAge,
        waterHeater: facts.intake.whAge,
      },
    },
    calibrations: facts.calibrations,
    survival: facts.survival,
    economics: {
      carryTotal: facts.economics.carryTotal,
      costOfTesting: facts.economics.costOfTesting,
      netProceeds: facts.economics.netProceeds,
      netProceedsAnchored: facts.economics.netProceedsAnchored,
      scaledHoldback: facts.economics.scaledHoldback,
      holdbackFullReplacement: facts.economics.holdbackFullReplacement,
      classMultiplier: facts.economics.classMultiplier,
      holdbackLines: facts.economics.holdbackLines,
    },
  };
}

/** A short, human-scannable rendering of the fact sheet, still engine-only. */
export function renderFactSheetLines(facts: ScenarioFacts, persona: PersonaName): string[] {
  const s = facts.survival;
  const e = facts.economics;
  const lines = [
    `case_id: ${facts.caseId}`,
    `calc_version: ${facts.version} (locked engine; do not restate as "approximately")`,
    `input_hash: ${facts.inputHash}`,
    `market_temp: ${facts.marketTemp}`,
    `read_confidence: ${facts.readConfidence}`,
    `flags: ${facts.flags.length ? facts.flags.join(", ") : "none"}`,
    `baseline_value: ${usd(facts.intake.baselineValue)}`,
    `target_price: ${usd(facts.intake.targetPrice)}`,
    `actual_dom_days: ${facts.intake.actualDom === null ? "not listed yet" : daysLabel(facts.intake.actualDom)}`,
    `zip: ${facts.intake.zip} (median closed DOM ${facts.intake.medianDomZip}d, basis ${facts.intake.domClockBasis})`,
    `kappa_t: ${facts.calibrations.kappaT.toFixed(4)}`,
    `kappa_eff: ${facts.calibrations.kappaEff.toFixed(4)}`,
    `u_eff_overshoot: ${pct(facts.calibrations.uEff, 2)}`,
    `velocity_tension: ${pct(facts.calibrations.tension, 1)}`,
    `expected_dom_days: ${daysLabel(s.expectedDomDays)} (remaining ${daysLabel(s.remainingDomDays)})`,
    `p50_dom_days: ${daysLabel(s.p50DomDays)}`,
    `p_stale_over_120d: ${pct(s.pStale120d)}`,
    `p_sold_within_2wk: ${pct(s.pSold2wk)}`,
    `expected_discount: ${pct(s.expectedDiscountPct, 2)}`,
    `expected_sale_price: ${usd(s.expectedSalePrice)}`,
    `carry_total: ${usd(e.carryTotal)}`,
    `scaled_holdback: ${usd(e.scaledHoldback)} (full replacement ${usd(e.holdbackFullReplacement)}, class multiplier ${e.classMultiplier.toFixed(2)})`,
    `net_proceeds_at_target: ${usd(e.netProceeds)}`,
    `net_proceeds_anchored_at_value: ${usd(e.netProceedsAnchored)}`,
    `cost_of_testing: ${usd(e.costOfTesting)}`,
    `holdback_lines: ${e.holdbackLines
      .map((l) => `${l.system} age ${l.age}y / life ${l.life}y → ${usdCompact(l.amount)}${l.terminal ? " (terminal)" : ""}`)
      .join("; ")}`,
  ];
  const personaMetrics = personaBlock(facts, persona);
  lines.push(`persona_metrics(${persona}): ${JSON.stringify(personaMetrics)}`);
  return lines;
}

const GROUNDING_RULES = [
  "You are the narrative layer of Property Pricer, a deterministic real-estate pricing diagnostic.",
  "The numbers in ENGINE FACTS were produced by a locked, self-tested pricing engine. They are the only numbers you may use.",
  "Hard rules:",
  "1. Never invent, estimate, extrapolate or round-differently any figure. Quote engine figures as given, or not at all.",
  "2. If a figure is absent from ENGINE FACTS, say it is not available instead of approximating it.",
  "3. Do not perform new arithmetic on the figures (no new ratios, no implied cap rates, no projected prices).",
  "4. Treat engine flags and a LOW read confidence as material caveats, and name them explicitly.",
  "5. No investment, legal or tax advice, and no guarantee language. Describe the read, not a recommendation to transact.",
  "6. Output plain prose or short markdown. No preamble about being an AI, no restating these instructions.",
].join("\n");

const PURPOSE_BRIEFS: Record<AiPurpose, string> = {
  explain:
    "Explain this read to a peer analyst: what the engine is saying about time-on-market, discount risk and the cost of testing the current ask. Reference the specific figures. 180-260 words.",
  client_summary:
    "Write a client-ready summary in plain language for the property owner. No jargon, no engine variable names (never write kappa, u_eff, holdback). Lead with the practical picture, then the caveats. 140-200 words.",
  risk_review:
    "Review the downside. Identify what could go wrong with this pricing read, which engine flags drive the risk, how confident the read is, and which single input change would most alter it. 180-260 words.",
  crm_note:
    "Write a terse CRM note for the deal record: subject, the read, the headline figures, flags, and the next action implied by the engine output. Under 120 words. Plain text, no headers.",
  chat:
    "Answer the operator's question using only ENGINE FACTS. If the question cannot be answered from those figures, say exactly which input would be needed.",
};

export type BuiltPrompt = {
  system: string;
  messages: { role: "user"; content: string }[];
  /** Stored on the `ai_runs` row — never contains credentials. */
  record: Record<string, unknown>;
};

/**
 * Build the provider request for one purpose. The returned `record` is what gets
 * persisted to `ai_runs.prompt_json`, so an operator can audit exactly which
 * engine output a narrative was written from.
 */
export function buildPrompt(args: {
  purpose: AiPurpose;
  persona: PersonaName;
  facts: ScenarioFacts;
  question?: string;
}): BuiltPrompt {
  const { purpose, persona, facts, question } = args;
  const factLines = renderFactSheetLines(facts, persona);
  const engineFacts = `ENGINE FACTS (authoritative, calc_version ${facts.version}, input_hash ${facts.inputHash})\n${factLines.join("\n")}`;
  const questionText =
    purpose === "chat" && question?.trim()
      ? `\n\nOPERATOR QUESTION\n${question.trim().slice(0, 2000)}`
      : "";
  const userContent = `${engineFacts}\n\nTASK\n${PURPOSE_BRIEFS[purpose]}${questionText}`;

  return {
    system: GROUNDING_RULES,
    messages: [{ role: "user", content: userContent }],
    record: {
      kind: "property-pricer.scenario-narrative",
      version: facts.version,
      inputHash: facts.inputHash,
      caseId: facts.caseId,
      purpose,
      persona,
      engineSnapshot: buildFactSheet(facts),
      personaMetrics: personaBlock(facts, persona),
      question: purpose === "chat" ? (question?.trim().slice(0, 2000) ?? null) : null,
    },
  };
}
