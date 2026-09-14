/**
 * OAuth token revocation — `POST /oauth/revoke` (RFC 7009).
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthRevoke } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/oauth/revoke")({
  server: {
    handlers: {
      POST: ({ request }) => handleOAuthRevoke(request),
    },
  },
});
