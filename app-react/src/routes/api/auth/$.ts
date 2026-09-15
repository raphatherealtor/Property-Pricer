/**
 * Better Auth route handler — `GET`/`POST /api/auth/*`.
 *
 * Forwards every auth request (get-session, sign-in, callback, sign-out, …) to
 * the self-hosted Better Auth instance in `src/lib/auth/server.ts`, which owns
 * the session cookie on this app's own origin. Without this catch-all, the
 * client's `authClient` (which calls same-origin `/api/auth/*`) has nothing to
 * talk to, so `cloudMiddleware` can never resolve a signed-in user and every
 * workspace-scoped server function (OAuth client registration, consent, …) fails.
 */
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
