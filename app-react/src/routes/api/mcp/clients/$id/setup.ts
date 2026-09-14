/**
 * One preset's setup — `GET /api/mcp/clients/{id}/setup`.
 *
 * Public, read-only. Returns the onboarding steps + copy-paste block for a single
 * platform preset, or 404 for an unknown id.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getClientPreset } from "@/lib/mcp/clients";
import { mcpPublicBaseUrl } from "@/lib/mcp/auth";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/mcp/clients/$id/setup")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const preset = getClientPreset(params.id, mcpPublicBaseUrl() || "https://YOUR_DOMAIN");
        if (!preset) {
          return json({ ok: false, error: `unknown client preset: ${params.id}` }, 404);
        }
        return json({ preset });
      },
    },
  },
});
