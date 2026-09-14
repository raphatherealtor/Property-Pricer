/**
 * OAuth scope model + enforcement helpers (SERVER-ONLY).
 *
 * The MCP endpoint is a protected resource: an OAuth-issued access token carries
 * a `scopes` claim, and the dispatcher checks it before a tool, resource or
 * prompt runs. Non-OAuth credentials (the global gateway token, a static
 * per-client token, or anonymous-with-auth-off) carry `scopes: null` and keep
 * full access — so existing single-token deployments never change behaviour.
 *
 * Scopes are coarse by design, one per privilege surface, and line up with the
 * existing rate-limit tiers so a client is rate-limited and scope-limited by the
 * same category.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import type { McpContext } from "./context.ts";
import type { McpLimitTier } from "./limits.ts";
import { MCP_OAUTH_SCOPES, type McpScope } from "./schemas.ts";

assertApiServerOnly("mcp/scopes");

export const MCP_SCOPES: readonly McpScope[] = MCP_OAUTH_SCOPES;

export const TOOLS_LIST_SCOPE: McpScope = "mcp:tools";
export const RESOURCES_SCOPE: McpScope = "mcp:resources";
export const PROMPTS_SCOPE: McpScope = "mcp:prompts";

/** Scopes required to call a tool in a given rate-limit tier. */
export function toolRequiredScopes(tier: McpLimitTier): McpScope[] {
  if (tier === "ai") return ["mcp:tools", "mcp:ai"];
  if (tier === "crm") return ["mcp:tools", "mcp:crm"];
  return ["mcp:tools"];
}

/** True when the caller is authorized for every required scope. */
export function hasScopes(ctx: McpContext, required: readonly McpScope[]): boolean {
  const scopes = ctx.scopes;
  if (scopes === null) return true;
  return required.every((s) => scopes.includes(s));
}

/** The required scopes the caller is missing (empty = authorized). */
export function missingScopes(ctx: McpContext, required: readonly McpScope[]): McpScope[] {
  const scopes = ctx.scopes;
  if (scopes === null) return [];
  return required.filter((s) => !scopes.includes(s));
}

export function isSupportedScope(value: string): value is McpScope {
  return (MCP_OAUTH_SCOPES as readonly string[]).includes(value);
}

/** Parse an OAuth `scope` parameter (space or comma separated) into unique scopes. */
export function parseScopeParam(value: string | null | undefined): McpScope[] {
  if (!value) return [];
  const out: McpScope[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const s = part.trim();
    if (s && isSupportedScope(s) && !out.includes(s)) out.push(s);
  }
  return out;
}
