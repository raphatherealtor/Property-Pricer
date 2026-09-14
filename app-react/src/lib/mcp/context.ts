/**
 * Per-request MCP context (SERVER-ONLY).
 *
 * Everything a tool, resource or prompt handler is allowed to know about its
 * caller. Crucially this type exposes a **workspace resolver** rather than a
 * resolved workspace: anonymous callers (auth off) and the global bearer token
 * only materialize a workspace when the operation actually needs one, so a
 * `tools/list` or `resources/read` never creates rows as a side effect.
 */
import type { WorkspaceContext } from "../api/store.server.ts";
import { assertApiServerOnly } from "../api/server-only.ts";
import { McpError, MCP_NOT_FOUND } from "./errors.ts";

assertApiServerOnly("mcp/context");

export type McpAuthMode = "none" | "global" | "client" | "anonymous";

export type McpContext = {
  /** The presented bearer token, or null when auth is off. */
  token: string | null;
  mode: McpAuthMode;
  clientId: string | null;
  clientName: string | null;
  clientType: string | null;
  clientVersion: string | null;
  /** Fixed workspace id for per-client tokens; null otherwise. */
  workspaceId: string | null;
  /** Materialize the workspace for this caller, or null when anonymous. */
  getWorkspace: () => Promise<WorkspaceContext | null>;
};

/** The key rate limiting and audit attribution share. */
export function mcpRateLimitKey(ctx: McpContext): string {
  return ctx.token ?? "anonymous";
}

/**
 * Resolve a workspace, failing with a clear `MCP_NOT_FOUND`-family error when the
 * caller is anonymous and cannot reach one. Workspace-scoped tools call this.
 */
export async function requireMcpWorkspace(ctx: McpContext): Promise<WorkspaceContext> {
  const workspace = await ctx.getWorkspace();
  if (!workspace) {
    throw new McpError(
      MCP_NOT_FOUND,
      "This operation requires a workspace. Authenticate with a bearer token that " +
        "is scoped to a workspace (a per-client token), or set the MCP gateway token.",
    );
  }
  return workspace;
}
