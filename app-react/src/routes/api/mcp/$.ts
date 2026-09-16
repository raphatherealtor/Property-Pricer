/**
 * REST bridge for non-MCP clients — `/api/mcp/{tools,resources,prompts}/*`.
 *
 * A single splat route maps the six documented bridge endpoints onto the same
 * JSON-RPC dispatcher used by the MCP transports, so the bridge can never expose a
 * different set of tools than MCP does. See `src/lib/mcp/http.ts` for the shape
 * transform.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRestBridge, mcpCorsPreflightResponse } from "@/lib/mcp/http";

export const Route = createFileRoute("/api/mcp/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRestBridge(request, new URL(request.url).pathname),
      POST: ({ request }) => handleMcpRestBridge(request, new URL(request.url).pathname),
      OPTIONS: () => mcpCorsPreflightResponse(),
    },
  },
});
