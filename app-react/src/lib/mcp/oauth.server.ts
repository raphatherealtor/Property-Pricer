/**
 * OAuth 2.1 authorization server for the MCP protected resource (SERVER-ONLY).
 *
 * Implements the authorization-code flow **with PKCE (S256 only)**, refresh-token
 * rotation and RFC 7009 revocation, exactly the shape MCP authorization (RFC 9728)
 * and OAuth-based AI connectors (ChatGPT, Claude, …) expect. Authorization codes,
 * access tokens and refresh tokens are opaque random strings stored only as
 * SHA-256 hashes; client secrets are stored as SHA-256 hashes too. Nothing here is
 * ever returned to a browser bundle — the module is server-only and reached only
 * through `/oauth/*` routes.
 *
 * The pure logic (PKCE, redirect matching, metadata, scope parsing, request
 * validation, consent HTML) is split out so tests can exercise it without a
 * database; the store calls are dynamic imports, so a missing database fails
 * closed rather than booting PGLite under the test runner.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { assertApiServerOnly } from "../api/server-only.ts";
import { env } from "../env.server.ts";
import {
  MCP_OAUTH_AUTH_METHODS,
  MCP_OAUTH_PKCE_METHODS,
  MCP_OAUTH_SCOPES,
  MCP_OAUTH_TOKEN_KINDS,
  type McpScope,
} from "./schemas.ts";
import { isSupportedScope, parseScopeParam } from "./scopes.ts";

assertApiServerOnly("mcp/oauth");

export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REVOKE_PATH = "/oauth/revoke";
export const OAUTH_REGISTER_PATH = "/oauth/register";
export const OAUTH_OFFLINE_ACCESS_SCOPE = "offline_access";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
export const AUTH_CODE_TTL_SECONDS = 60;

export type OAuthAuthMethod = (typeof MCP_OAUTH_AUTH_METHODS)[number];
export type OAuthTokenKind = (typeof MCP_OAUTH_TOKEN_KINDS)[number];

export type OAuthClientRow = {
  id: string;
  workspace_id: string | null;
  client_id: string;
  client_secret_hash: string | null;
  display_name: string;
  auth_method: OAuthAuthMethod;
  redirect_uris: string[];
  scopes: string[];
  is_enabled: boolean;
  created_at: unknown;
};

/* ------------------------------------------------------------------ *
 * Crypto + opaque value helpers
 * ------------------------------------------------------------------ */

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** A safe, opaque random value: a URL-safe token, code, or client id fragment. */
export function randomOpaque(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/** The only form of a token/code/secret this app stores or compares. */
export function hashToken(value: string): string {
  return sha256Hex(value);
}

/** Constant-time string equality for secrets and PKCE challenges. */
function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function randomClientId(): string {
  return `pp-${randomOpaque(16)}`;
}

export function randomClientSecret(): string {
  return randomOpaque(32);
}

/* ------------------------------------------------------------------ *
 * PKCE (RFC 7636, S256 only)
 * ------------------------------------------------------------------ */

export function pkceChallenge(verifier: string): string {
  return base64url(sha256Buffer(verifier));
}

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  if (!verifier || !challenge) return false;
  return safeEqualString(pkceChallenge(verifier), challenge);
}

/* ------------------------------------------------------------------ *
 * Redirect-URI pattern matching (the operator registers glob patterns)
 * ------------------------------------------------------------------ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += escapeRegExp(ch);
  }
  out += "$";
  return new RegExp(out);
}

/** Match a redirect URI against the operator's registered patterns (e.g. `http://localhost:*`). */
export function redirectUriMatches(pattern: string, uri: string): boolean {
  try {
    return globToRegExp(pattern).test(uri);
  } catch {
    return false;
  }
}

export function findMatchingRedirect(patterns: string[], uri: string): string | null {
  return patterns.find((p) => redirectUriMatches(p, uri)) ?? null;
}

/* ------------------------------------------------------------------ *
 * Issuer + discovery metadata
 * ------------------------------------------------------------------ */

export function oauthIssuer(request: Request): string {
  const pub = env("MCP_PUBLIC_BASE_URL");
  if (pub) return pub.replace(/\/+$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function buildAuthorizationServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${OAUTH_TOKEN_PATH}`,
    revocation_endpoint: `${issuer}${OAUTH_REVOKE_PATH}`,
    registration_endpoint: `${issuer}${OAUTH_REGISTER_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: [...MCP_OAUTH_PKCE_METHODS],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...MCP_OAUTH_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE],
  };
}

