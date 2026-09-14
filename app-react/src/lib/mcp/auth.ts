/**
 * MCP bearer auth (SERVER-ONLY).
 *
 * Three credential models, resolved in this order:
 *
 *  1. **No token.** Allowed only when `MCP_REQUIRE_AUTH` is `"false"` — an
 *     anonymous caller that may read public resources but may not touch a
 *     workspace.
 *  2. **Global gateway token.** The value of `PROPERTY_PRICER_MCP_TOKEN`. This
 *     token owns one deterministic workspace (derived from the token itself), so
 *     a single-tenant self-hosted deploy gets one isolated tenant with zero
 *     per-client setup.
 *  3. **Per-client token.** A row in `mcp_clients` whose `token_hash` matches. The
 *     client is explicitly scoped to one workspace and carries a `client_type`
 *     for attribution.
 *
 * The token itself is never logged or returned; only its SHA-256 appears (as the
 * `mcp_clients.token_hash` key). Rejecting an unauthenticated call happens *before*
 * any tool runs, per the spec.
 */
import { createHash } from "node:crypto";
import { assertApiServerOnly } from "../api/server-only.ts";
import { env } from "../env.server.ts";
import type { WorkspaceContext } from "../api/store.server.ts";
import { McpError, MCP_UNAUTHORIZED, unauthorized } from "./errors.ts";
import type { McpContext } from "./context.ts";

assertApiServerOnly("mcp/auth");

/** True unless the operator explicitly opts out with `MCP_REQUIRE_AUTH=false`. */
export function mcpRequireAuth(): boolean {
  return env("MCP_REQUIRE_AUTH") !== "false";
}

/** The global gateway token, or null when unset. */
export function mcpGlobalToken(): string | null {
  return env("PROPERTY_PRICER_MCP_TOKEN") ?? null;
}

/** The public base URL operators advertise to LLM clients. */
export function mcpPublicBaseUrl(): string {
  return env("MCP_PUBLIC_BASE_URL") ?? "";
}

/** SHA-256 hex of a token — the only form of it this app stores or compares. */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function bearerToken(headers: Headers): string | null {
  const value = headers.get("authorization")?.trim();
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Resolve the caller from a request's headers.
 *
 * Throws `McpError(MCP_UNAUTHORIZED)` with HTTP 401 when a token is required but
 * missing or unknown. Everything else is a plain context, even when anonymous.
 */
export async function resolveMcpContext(headers: Headers): Promise<McpContext> {
  const { findMcpClientByTokenHash, workspaceFor, workspaceContextById } = await import(
    "../api/store.server.ts"
  );

  const requireAuth = mcpRequireAuth();
  const globalToken = mcpGlobalToken();
  const token = bearerToken(headers);

  if (!token) {
    if (requireAuth) throw unauthorized();
    return {
      token: null,
      mode: "anonymous",
      clientId: null,
      clientName: null,
      clientType: null,
      clientVersion: null,
      workspaceId: null,
      getWorkspace: async () => null,
    };
  }

  if (globalToken && token === globalToken) {
    // One deterministic workspace per global token: multi-tenant-safe without any
    // per-client provisioning, and it never leaks the token into app tables.
    const tokenHash = hashMcpToken(token);
    let memo: Promise<WorkspaceContext> | null = null;
    return {
      token,
      mode: "global",
      clientId: null,
      clientName: "mcp-gateway",
      clientType: "other",
      clientVersion: null,
      workspaceId: null,
      getWorkspace: async () => {
        memo ??= workspaceFor({
          userId: `mcp:${tokenHash}`,
          userEmail: null,
          userDisplayName: "MCP Gateway",
        });
        return memo;
      },
    };
  }

  const tokenHash = hashMcpToken(token);
  let client = null as Awaited<ReturnType<typeof findMcpClientByTokenHash>>;
  try {
    client = await findMcpClientByTokenHash(tokenHash);
  } catch {
    // Fail closed: if the client registry cannot be read, an unknown token must
    // not be trusted (and this keeps the lookup testable without a database).
    throw unauthorized("MCP client registry unavailable; token rejected.");
  }
  if (!client) {
    throw new McpError(
      MCP_UNAUTHORIZED,
      "Invalid MCP token. Set PROPERTY_PRICER_MCP_TOKEN, or register this token in " +
        "the workspace (mcp_clients).",
      undefined,
      401,
    );
  }

  let memo: Promise<WorkspaceContext | null> | null = null;
  return {
    token,
    mode: "client",
    clientId: client.id,
    clientName: client.name,
    clientType: client.client_type,
    clientVersion: null,
    workspaceId: client.workspace_id,
    getWorkspace: async () => {
      memo ??= workspaceContextById(client.workspace_id);
      return memo;
    },
  };
}
