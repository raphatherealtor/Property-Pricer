/**
 * Legacy SSE message endpoint — `POST /api/mcp/messages?sessionId=…`.
 *
 * Answers the JSON-RPC request inline as JSON. See `sse.ts` for why the response
 * is not pushed over the stream. Identical dispatch to `POST /api/mcp`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleMcpHttpRequest, mcpCorsPreflightResponse } from "@/lib/mcp/http";

export const Route = createFileRoute("/api/mcp/messages")({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpHttpRequest(request),
      OPTIONS: () => mcpCorsPreflightResponse(),
    },
  },
});
