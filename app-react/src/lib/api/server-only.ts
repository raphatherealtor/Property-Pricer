/**
 * Server-only guard for the API layer.
 *
 * `src/lib/api/store.server.ts`, the provider adapters and the Figgy connector
 * all hold credentials and open a database connection, so they must never be
 * reachable from a React component, `useEffect`, or a browser `fetch`. Each of
 * them calls `assertApiServerOnly()` at module scope: a bundler mistake then
 * throws at import time in the browser instead of shipping keys to the client.
 */
export function assertApiServerOnly(context = "api/store.server"): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `@/lib/${context} is server-only. Call it from a createServerFn handler ` +
        "(dynamic `await import(...)` inside the handler) or a server route, " +
        "never from a React component, useEffect, or browser fetch. Client-safe " +
        "types and validators live in @/lib/api/schemas.",
    );
  }
}

assertApiServerOnly();
