/**
 * OAuth 2.1 token endpoint — `POST /oauth/token` (authorization_code + PKCE,
 * and refresh_token rotation).
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthToken } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: ({ request }) => handleOAuthToken(request),
    },
  },
});
