/**
 * MCP HTTP transport (SERVER-ONLY).
 *
 * Both the Streamable HTTP endpoint and the REST bridge go through the same JSON-RPC
 * dispatcher, so the bridge is literally the MCP tools over a non-MCP shape — no
 * second implementation to drift. This module owns body reading (with the payload
 * cap), response shaping, and the small transform from JSON-RPC results to the
 * REST bridge's documented shape.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import { handleMcpRequest, MAX_MCP_PAYLOAD_BYTES, NO_RESPONSE, type McpProfile } from "./server.ts";
import { McpError, JSONRPC_PARSE_ERROR, jsonRpcError } from "./errors.ts";

assertApiServerOnly("mcp/http");

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** RFC 9728 discovery hint sent with every MCP authentication failure. */
function oauthChallenge(request: Request, resourceMetadataPath: string): Record<string, string> {
  const origin = new URL(request.url).origin;
  const metadata = `${origin}${resourceMetadataPath}`;
  return { "www-authenticate": `Bearer resource_metadata="${metadata}"` };
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_MCP_PAYLOAD_BYTES) {
    throw new McpError(-32003, "MCP payload exceeds the size limit.", undefined, 413);
  }
  const text = await request.text();
  if (text.length > MAX_MCP_PAYLOAD_BYTES) {
    throw new McpError(-32003, "MCP payload exceeds the size limit.", undefined, 413);
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new McpError(JSONRPC_PARSE_ERROR, "Parse error: body is not valid JSON", undefined, 400);
  }
}

/** Streamable HTTP: POST /api/mcp — plain JSON (stateless) responses. */
export async function handleMcpHttpRequest(
  request: Request,
  options: { profile?: McpProfile; resourceMetadataPath?: string } = {},
): Promise<Response> {
  const profile = options.profile ?? "full";
  const resourceMetadataPath = options.resourceMetadataPath ?? "/.well-known/oauth-protected-resource";
  try {
    const body = await readBody(request);
    const result = await handleMcpRequest(request.headers, body, profile);
    if (result === NO_RESPONSE) {
      return new Response(null, { status: 202 });
    }
    return jsonResponse(result);
  } catch (err) {
    if (err instanceof McpError) {
      if (err.httpStatus > 200) {
        // Transport-level fault (401/413/429): no JSON-RPC envelope, just status.
        return jsonResponse(
          { ok: false, error: err.message },
          err.httpStatus,
          err.httpStatus === 401 ? oauthChallenge(request, resourceMetadataPath) : {},
        );
      }
      return jsonResponse(jsonRpcError(null, err));
    }
    return jsonResponse(jsonRpcError(null, new McpError(-32603, "Internal error")), 500);
  }
}

/** The bridge's documented shape for a successful tools/call. */
function bridgeResult(result: unknown): unknown {
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.error) return { ok: false, error: r.error };
  if (r.isError === true) {
    const text = Array.isArray(r.content)
      ? (r.content as { text?: string }[]).map((c) => c.text ?? "").join("\n")
      : "";
    return { ok: false, error: text || "tool failed" };
  }
  if (Array.isArray(r.content)) {
    const first = (r.content as { type?: string; text?: string }[])[0];
    if (first && first.type === "text" && typeof first.text === "string") {
      let json: unknown;
      try {
        json = JSON.parse(first.text);
      } catch {
        json = first.text;
      }
      return { ok: true, content: [{ type: "json", json }] };
    }
  }
  return { ok: true, content: [{ type: "json", json: r.structuredContent ?? null }] };
}

/**
 * REST bridge for clients without native MCP. Each path maps to one JSON-RPC
 * method; the result is reshaped into the documented bridge contract.
 */
export async function handleMcpRestBridge(request: Request, pathname: string): Promise<Response> {
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathname.replace(/\/+$/, "") || "/";

  const rpcMethods: Record<string, { method: string; transform?: (r: unknown) => unknown }> = {
    "POST /api/mcp/tools/list": { method: "tools/list" },
    "POST /api/mcp/tools/call": { method: "tools/call", transform: bridgeResult },
    "GET /api/mcp/resources/list": { method: "resources/list" },
    "POST /api/mcp/resources/read": { method: "resources/read" },
    "GET /api/mcp/prompts/list": { method: "prompts/list" },
    "POST /api/mcp/prompts/get": { method: "prompts/get" },
  };

  const route = rpcMethods[`${method} ${path}`];
  if (!route) {
    return jsonResponse({ ok: false, error: `unknown bridge route: ${method} ${path}` }, 404);
  }

  try {
    const body = await readBody(request);
    const rpcRequest: Record<string, unknown> = { jsonrpc: "2.0", id: 1, method: route.method };
    if (body && typeof body === "object") {
      if (route.method === "tools/call") {
        rpcRequest.params = {
          name: (body as { name?: unknown }).name,
          arguments: (body as { arguments?: unknown }).arguments ?? {},
        };
      } else if (route.method === "resources/read") {
        rpcRequest.params = { uri: (body as { uri?: unknown }).uri };
      } else if (route.method === "prompts/get") {
        rpcRequest.params = {
          name: (body as { name?: unknown }).name,
          arguments: (body as { arguments?: unknown }).arguments ?? {},
        };
      }
    }

    const result = await handleMcpRequest(request.headers, rpcRequest);
    if (result === NO_RESPONSE) return new Response(null, { status: 202 });

    // The dispatcher answers with a JSON-RPC envelope `{ jsonrpc, id, result }`.
    // The bridge exposes the documented shape directly — the `result`, not the
    // envelope — with protocol errors turned into `{ ok: false, error }`.
    const envelope = (result ?? {}) as Record<string, unknown>;
    if (envelope.error) {
      return jsonResponse({ ok: false, error: envelope.error }, 400);
    }
    const payload = envelope.result;
    if (route.transform) return jsonResponse(route.transform(payload));
    // list/read/get endpoints already have the documented shape ({ tools },
    // { resources }, { contents }, { prompts }, { description, messages }).
    return jsonResponse(payload);
  } catch (err) {
    if (err instanceof McpError) {
      return jsonResponse({ ok: false, error: err.message }, err.httpStatus > 200 ? err.httpStatus : 400);
    }
    return jsonResponse({ ok: false, error: "internal error" }, 500);
  }
}
