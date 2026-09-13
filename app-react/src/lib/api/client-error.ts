/**
 * Turns a thrown server-function error into something a UI can render (CLIENT-SAFE).
 *
 * `createServerFn` failures cross the wire as `Error` with the server's message,
 * which is a poor thing to show directly. The cases worth separating:
 *
 *  - `unauthorized`  — the platform's stable `"Unauthorized"` contract (see
 *                      `src/lib/auth/verify.server.ts`); the fix is to sign in.
 *  - `offline`       — the browser is offline; the local scenario still works.
 *  - `config`        — the server is misconfigured (e.g. auth off against a real
 *                      database), which no amount of retrying fixes.
 *  - `validation`    — the request was rejected; the message is safe to show.
 *  - `unknown`       — anything else, rendered as a generic retry message.
 */
export type ApiErrorKind =
  | "unauthorized"
  | "offline"
  | "config"
  | "validation"
  | "unknown";

export type DescribedApiError = {
  kind: ApiErrorKind;
  message: string;
  /** True when signing in is the actionable fix. */
  requiresSignIn: boolean;
};

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

export function describeApiError(err: unknown): DescribedApiError {
  const raw = rawMessage(err);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (raw === "Unauthorized" || /unauthorized/i.test(raw)) {
    return {
      kind: "unauthorized",
      message: "Sign in to use saved scenarios, AI runs, and CRM sync.",
      requiresSignIn: true,
    };
  }
  if (raw.includes("refusing to fall back to the shared dev user")) {
    return {
      kind: "config",
      message:
        "Cloud features need sign-in enabled on this deployment (auth is off while a database is configured).",
      requiresSignIn: false,
    };
  }
  if (offline || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return {
      kind: "offline",
      message:
        "You are offline. The pricing engine and your last local scenario still work — cloud features will sync when you reconnect.",
      requiresSignIn: false,
    };
  }
  if (/missing or malformed|invalid|expected|too_small|too_big|must be/i.test(raw)) {
    return { kind: "validation", message: raw || "That request was rejected.", requiresSignIn: false };
  }
  return {
    kind: "unknown",
    message: raw
      ? `Request failed: ${raw}`
      : "Request failed. Check your connection and try again.",
    requiresSignIn: false,
  };
}
