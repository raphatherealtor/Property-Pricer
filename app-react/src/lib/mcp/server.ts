/**
 * MCP server (SERVER-ONLY).
 *
 * The canonical JSON-RPC 2.0 dispatcher. The Streamable HTTP transport
 * (`routes/api/mcp/index.ts`), the SSE pair and the REST bridge all call
 * `handleMcpRequest` with the same registry, so every transport shares auth,
 * rate limiting, audit, and the same tools/resources/prompts.
 *
 * Protocol version is pinned to the current MCP Streamable HTTP revision. Responses
 * are plain JSON (the stateless form of Streamable HTTP), which is what SDKs use
 * for single requests and which works on serverless platforms.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import { resolveMcpContext } from "./auth.ts";
import { mcpRateLimiter } from "./limits.ts";
import { auditMcpCall } from "./audit.ts";
import {
  jsonRpcError,
  jsonRpcResult,
  invalidParams,
  methodNotFound,
  McpError,
  MCP_PAYLOAD_TOO_LARGE,
  MCP_RATE_LIMITED,
  JSONRPC_INVALID_REQUEST,
  forbidden,
} from "./errors.ts";
import { jsonContent } from "./registry.ts";
import { tools } from "./tools.ts";
import { resources, resourceTemplates, readResource } from "./resources.ts";
import { prompts } from "./prompts.ts";
import { toJsonSchema, type McpScope } from "./schemas.ts";
import {
  PROMPTS_SCOPE,
  RESOURCES_SCOPE,
  TOOLS_LIST_SCOPE,
  missingScopes,
  toolRequiredScopes,
} from "./scopes.ts";

assertApiServerOnly("mcp/server");

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const SERVER_NAME = "property-pricer";
export const SERVER_TITLE = "Property Pricer";
export const SERVER_VERSION = "1.6.1";
export const MAX_MCP_PAYLOAD_BYTES = 256 * 1024;

/**
 * ChatGPT Pro is limited to read/fetch MCP use. This profile intentionally
 * excludes every persistent, AI-provider, CRM, and export-recording action.
 */
export type McpProfile = "full" | "read";

const READ_ONLY_TOOL_NAMES = new Set([
  "property_pricer.price_scenario",
  "property_pricer.validate_inputs",
  "property_pricer.suggest_inputs_from_text",
  "property_pricer.explain_math",
  "property_pricer.load_scenario",
  "property_pricer.list_scenarios",
  "property_pricer.compare_scenarios",
]);

function toolsForProfile(profile: McpProfile): typeof tools {
  return profile === "read" ? tools.filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name)) : tools;
}

/** Marker returned for JSON-RPC notifications, which get no response. */
export const NO_RESPONSE = Symbol("mcp.no-response");

export function listToolNames(profile: McpProfile = "full"): string[] {
  return toolsForProfile(profile).map((tool) => tool.name);
}

export function listResourceUris(): string[] {
  return resources.map((r) => r.uri);
}

export function listMcpTools(profile: McpProfile = "full"): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  return toolsForProfile(profile).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export function listMcpResources(): { uri: string; name: string; description: string; mimeType: string }[] {
  return resources.map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType }));
}

export function listMcpPrompts(): {
  name: string;
  description: string;
  arguments: Record<string, unknown>;
}[] {
  return prompts.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: toJsonSchema(p.argumentsSchema),
  }));
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

/** Human-readable reason when the caller's OAuth scopes deny an operation. */
function scopeDenial(
  ctx: Awaited<ReturnType<typeof resolveMcpContext>>,
  required: readonly McpScope[],
): string | null {
  const missing = missingScopes(ctx, required);
  return missing.length > 0 ? `Missing required scope(s): ${missing.join(", ")}` : null;
}

type RpcRequest = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
};

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

