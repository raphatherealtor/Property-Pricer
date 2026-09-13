import { createMiddleware } from "@tanstack/react-start";
import { DEV_USER } from "@/lib/auth/use-current-user";

/**
 * Auth middleware for the SaaS API functions.
 *
 * Same verified-session semantics as `@/lib/auth/middleware` (which this app's
 * platform contract requires), plus the identity fields the workspace bootstrap
 * needs: the store keys an app user on `email`, and the browser already renders
 * `DEV_USER` for the disabled-auth fallback, so the server must resolve that
 * *same* identity or a workspace would be created for a user the UI never shows.
 *
 * This is a separate middleware rather than a wrapper around `authMiddleware`
 * because the bearer token (live-preview iframes use a bearer token, not a
 * cookie) is only visible to the client hook that sends it — a chained server
 * hook cannot be assumed to still receive it.
 *
 * The `.client` hook forwards the bearer token for the live preview. The
 * `.server` hook rejects scripted cross-site/sibling requests before any
 * credential is touched, then delegates verification to `requireUserId`, which
 * is the only trusted source of a user id.
 */
export const cloudMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    // Live preview (partitioned iframe): the session rides a bearer token, not a
    // cookie, so forward it. Null when deployed (cookie auth) — a no-op there.
    const { getBearerToken } = await import("../auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    // ONLY `*.server` modules here: this file is dual client/server, so Vite
    // must not follow these imports into the browser bundle.
    const { assertSameSiteRequest } = await import("../auth/isolation.server");
    const { DEV_USER_ID, getSessionUser, requireUserId } = await import(
      "../auth/verify.server"
    );
    assertSameSiteRequest();

    const userId = await requireUserId(context.bearerToken);
    const session = await getSessionUser(context.bearerToken);

    // Disabled-auth fallback: mirror `DEV_USER` exactly so preview sessions
    // share one owner with the identity the UI displays.
    const isDevFallback = userId === DEV_USER_ID && !session;
    return next({
      context: {
        userId,
        userEmail: session?.email ?? (isDevFallback ? DEV_USER.primaryEmail : null),
        userDisplayName:
          (session ? null : isDevFallback ? DEV_USER.displayName : null) ?? null,
      },
    });
  });
