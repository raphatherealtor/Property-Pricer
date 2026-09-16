/**
 * MCP protected-resource metadata — `GET /.well-known/oauth-protected-resource`
 * (RFC 9728). Declares `/api/mcp` as the protected resource and this app as its
 * authorization server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { MCP_CORS_HEADERS, mcpCorsPreflightResponse } from "@/lib/mcp/http";
import { buildProtectedResourceMetadata, oauthIssuer } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(JSON.stringify(buildProtectedResourceMetadata(oauthIssuer(request)), null, 2), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...MCP_CORS_HEADERS },
        }),
      OPTIONS: () => mcpCorsPreflightResponse(),
    },
  },
});