async function dispatchOne(
  ctx: Awaited<ReturnType<typeof resolveMcpContext>>,
  request: RpcRequest,
  profile: McpProfile,
) {
  const id = request.id;
  const method = request.method ?? "";
  const params = (request.params ?? {}) as Record<string, unknown>;
  const isNotification = method.startsWith("notifications/");

  const fail = async (error: McpError, status: "failed" | "rejected" = "failed") => {
    await auditMcpCall(ctx, { status, error: error.message, request });
    if (isNotification) return NO_RESPONSE;
    return jsonRpcError(id, error);
  };

  // Rate limit every accepted request against one bucket.
  try {
    mcpRateLimiter.consume(ctx.token ?? "anonymous", "general");
  } catch (err) {
    if (err instanceof McpError && err.code === MCP_RATE_LIMITED) {
      return fail(err, "rejected");
    }
    throw err;
  }

  switch (method) {
    case "initialize":
      await auditMcpCall(ctx, { status: "succeeded", request });
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
        serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
      });

    case "notifications/initialized":
    case "logging/setLevel":
      await auditMcpCall(ctx, { status: "succeeded", request });
      return NO_RESPONSE;

    case "ping":
      await auditMcpCall(ctx, { status: "succeeded", request });
      return jsonRpcResult(id, {});

    case "tools/list": {
      const denial = scopeDenial(ctx, [TOOLS_LIST_SCOPE]);
      if (denial) {
        await auditMcpCall(ctx, { status: "rejected", error: denial, request });
        return jsonRpcError(id, forbidden(denial));
      }
      await auditMcpCall(ctx, { status: "succeeded", request });
      return jsonRpcResult(id, { tools: listMcpTools(profile) });
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolsForProfile(profile).find((candidate) => candidate.name === name);
      if (!tool) {
        // isError content, so the LLM reads the reason rather than a transport fault.
        await auditMcpCall(ctx, { toolName: name, status: "failed", error: `Unknown tool: ${name}`, request });
        return jsonRpcResult(id, { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
      }
      // Tools/call answers with content, not a JSON-RPC error, so the LLM reads
      // the failure as a message. Rate limits, scopes and validation are enforced.
      const limited = (message: string) =>
        jsonRpcResult(id, { content: [{ type: "text", text: message }], isError: true });

      const denial = scopeDenial(ctx, toolRequiredScopes(tool.tier));
      if (denial) {
        await auditMcpCall(ctx, { toolName: name, status: "rejected", error: denial, request });
        return limited(denial);
      }

      try {
        mcpRateLimiter.consume(ctx.token ?? "anonymous", tool.tier);
      } catch (err) {
        if (err instanceof McpError && err.code === MCP_RATE_LIMITED) {
          await auditMcpCall(ctx, { toolName: name, status: "rejected", error: err.message, request });
          return limited(err.message);
        }
        throw err;
      }

      const parsed = tool.schema.safeParse(params.arguments ?? {});
      if (!parsed.success) {
        const message = `Invalid arguments for ${name}: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`;
        await auditMcpCall(ctx, { toolName: name, status: "rejected", error: message, request });
        return limited(message);
      }

      try {
        const result = await tool.run(parsed.data, ctx);
        await auditMcpCall(ctx, { toolName: name, status: "succeeded", request, response: result });
        return jsonRpcResult(id, jsonContent(result));
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool failed";
        await auditMcpCall(ctx, { toolName: name, status: "failed", error: message, request });
        if (err instanceof McpError && err.httpStatus > 200) {
          return jsonRpcError(id, err);
        }
        return limited(message);
      }
    }

    case "resources/list": {
      const denial = scopeDenial(ctx, [RESOURCES_SCOPE]);
      if (denial) {
        await auditMcpCall(ctx, { status: "rejected", error: denial, request });
        return jsonRpcError(id, forbidden(denial));
      }
      await auditMcpCall(ctx, { status: "succeeded", request });
      return jsonRpcResult(id, { resources: listMcpResources() });
    }

    case "resources/templates/list":
      await auditMcpCall(ctx, { status: "succeeded", request });
      return jsonRpcResult(id, { resourceTemplates });

    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      if (!uri) return fail(invalidParams("resources/read requires a uri"), "rejected");
      const denial = scopeDenial(ctx, [RESOURCES_SCOPE]);
      if (denial) {
        await auditMcpCall(ctx, { resourceUri: uri, status: "rejected", error: denial, request });
        return jsonRpcError(id, forbidden(denial));
      }
      try {
        const content = await readResource(uri, ctx);
        await auditMcpCall(ctx, { resourceUri: uri, status: "succeeded", request, response: content });
        return jsonRpcResult(id, { contents: [content] });
      } catch (err) {
        const message = err instanceof Error ? err.message : "resource read failed";
        await auditMcpCall(ctx, { resourceUri: uri, status: "failed", error: message, request });
        if (err instanceof McpError) return jsonRpcError(id, err);
        return jsonRpcError(id, new McpError(-32004, message));
      }
    }

    case "prompts/list": {
      const denial = scopeDenial(ctx, [PROMPTS_SCOPE]);
      if (denial) {
        await auditMcpCall(ctx, { status: "rejected", error: denial, request });
        return jsonRpcError(id, forbidden(denial));
      }
      await auditMcpCall(ctx, { status: "succeeded", request });
      return jsonRpcResult(id, { prompts: listMcpPrompts() });
    }

    case "prompts/get": {
      const name = typeof params.name === "string" ? params.name : "";
      const prompt = prompts.find((p) => p.name === name);
      if (!prompt) {
        return fail(new McpError(-32004, `Unknown prompt: ${name}`), "failed");
      }
      const denial = scopeDenial(ctx, [PROMPTS_SCOPE]);
      if (denial) {
        await auditMcpCall(ctx, { promptName: name, status: "rejected", error: denial, request });
        return jsonRpcError(id, forbidden(denial));
      }
      const parsed = prompt.argumentsSchema.safeParse(params.arguments ?? {});
      if (!parsed.success) {
        return fail(invalidParams(`Invalid prompt arguments: ${parsed.error.issues[0]?.message}`), "rejected");
      }
      try {
        const rendered = await prompt.get(parsed.data, ctx);
        await auditMcpCall(ctx, { promptName: name, status: "succeeded", request, response: rendered });
        return jsonRpcResult(id, {
          description: rendered.description,
          messages: rendered.messages.map((m) => ({
            role: m.role,
            content: { type: "text", text: m.content },
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "prompt render failed";
        await auditMcpCall(ctx, { promptName: name, status: "failed", error: message, request });
        if (err instanceof McpError) return jsonRpcError(id, err);
        return jsonRpcError(id, new McpError(-32004, message));
      }
    }

    default:
      return fail(methodNotFound(method), "failed");
  }
}

/**
 * Handle one HTTP MCP request end to end: auth, payload cap, dispatch, audit.
 * Returns a JSON-RPC response object, an array (batch), or `NO_RESPONSE`.
 */
export async function handleMcpRequest(
  headers: Headers,
  body: unknown,
  profile: McpProfile = "full",
): Promise<unknown> {
  if (body !== undefined && sizeOf(body) > MAX_MCP_PAYLOAD_BYTES) {
    throw new McpError(MCP_PAYLOAD_TOO_LARGE, "MCP payload exceeds the size limit.", undefined, 413);
  }

  const ctx = await resolveMcpContext(headers);

  if (Array.isArray(body)) {
    const responses: unknown[] = [];
    for (const request of body as RpcRequest[]) {
      const response = await dispatchOne(ctx, request, profile);
      if (response !== NO_RESPONSE) responses.push(response);
    }
    return responses;
  }

  if (!body || typeof body !== "object") {
    return jsonRpcError(null, new McpError(JSONRPC_INVALID_REQUEST, "Invalid JSON-RPC request"));
  }

  return dispatchOne(ctx, body as RpcRequest, profile);
}
