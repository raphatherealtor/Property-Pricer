/**
 * OAuth token revocation — `POST /oauth/revoke` (RFC 7009).
 */
import { createFileRoute } from "@tanstack/react-router";
import { mcpCorsPreflightResponse, withMcpCors } from "@/lib/mcp/http";
import { handleOAuthRevoke } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/oauth/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => withMcpCors(await handleOAuthRevoke(request)),
      OPTIONS: () => mcpCorsPreflightResponse(),
    },
  },
});
