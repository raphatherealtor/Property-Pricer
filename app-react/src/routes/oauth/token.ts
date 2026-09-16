/**
 * OAuth 2.1 token endpoint — `POST /oauth/token` (authorization_code + PKCE,
 * and refresh_token rotation).
 */
import { createFileRoute } from "@tanstack/react-router";
import { mcpCorsPreflightResponse, withMcpCors } from "@/lib/mcp/http";
import { handleOAuthToken } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => withMcpCors(await handleOAuthToken(request)),
      OPTIONS: () => mcpCorsPreflightResponse(),
    },
  },
});
