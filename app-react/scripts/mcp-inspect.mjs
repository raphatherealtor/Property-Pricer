#!/usr/bin/env node
/**
 * MCP inspector — print what the server exposes, so an operator can sanity-check
 * the registry without running an HTTP server.
 *
 *   node scripts/mcp-inspect.mjs [--tools|--resources|--prompts|--json]
 *
 * Uses the TypeScript strip-types loader so it can import the registry directly.
 */
import { argv } from "node:process";
const { listMcpTools, listMcpResources, listMcpPrompts, MCP_PROTOCOL_VERSION } = await import(
  "../src/lib/mcp/server.ts"
);

const flag = argv[2] ?? "--all";

const output = {
  server: "property-pricer",
  protocolVersion: MCP_PROTOCOL_VERSION,
  tools: listMcpTools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  resources: listMcpResources(),
  resourceTemplates: (await import("../src/lib/mcp/resources.ts")).resourceTemplates,
  prompts: listMcpPrompts(),
};

if (flag === "--json") {
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

console.log(`Property Pricer MCP — protocol ${output.protocolVersion}`);
console.log(`\n${output.tools.length} tools:`);
for (const t of output.tools) console.log(`  ${t.name} — ${t.description}`);
console.log(`\n${output.resources.length} resources (+${output.resourceTemplates.length} templates):`);
for (const r of output.resources) console.log(`  ${r.uri} — ${r.name}`);
for (const t of output.resourceTemplates) console.log(`  ${t.uriTemplate} — ${t.name}`);
console.log(`\n${output.prompts.length} prompts:`);
for (const p of output.prompts) console.log(`  ${p.name} — ${p.description}`);
