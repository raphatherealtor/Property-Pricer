/**
 * OAuth 2.1 authorization-server tests (pure logic — no database).
 *
 * Everything the routes compute *before* touching the store is covered here:
 * PKCE (S256 only), redirect-URI glob matching, scope parsing/enforcement,
 * authorize-request validation, discovery metadata, and consent-HTML escaping.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  escapeHtml,
  FIGGY_NO_PKCE_CHALLENGE,
  findMatchingRedirect,
  hashToken,
  oauthIssuer,
  OAUTH_OFFLINE_ACCESS_SCOPE,
  oauthSignInLocation,
  pkceChallenge,
  randomClientId,
  randomClientSecret,
  randomOpaque,
  redirectUriMatches,
  renderConsentHtml,
  validateDynamicClientRegistration,
  validateAuthorizeRequest,
  verifyPkce,
} from "@/lib/mcp/oauth.server";
import { MCP_OAUTH_SCOPES } from "@/lib/mcp/schemas";
import {
  hasScopes,
  missingScopes,
  parseScopeParam,
  toolRequiredScopes,
} from "@/lib/mcp/scopes";

afterEach(() => {
  delete process.env.MCP_PUBLIC_BASE_URL;
});

test("opaque values and hashes are stable and non-secret", () => {
  const a = randomOpaque();
  const b = randomOpaque();
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
  assert.match(randomClientId(), /^pp-[A-Za-z0-9_-]+$/);
  assert.match(randomClientSecret(), /^[A-Za-z0-9_-]{40,}$/);
});

test("PKCE verifies only S256 challenges, constant-time", () => {
  const verifier = randomOpaque(32);
  const challenge = pkceChallenge(verifier);
  assert.equal(verifyPkce(verifier, challenge, "S256"), true);
  assert.equal(verifyPkce(verifier, challenge, "plain"), false, "plain must be rejected (OAuth 2.1)");
  assert.equal(verifyPkce("wrong", challenge, "S256"), false);
  assert.equal(verifyPkce("", challenge, "S256"), false);
});

test("redirect-URI patterns match exactly and with globs", () => {
  assert.equal(redirectUriMatches("https://app.example/cb", "https://app.example/cb"), true);
  assert.equal(redirectUriMatches("http://localhost:*", "http://localhost:8412/cb"), true);
  assert.equal(redirectUriMatches("https://chatgpt.com/aip/*/oauth/callback", "https://chatgpt.com/aip/xyz/oauth/callback"), true);
  assert.equal(redirectUriMatches("https://app.example/*", "https://evil.example/x"), false);
  assert.equal(findMatchingRedirect(["http://localhost:*", "https://app.example/*"], "https://app.example/cb"), "https://app.example/*");
  assert.equal(findMatchingRedirect(["http://localhost:*"], "https://other.example/cb"), null);
});

test("authorize-request validation accepts a valid request and rejects bad ones", () => {
  const client = {
    redirect_uris: ["http://localhost:*", "https://chatgpt.com/aip/*/oauth/callback"],
    scopes: ["mcp:tools", "mcp:ai", "mcp:resources", "mcp:prompts"],
  };
  const base = {
    responseType: "code",
    redirectUri: "http://localhost:8412/cb",
    scope: "mcp:tools mcp:resources",
    codeChallenge: randomOpaque(43),
    codeChallengeMethod: "S256",
    state: "st-1",
  };

  const ok = validateAuthorizeRequest(base, client);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.redirectUri, "http://localhost:8412/cb");
    assert.deepEqual(ok.scopes, ["mcp:tools", "mcp:resources"]);
    assert.equal(ok.state, "st-1");
  }

  assert.equal(validateAuthorizeRequest({ ...base, responseType: "token" }, client).ok, false);
  const unregistered = validateAuthorizeRequest({ ...base, redirectUri: "https://evil.example/cb" }, client);
  assert.equal(unregistered.ok, false);
  if (!unregistered.ok) assert.equal(unregistered.error, "invalid_request");

  const badScope = validateAuthorizeRequest({ ...base, scope: "mcp:crm" }, client);
  assert.equal(badScope.ok, false);
  if (!badScope.ok) assert.equal(badScope.error, "invalid_scope");

  const badPkce = validateAuthorizeRequest({ ...base, codeChallengeMethod: "plain" }, client);
  assert.equal(badPkce.ok, false);

  const missing = validateAuthorizeRequest({ ...base, codeChallenge: null }, client);
  assert.equal(missing.ok, false);

  const figgy = validateAuthorizeRequest({ ...base, codeChallenge: null }, client, { allowMissingPkce: true });
  assert.equal(figgy.ok, true);
  if (figgy.ok) assert.equal(figgy.codeChallenge, FIGGY_NO_PKCE_CHALLENGE);
});

