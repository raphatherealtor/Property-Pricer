/** OAuth 2.1 dynamic client registration for public PKCE MCP clients. */
import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthRegister } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      POST: ({ request }) => handleOAuthRegister(request),
    },
  },
});