export type DynamicClientRegistration = {
  redirectUris: string[];
  displayName: string;
  scopes: McpScope[];
};

function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

/** Validate public-client dynamic registration without accepting unsafe callbacks. */
export function validateDynamicClientRegistration(body: unknown): DynamicClientRegistration | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const redirectUris = Array.isArray(input.redirect_uris)
    ? [...new Set(input.redirect_uris.filter((uri): uri is string => typeof uri === "string" && isAllowedRedirectUri(uri)))]
    : [];
  if (redirectUris.length === 0) return null;

  const authMethod = input.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") return null;
  const responseTypes = input.response_types;
  if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.includes("code"))) return null;
  const grantTypes = input.grant_types;
  if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code"))) return null;

  const requestedScopes = typeof input.scope === "string" ? parseScopeParam(input.scope) : [...MCP_OAUTH_SCOPES];
  if (requestedScopes.length === 0) return null;
  const displayName = typeof input.client_name === "string" ? input.client_name.trim().slice(0, 120) : "MCP client";
  return { redirectUris, displayName: displayName || "MCP client", scopes: requestedScopes };
}

export function buildProtectedResourceMetadata(
  issuer: string,
  resourcePath = "/api/mcp",
  scopes: readonly McpScope[] = MCP_OAUTH_SCOPES,
): Record<string, unknown> {
  return {
    resource: `${issuer}${resourcePath}`,
    authorization_servers: [issuer],
    scopes_supported: [...scopes],
    bearer_methods_supported: ["header"],
  };
}

/* ------------------------------------------------------------------ *
 * Authorize request validation (pure)
 * ------------------------------------------------------------------ */

export type AuthorizeValidation =
  | {
      ok: true;
      redirectUri: string;
      scopes: McpScope[];
      codeChallenge: string;
      state: string | null;
    }
  | { ok: false; error: string; errorDescription?: string };

export function validateAuthorizeRequest(
  params: { responseType: string | null; redirectUri: string | null; scope: string | null; codeChallenge: string | null; codeChallengeMethod: string | null; state: string | null },
  client: Pick<OAuthClientRow, "redirect_uris" | "scopes">,
): AuthorizeValidation {
  if (params.responseType !== "code") {
    return { ok: false, error: "unsupported_response_type", errorDescription: "Only response_type=code is supported." };
  }
  if (!params.redirectUri) {
    return { ok: false, error: "invalid_request", errorDescription: "redirect_uri is required." };
  }
  const matched = findMatchingRedirect(client.redirect_uris, params.redirectUri);
  if (!matched) {
    return { ok: false, error: "invalid_request", errorDescription: "redirect_uri is not registered for this client." };
  }
  const requested = parseScopeParam(params.scope);
  if (requested.length === 0) {
    return { ok: false, error: "invalid_scope", errorDescription: "At least one supported scope is required." };
  }
  for (const scope of requested) {
    if (!client.scopes.includes(scope)) {
      return { ok: false, error: "invalid_scope", errorDescription: `Scope ${scope} is not allowed for this client.` };
    }
  }
  const method = params.codeChallengeMethod ?? "S256";
  if (!MCP_OAUTH_PKCE_METHODS.includes(method as (typeof MCP_OAUTH_PKCE_METHODS)[number])) {
    return { ok: false, error: "invalid_request", errorDescription: `code_challenge_method must be ${MCP_OAUTH_PKCE_METHODS.join(" or ")}.` };
  }
  if (!params.codeChallenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(params.codeChallenge)) {
    return { ok: false, error: "invalid_request", errorDescription: "A valid code_challenge is required." };
  }
  return {
    ok: true,
    // The concrete URI the client sent (redirect back here, not to the pattern).
    redirectUri: params.redirectUri,
    scopes: requested,
    codeChallenge: params.codeChallenge,
    state: params.state,
  };
}

