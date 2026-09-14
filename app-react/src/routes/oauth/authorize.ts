/**
 * OAuth 2.1 authorization endpoint — `GET /oauth/authorize` renders the consent
 * page; `POST /oauth/authorize` processes the Approve/Deny decision and redirects
 * back with the authorization code (or `access_denied`).
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthAuthorizeGet, handleOAuthAuthorizePost } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/oauth/authorize")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthAuthorizeGet(request),
      POST: ({ request }) => handleOAuthAuthorizePost(request),
    },
  },
});
