/**
 * Legacy SSE transport handshake — `GET /api/mcp/sse`.
 *
 * MCP's older transport opens an event stream here, receives an `endpoint` event
 * naming the message URL, then POSTs JSON-RPC to it. This server is
 * serverless-friendly, so it opens the stream (with heartbeats) and answers
 * `POST /api/mcp/messages` **inline as JSON** rather than pushing the response
 * back over the long-lived stream — which is what a long-running process could do
 * and a serverless one cannot. Streamable HTTP (`POST /api/mcp`) is the canonical
 * transport; this exists for older clients.
 */
import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";

export const Route = createFileRoute("/api/mcp/sse")({
  server: {
    handlers: {
      GET: () => {
        const sessionId = randomUUID();
        const endpoint = `/api/mcp/messages?sessionId=${sessionId}`;

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
            // Heartbeat every 15s so proxies do not close the idle stream.
            const timer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": keepalive\n\n"));
              } catch {
                clearInterval(timer);
              }
            }, 15_000);
            if (timer.unref) timer.unref();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-mcp-session-id": sessionId,
          },
        });
      },
    },
  },
});
