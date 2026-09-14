/**
 * MCP error model (SERVER-ONLY).
 *
 * MCP rides JSON-RPC 2.0. Protocol faults — a malformed envelope, an unknown
 * method, bad params, a missing bearer token — surface as JSON-RPC error objects.
 * A *tool* that ran and failed surfaces as a normal `tools/call` result with
 * `isError: true` and the message in its content, so the LLM reads the reason
 * rather than a transport-level fault. The two paths share this error type.
 */
import { assertApiServerOnly } from "../api/server-only.ts";

assertApiServerOnly("mcp/errors");

/* JSON-RPC standard codes. */
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/* Application codes (server-defined range). */
export const MCP_UNAUTHORIZED = -32001;
export const MCP_RATE_LIMITED = -32002;
export const MCP_PAYLOAD_TOO_LARGE = -32003;
export const MCP_NOT_FOUND = -32004;

export class McpError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly httpStatus: number;

  constructor(code: number, message: string, data?: unknown, httpStatus = 200) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
    this.httpStatus = httpStatus;
  }
}

export function invalidParams(message: string): McpError {
  return new McpError(JSONRPC_INVALID_PARAMS, message);
}

export function methodNotFound(method: string): McpError {
  return new McpError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
}

export function unauthorized(message = "Unauthorized"): McpError {
  return new McpError(MCP_UNAUTHORIZED, message, undefined, 401);
}

export function rateLimited(message = "Rate limit exceeded"): McpError {
  return new McpError(MCP_RATE_LIMITED, message, undefined, 429);
}

export function notFound(message: string): McpError {
  return new McpError(MCP_NOT_FOUND, message);
}

/** Build a JSON-RPC 2.0 error response body for a request id. */
export function jsonRpcError(id: unknown, error: McpError): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    },
  };
}

/** Build a JSON-RPC 2.0 success response body for a request id. */
export function jsonRpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
