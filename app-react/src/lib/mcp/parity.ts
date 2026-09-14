/**
 * UI-action ↔ MCP-tool parity contract (pure data, no server imports).
 *
 * Every action an operator can take in the desk / SaaS panels is reachable from
 * an MCP client through exactly one tool, and every tool maps back to a UI action
 * — so an LLM client is never a second-class citizen and never gains a capability
 * the UI does not have. `parity.test.ts` proves the mapping is a bijection against
 * the live tool registry, and each row's `scopes` are what the OAuth dispatcher
 * enforces for that action.
 */

export type UiActionParity = {
  /** The human-facing action in the desk / SaaS panels. */
  uiAction: string;
  /** The MCP tool that mirrors it. */
  tool: string;
  /** Scopes required to perform the action over OAuth. */
  scopes: string[];
  /** Which store/UI surface the action comes from. */
  note: string;
};

export const UI_ACTION_PARITY: UiActionParity[] = [
  {
    uiAction: "Edit scenario inputs (intake / lender / investor / commercial)",
    tool: "property_pricer.apply_input_patch",
    scopes: ["mcp:tools"],
    note: "patchIntake / patchLender / patchInvestor / patchCommercial / applyZip / applyPill",
  },
  {
    uiAction: "Validate a draft against the engine schema",
    tool: "property_pricer.validate_inputs",
    scopes: ["mcp:tools"],
    note: "coreIntakeSchema + extension schemas",
  },
  {
    uiAction: "Draft inputs from free text",
    tool: "property_pricer.suggest_inputs_from_text",
    scopes: ["mcp:tools"],
    note: "deterministic extraction — never invents figures",
  },
  {
    uiAction: "Price the deal",
    tool: "property_pricer.price_scenario",
    scopes: ["mcp:tools"],
    note: "compute() server-side; returns flags + E[DOM] + net proceeds",
  },
  {
    uiAction: "Explain the read",
    tool: "property_pricer.explain_math",
    scopes: ["mcp:tools"],
    note: "quotes engine figures verbatim, never changes them",
  },
  {
    uiAction: "Save scenario to the cloud",
    tool: "property_pricer.save_scenario",
    scopes: ["mcp:tools"],
    note: "recomputes rather than trusting a caller",
  },
  {
    uiAction: "Reopen a saved scenario",
    tool: "property_pricer.load_scenario",
    scopes: ["mcp:tools"],
    note: "loadScenario in the store",
  },
  {
    uiAction: "List saved scenarios",
    tool: "property_pricer.list_scenarios",
    scopes: ["mcp:tools"],
    note: "scenario library",
  },
  {
    uiAction: "Compare scenarios",
    tool: "property_pricer.compare_scenarios",
    scopes: ["mcp:tools"],
    note: "client / investment / lender / risk comparison modes",
  },
  {
    uiAction: "Generate client summary",
    tool: "property_pricer.generate_client_summary",
    scopes: ["mcp:tools", "mcp:ai"],
    note: "AI narrative (tier: ai)",
  },
  {
    uiAction: "Generate risk review",
    tool: "property_pricer.generate_risk_review",
    scopes: ["mcp:tools", "mcp:ai"],
    note: "AI narrative (tier: ai)",
  },
  {
    uiAction: "Push scenario to Figgy CRM",
    tool: "property_pricer.push_scenario_to_figgy",
    scopes: ["mcp:tools", "mcp:crm"],
    note: "Figgy connector (tier: crm)",
  },
  {
    uiAction: "Draft CRM follow-up",
    tool: "property_pricer.draft_crm_followup",
    scopes: ["mcp:tools"],
    note: "sms / email / call_script",
  },
  {
    uiAction: "Export (json / pdf / deck / crm_payload)",
    tool: "property_pricer.export_scenario",
    scopes: ["mcp:tools"],
    note: "EXPORT_TYPES",
  },
  {
    uiAction: "Discover capabilities",
    tool: "property_pricer.get_app_capabilities",
    scopes: ["mcp:tools"],
    note: "full tool/resource/prompt surface",
  },
];
