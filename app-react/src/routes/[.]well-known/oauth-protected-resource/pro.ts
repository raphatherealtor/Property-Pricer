/** MCP protected-resource metadata for the ChatGPT Pro read-only endpoint. */
import { createFileRoute } from "@tanstack/react-router";
import { MCP_CORS_HEADERS, mcpCorsPreflightResponse } from "@/lib/mcp/http";
import { buildProtectedResourceMetadata, oauthIssuer } from "@/lib/mcp/oauth.server";

const PRO_SCOPES = ["mcp:tools", "mcp:resources", "mcp:prompts"] as const;

export const Route = createFileRoute("/.well-known/oauth-protected-resource/pro")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(
          JSON.stringify(buildProtectedResourceMetadata(oauthIssuer(request), "/api/mcp/pro", PRO_SCOPES), null, 2),
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...MCP_CORS_HEADERS },
          },
        ),
      OPTIONS: () => mcpCorsPreflightResponse(),
    },
  },
});
