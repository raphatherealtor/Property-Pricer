/**
 * OAuth authorization-server metadata — `GET /.well-known/oauth-authorization-server`
 * (RFC 8414). OAuth-based MCP clients (and AI connectors) discover the endpoints,
 * PKCE support and scopes from here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildAuthorizationServerMetadata, oauthIssuer } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(JSON.stringify(buildAuthorizationServerMetadata(oauthIssuer(request)), null, 2), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        }),
    },
  },
});