test("scope parsing and enforcement honour OAuth scopes but not null (full access)", () => {
  assert.deepEqual(parseScopeParam("mcp:tools mcp:resources"), ["mcp:tools", "mcp:resources"]);
  assert.deepEqual(parseScopeParam("mcp:tools,mcp:tools, mcp:ai"), ["mcp:tools", "mcp:ai"]);
  assert.deepEqual(parseScopeParam("bogus"), []);

  const scoped = { scopes: ["mcp:tools", "mcp:resources"] } as { scopes: string[] | null };
  assert.equal(hasScopes(scoped as never, ["mcp:tools"]), true);
  assert.equal(hasScopes(scoped as never, ["mcp:ai"]), false);
  assert.deepEqual(missingScopes(scoped as never, ["mcp:tools", "mcp:ai"]), ["mcp:ai"]);

  const fullAccess = { scopes: null } as { scopes: string[] | null };
  assert.equal(hasScopes(fullAccess as never, ["mcp:crm"]), true);
  assert.deepEqual(missingScopes(fullAccess as never, ["mcp:crm"]), []);

  assert.deepEqual(toolRequiredScopes("general"), ["mcp:tools"]);
  assert.deepEqual(toolRequiredScopes("ai"), ["mcp:tools", "mcp:ai"]);
  assert.deepEqual(toolRequiredScopes("crm"), ["mcp:tools", "mcp:crm"]);
});

test("discovery metadata advertises OAuth 2.1 + PKCE + the right scopes", () => {
  const as = buildAuthorizationServerMetadata("https://pricer.example");
  assert.equal(as.issuer, "https://pricer.example");
  assert.equal(as.authorization_endpoint, "https://pricer.example/oauth/authorize");
  assert.equal(as.token_endpoint, "https://pricer.example/oauth/token");
  assert.equal(as.revocation_endpoint, "https://pricer.example/oauth/revoke");
  assert.equal(as.registration_endpoint, "https://pricer.example/oauth/register");
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(as.scopes_supported, [...MCP_OAUTH_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE]);

  const pr = buildProtectedResourceMetadata("https://pricer.example");
  assert.equal(pr.resource, "https://pricer.example/api/mcp");
  assert.deepEqual(pr.authorization_servers, ["https://pricer.example"]);
});

test("a signed-out OAuth request returns to the exact approval request after login", () => {
  const location = oauthSignInLocation(
    new Request("https://pricer.example/oauth/authorize?client_id=pp-client&state=return-here"),
  );
  assert.equal(
    location,
    "/login?returnTo=%2Foauth%2Fauthorize%3Fclient_id%3Dpp-client%26state%3Dreturn-here",
  );
});

test("dynamic client registration accepts safe public PKCE callbacks only", () => {
  const client = validateDynamicClientRegistration({
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/aip/abc/oauth/callback"],
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    scope: "mcp:tools mcp:resources",
  });
  assert.deepEqual(client, {
    displayName: "ChatGPT",
    redirectUris: ["https://chatgpt.com/aip/abc/oauth/callback"],
    scopes: ["mcp:tools", "mcp:resources"],
  });
  assert.equal(validateDynamicClientRegistration({ redirect_uris: ["http://evil.example/cb"] }), null);
  assert.equal(validateDynamicClientRegistration({ redirect_uris: ["https://client.example/cb#fragment"] }), null);
  assert.equal(validateDynamicClientRegistration({ redirect_uris: ["https://client.example/cb"], token_endpoint_auth_method: "client_secret_post" }), null);
});

test("issuer prefers MCP_PUBLIC_BASE_URL and falls back to the request origin", () => {
  const request = new Request("http://127.0.0.1:8080/oauth/authorize");
  assert.equal(oauthIssuer(request), "http://127.0.0.1:8080");
  process.env.MCP_PUBLIC_BASE_URL = "https://pricer.example/";
  assert.equal(oauthIssuer(request), "https://pricer.example");
});

test("consent HTML escapes untrusted values and carries the hidden fields", () => {
  const html = renderConsentHtml({
    clientDisplayName: "<script>alert(1)</script>",
    clientId: 'pp-"x"',
    scopes: ["mcp:tools", "mcp:ai"],
    redirectUri: "http://localhost:9/cb",
    state: 'a"b',
    codeChallenge: "c" + "d".repeat(42),
    codeChallengeMethod: "S256",
    scopeRaw: "mcp:tools mcp:ai",
  });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /name="client_id"/);
  assert.match(html, /name="code_challenge"/);
  assert.match(html, /name="decision" value="approve"/);
  assert.equal(escapeHtml(`<a href="x" onmouseover='y'>`), "&lt;a href=&quot;x&quot; onmouseover=&#39;y&#39;&gt;");
});
