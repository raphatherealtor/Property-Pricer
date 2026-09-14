/**
 * OpenAPI 3.1 document — `GET /api/openapi.json`.
 *
 * Public, read-only, machine-readable description of the MCP endpoint, the REST
 * bridge, and the client onboarding presets, with the OAuth2 (PKCE) + bearer
 * security schemes. Generated from the live tool/resource/prompt registry so it
 * cannot drift from what the server actually exposes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildOpenApiDocument } from "@/lib/mcp/openapi";
import { mcpPublicBaseUrl } from "@/lib/mcp/auth";

export const Route = createFileRoute("/api/openapi.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify(buildOpenApiDocument(mcpPublicBaseUrl() || "https://YOUR_DOMAIN"), null, 2),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        ),
    },
  },
});
