/**
 * MCP call audit (SERVER-ONLY).
 *
 * Every accepted or rejected MCP call is written to `mcp_calls`. Audit is
 * best-effort by design: a full audit table must never fail the call it records,
 * and a database hiccup must not take down a tool that just succeeded.
 *
 * Attribution is honest about its limits: per-client tokens carry a fixed
 * workspace id (stored on the client row); the global gateway token and anonymous
 * callers have no workspace unless the tool resolved one, in which case the caller
 * passes it in.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import type { WorkspaceContext } from "../api/store.server.ts";
import type { McpContext } from "./context.ts";

assertApiServerOnly("mcp/audit");

export type McpAuditEvent = {
  toolName?: string | null;
  resourceUri?: string | null;
  promptName?: string | null;
  request?: unknown;
  response?: unknown;
  status: "succeeded" | "failed" | "rejected";
  error?: string | null;
};

export async function auditMcpCall(
  ctx: McpContext,
  event: McpAuditEvent,
  workspace?: WorkspaceContext | null,
): Promise<void> {
  try {
    // Dynamic import: the store layer is only loaded when an audit row is actually
    // written, and a failed import (e.g. running under Node, where the platform's
    // `import.meta.glob` DB bootstrap is unavailable) degrades to a no-op rather
    // than breaking the call.
    const { recordMcpCall } = await import("../api/store.server.ts");
    await recordMcpCall({
      workspaceId: workspace?.workspaceId ?? ctx.workspaceId ?? null,
      clientId: ctx.clientId,
      userId: workspace?.userId ?? null,
      clientName: ctx.clientName,
      clientVersion: ctx.clientVersion,
      toolName: event.toolName ?? null,
      resourceUri: event.resourceUri ?? null,
      promptName: event.promptName ?? null,
      request: event.request ?? null,
      response: event.response ?? null,
      status: event.status,
      error: event.error ?? null,
    });
  } catch {
    /* audit is best-effort — never let logging break the call */
  }
}
