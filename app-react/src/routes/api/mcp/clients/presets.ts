/**
 * Client onboarding presets — `GET /api/mcp/clients/presets`.
 *
 * Public, read-only. Returns the catalog of AI-platform onboarding presets (no
 * secrets: `client_id` values are descriptive identifiers and the bearer token
 * appears only as the `YOUR_MCP_TOKEN` placeholder).
 */
import { createFileRoute } from "@tanstack/react-router";
import { listClientPresets } from "@/lib/mcp/clients";
import { mcpPublicBaseUrl } from "@/lib/mcp/auth";

export const Route = createFileRoute("/api/mcp/clients/presets")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify(
            { presets: listClientPresets(mcpPublicBaseUrl() || "https://YOUR_DOMAIN") },
            null,
            2,
          ),
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
