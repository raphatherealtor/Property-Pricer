/**
 * Streamable HTTP MCP endpoint — `POST /api/mcp`.
 *
 * Canonical MCP transport. Accepts a JSON-RPC 2.0 request (or batch) and returns
 * a JSON response (the stateless form of Streamable HTTP), which every current MCP
 * SDK supports and which behaves correctly on serverless platforms.
 *
 * `GET /api/mcp` returns a small discovery document for humans and clients that
 * want to confirm the endpoint before initializing.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleMcpHttpRequest } from "@/lib/mcp/http";
import {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
  listToolNames,
  listResourceUris,
} from "@/lib/mcp/server";

export const Route = createFileRoute("/api/mcp/")({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpHttpRequest(request),
      GET: () =>
        new Response(
          JSON.stringify(
            {
              ok: true,
              name: SERVER_NAME,
              title: SERVER_TITLE,
              version: SERVER_VERSION,
              protocolVersion: MCP_PROTOCOL_VERSION,
              transport: "streamable-http",
              tools: listToolNames().length,
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