/* ------------------------------------------------------------------ *
 * Consent HTML (server-rendered, no client bundle)
 * ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SCOPE_LABELS: Record<McpScope, string> = {
  "mcp:tools": "Call Property Pricer pricing tools",
  "mcp:ai": "Generate AI narratives (summaries, risk reviews)",
  "mcp:crm": "Push scenarios to Figgy and draft CRM follow-ups",
  "mcp:resources": "Read scenario and engine resources",
  "mcp:prompts": "Use Property Pricer prompts",
};

export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope as McpScope] ?? scope;
}

function consentHiddenField(name: string, value: string | null): string {
  if (value === null || value === undefined) return "";
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`;
}

/** The consent page: shows the client + requested scopes, with Approve/Deny. */
export function renderConsentHtml(args: {
  clientDisplayName: string;
  clientId: string;
  scopes: McpScope[];
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopeRaw: string | null;
}): string {
  const scopes = args.scopes
    .map((s) => `<li><code>${escapeHtml(s)}</code> — ${escapeHtml(scopeLabel(s))}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize ${escapeHtml(args.clientDisplayName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; } .card { border: 1px solid #8884; border-radius: 10px; padding: 1.25rem; }
  ul { padding-left: 1.25rem; line-height: 1.6; } code { background: #8882; padding: 0 0.25rem; border-radius: 4px; }
  button { font-size: 1rem; padding: 0.55rem 1rem; border-radius: 8px; border: 1px solid #8888; cursor: pointer; margin-right: 0.5rem; }
  button.approve { background: #0a7; color: #fff; border-color: #0a7; }
  .muted { color: #888; }
</style>
</head>
<body>
<h1>Authorize ${escapeHtml(args.clientDisplayName)}</h1>
<div class="card">
<p><strong>${escapeHtml(args.clientDisplayName)}</strong> (client <code>${escapeHtml(args.clientId)}</code>) wants to act on your behalf through the Property Pricer MCP server.</p>
<p class="muted">This grants the client the following scopes for the Property Pricer workspace you are signed in to:</p>
<ul>${scopes}</ul>
<form method="post" action="/oauth/authorize">
${consentHiddenField("client_id", args.clientId)}
${consentHiddenField("redirect_uri", args.redirectUri)}
${consentHiddenField("scope", args.scopeRaw ?? args.scopes.join(" "))}
${consentHiddenField("state", args.state)}
${consentHiddenField("code_challenge", args.codeChallenge)}
${consentHiddenField("code_challenge_method", args.codeChallengeMethod)}
<button type="submit" name="decision" value="approve" class="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>
</div>
</body>
</html>`;
}

/** A minimal HTML page for OAuth errors and the sign-in-required state. */
export function renderOAuthMessage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.6}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Open Property Pricer</a></p></body></html>`;
}

/* ------------------------------------------------------------------ *
 * HTTP response helpers
 * ------------------------------------------------------------------ */

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

function errorRedirect(redirectUri: string, error: string, state: string | null): Response {
  const sep = redirectUri.includes("?") ? "&" : "?";
  const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";
  return redirect(`${redirectUri}${sep}error=${encodeURIComponent(error)}${stateParam}`);
}

/* ------------------------------------------------------------------ *
 * Store access (dynamic import: fail closed without a database)
 * ------------------------------------------------------------------ */

type OAuthStore = typeof import("../api/store.server.ts");

async function oauthStore(): Promise<OAuthStore | null> {
  try {
    return await import("../api/store.server.ts");
  } catch {
    return null;
  }
}

function formValue(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.length > 0 ? v : null;
}

/* ------------------------------------------------------------------ *
 * Route handlers
 * ------------------------------------------------------------------ */

function clientSecretValid(client: OAuthClientRow, presented: string | null): boolean {
  if (client.auth_method === "public_pkce") return true;
  if (!client.client_secret_hash || !presented) return false;
  return safeEqualString(hashToken(presented), client.client_secret_hash);
}

function parseClientSecret(request: Request, form: FormData): string | null {
  const fromBody = formValue(form, "client_secret");
  if (fromBody) return fromBody;
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    // The client id is the username; the secret is everything after the colon.
    return decoded.slice(sep + 1) || null;
  } catch {
    return null;
  }
}

async function loadClient(clientId: string | null): Promise<OAuthClientRow | null> {
  if (!clientId) return null;
  const store = await oauthStore();
  if (!store) return null;
  try {
    return await store.findOAuthClientByClientId(clientId);
  } catch {
    return null;
  }
}

/** POST /oauth/register — OAuth dynamic registration for public PKCE clients. */
export async function handleOAuthRegister(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_client_metadata" }, 400);
  }
  const registration = validateDynamicClientRegistration(body);
  if (!registration) {
    return jsonResponse({ error: "invalid_client_metadata" }, 400);
  }

  const store = await oauthStore();
  if (!store) return jsonResponse({ error: "server_error" }, 500);

  const clientId = randomClientId();
  try {
    await store.registerOAuthClient({
      workspaceId: null,
      clientId,
      clientSecretHash: null,
      displayName: registration.displayName,
      authMethod: "public_pkce",
      redirectUris: registration.redirectUris,
      scopes: registration.scopes,
    });
  } catch {
    return jsonResponse({ error: "server_error" }, 500);
  }

  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: registration.displayName,
      redirect_uris: registration.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: registration.scopes.join(" "),
    },
    201,
  );
}

/** GET /oauth/authorize — validate, then render the consent page. */
export async function handleOAuthAuthorizeGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = {
    responseType: url.searchParams.get("response_type"),
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    scope: url.searchParams.get("scope"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
    state: url.searchParams.get("state"),
  };

  const client = await loadClient(params.clientId);
  if (!client || !client.is_enabled) {
    return htmlResponse(renderOAuthMessage("Invalid client", "This client is not registered (or is disabled)."), 400);
  }

  const validation = validateAuthorizeRequest(
    {
      responseType: params.responseType,
      redirectUri: params.redirectUri,
      scope: params.scope,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      state: params.state,
    },
    client,
  );
  if (!validation.ok) {
    // Redirect only when the redirect_uri was validated; otherwise a plain error.
    if (params.redirectUri && findMatchingRedirect(client.redirect_uris, params.redirectUri)) {
      return errorRedirect(params.redirectUri, validation.error, params.state);
    }
    return htmlResponse(renderOAuthMessage("Authorization error", validation.errorDescription ?? validation.error), 400);
  }

  const { getSessionUser } = await import("../auth/verify.server.ts");
  const user = await getSessionUser().catch(() => null);
  if (!user) {
    return htmlResponse(
      renderOAuthMessage(
        "Sign in required",
        "You must be signed in to Property Pricer before approving a client. Sign in, then return to this authorization.",
      ),
      401,
    );
  }

  return htmlResponse(
    renderConsentHtml({
      clientDisplayName: client.display_name,
      clientId: client.client_id,
      scopes: validation.scopes,
      redirectUri: validation.redirectUri,
      state: validation.state,
      codeChallenge: validation.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod ?? "S256",
      scopeRaw: params.scope,
    }),
  );
}

/** POST /oauth/authorize — the consent decision. */
export async function handleOAuthAuthorizePost(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return htmlResponse(renderOAuthMessage("Bad request", "Expected a form submission."), 400);
  }

  const decision = formValue(form, "decision");
  const clientId = formValue(form, "client_id");
  const redirectUri = formValue(form, "redirect_uri");
  const scope = formValue(form, "scope");
  const state = formValue(form, "state");
  const codeChallenge = formValue(form, "code_challenge");
  const codeChallengeMethod = formValue(form, "code_challenge_method") ?? "S256";

  const client = await loadClient(clientId);
  if (!client || !client.is_enabled || !redirectUri) {
    return htmlResponse(renderOAuthMessage("Invalid client", "This client is not registered (or is disabled)."), 400);
  }

  const validation = validateAuthorizeRequest(
    { responseType: "code", redirectUri, scope, codeChallenge, codeChallengeMethod, state },
    client,
  );

  if (decision !== "approve" || !validation.ok) {
    return errorRedirect(redirectUri, "access_denied", state);
  }

  const { getSessionUser } = await import("../auth/verify.server.ts");
  const user = await getSessionUser().catch(() => null);
  if (!user) {
    return htmlResponse(renderOAuthMessage("Sign in required", "Your session expired. Sign in and try again."), 401);
  }

  const store = await oauthStore();
  if (!store) {
    return htmlResponse(renderOAuthMessage("Server error", "The authorization store is unavailable."), 500);
  }

  let workspaceId = client.workspace_id;
  if (!workspaceId) {
    try {
      const workspace = await store.workspaceFor({ userId: user.id, userEmail: user.email });
      workspaceId = workspace.workspaceId;
    } catch {
      return htmlResponse(renderOAuthMessage("Server error", "Could not resolve your Property Pricer workspace."), 500);
    }
  }

  const code = randomOpaque(32);
  try {
    await store.insertOAuthCode({
      codeHash: hashToken(code),
      clientId: client.client_id,
      workspaceId,
      userId: user.id,
      redirectUri: validation.redirectUri,
      codeChallenge: validation.codeChallenge,
      codeChallengeMethod: codeChallengeMethod,
      scopes: validation.scopes,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
    });
  } catch {
    return htmlResponse(renderOAuthMessage("Server error", "Could not issue the authorization code."), 500);
  }

  const sep = validation.redirectUri.includes("?") ? "&" : "?";
  const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";
  return redirect(`${validation.redirectUri}${sep}code=${encodeURIComponent(code)}${stateParam}`);
}

/** POST /oauth/token — exchange a code (PKCE) or rotate a refresh token. */
export async function handleOAuthToken(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const grantType = formValue(form, "grant_type");
  const clientId = formValue(form, "client_id");
  const client = await loadClient(clientId);
  if (!client || !client.is_enabled) {
    return jsonResponse({ error: "invalid_client", error_description: "Unknown or disabled client." }, 401);
  }

  const secret = parseClientSecret(request, form);
  if (!clientSecretValid(client, secret)) {
    return jsonResponse({ error: "invalid_client", error_description: "Client authentication failed." }, 401);
  }

  const store = await oauthStore();
  if (!store) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  if (grantType === "authorization_code") {
    const code = formValue(form, "code");
    const redirectUri = formValue(form, "redirect_uri");
    const verifier = formValue(form, "code_verifier");
    if (!code || !redirectUri || !verifier) {
      return jsonResponse({ error: "invalid_request", error_description: "code, redirect_uri and code_verifier are required." }, 400);
    }

    const consumed = await store.consumeOAuthCode(hashToken(code));
    if (!consumed || consumed.clientId !== client.client_id || consumed.redirectUri !== redirectUri) {
      return jsonResponse({ error: "invalid_grant", error_description: "The authorization code is invalid or expired." }, 400);
    }
    if (!verifyPkce(verifier, consumed.codeChallenge, consumed.codeChallengeMethod)) {
      return jsonResponse({ error: "invalid_grant", error_description: "PKCE verification failed." }, 400);
    }
    return issueTokenResponse(store, client, consumed.workspaceId, consumed.userId, asMcpScopes(consumed.scopes));
  }

  if (grantType === "refresh_token") {
    const refreshToken = formValue(form, "refresh_token");
    if (!refreshToken) {
      return jsonResponse({ error: "invalid_request", error_description: "refresh_token is required." }, 400);
    }
    const existing = await store.findOAuthTokenByHash(hashToken(refreshToken));
    if (!existing || existing.kind !== "refresh" || existing.client_id !== client.client_id) {
      return jsonResponse({ error: "invalid_grant", error_description: "The refresh token is invalid." }, 400);
    }
    if (existing.revoked_at || new Date(existing.expires_at as string | number | Date).getTime() <= Date.now()) {
      return jsonResponse({ error: "invalid_grant", error_description: "The refresh token is expired or revoked." }, 400);
    }
    await store.revokeOAuthToken(hashToken(refreshToken));
    return issueTokenResponse(store, client, existing.workspace_id, existing.user_id, asMcpScopes(existing.scopes));
  }

  return jsonResponse({ error: "unsupported_grant_type" }, 400);
}

/** Coerce stored `text[]` scopes back to the typed `McpScope[]` (drop unknowns). */
function asMcpScopes(values: readonly string[]): McpScope[] {
  return values.filter((s): s is McpScope => isSupportedScope(s));
}

async function issueTokenResponse(
  store: NonNullable<Awaited<ReturnType<typeof oauthStore>>>,
  client: OAuthClientRow,
  workspaceId: string | null,
  userId: string | null,
  scopes: McpScope[],
): Promise<Response> {
  const accessToken = randomOpaque(32);
  const refreshToken = randomOpaque(32);
  const now = Date.now();
  try {
    await store.insertOAuthToken({
      tokenHash: hashToken(accessToken),
      kind: "access",
      clientId: client.client_id,
      workspaceId,
      userId,
      scopes,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    });
    await store.insertOAuthToken({
      tokenHash: hashToken(refreshToken),
      kind: "refresh",
      clientId: client.client_id,
      workspaceId,
      userId,
      scopes,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
  } catch {
    return jsonResponse({ error: "server_error" }, 500);
  }
  return jsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopes.join(" "),
    refresh_token: refreshToken,
  });
}

/** POST /oauth/revoke — RFC 7009 token revocation. */
export async function handleOAuthRevoke(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const token = formValue(form, "token");
  if (!token) return jsonResponse({ error: "invalid_request" }, 400);

  const clientId = formValue(form, "client_id");
  const client = await loadClient(clientId);
  if (client) {
    const secret = parseClientSecret(request, form);
    if (!clientSecretValid(client, secret)) {
      return jsonResponse({ error: "invalid_client" }, 401);
    }
  }

  const store = await oauthStore();
  if (!store) return jsonResponse({ error: "server_error" }, 500);
  try {
    await store.revokeOAuthToken(hashToken(token));
  } catch {
    return jsonResponse({ error: "server_error" }, 500);
  }
  // RFC 7009: 200 regardless of whether the token existed.
  return new Response(null, { status: 200 });
}
