/**
 * ChatGPT Pro read/fetch MCP endpoint.
 *
 * It exposes a filtered dispatcher profile: no persistent mutations, provider
 * calls, CRM operations, or exports. The primary `/api/mcp` endpoint remains
 * the full integration for Business, Enterprise, and direct MCP clients.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleMcpHttpRequest } from "@/lib/mcp/http";
import {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
  listResourceUris,
  listToolNames,
} from "@/lib/mcp/server";

const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/pro";

export const Route = createFileRoute("/api/mcp/pro")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleMcpHttpRequest(request, {
          profile: "read",
          resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
        }),
      GET: () =>
        new Response(
          JSON.stringify(
            {
              ok: true,
              name: SERVER_NAME,
              title: `${SERVER_TITLE} (read-only)`,
              version: SERVER_VERSION,
              protocolVersion: MCP_PROTOCOL_VERSION,
              transport: "streamable-http",
              profile: "read-only",
              tools: listToolNames("read").length,
              resources: listResourceUris().length,
            },
            null,
            2,
          ),
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          },
        ),
    },
  },
});
