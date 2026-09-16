/**
 * Auth route wiring tests.
 *
 * The OAuth client registration + consent flow depends on a signed-in session,
 * which depends on (a) the Better Auth catch-all `/api/auth/*` being forwarded to
 * the `auth` handler and (b) a `/login` page existing. These read the source
 * files and the generated route tree so a missing route fails the build check —
 * the same "a guard that cannot fail is not a guard" idea as the platform tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { safeAuthReturnTo } from "./return-to.ts";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRel(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

test("the /login route exists and renders local email/password auth", () => {
  const login = readRel("routes/login.tsx");
  assert.match(login, /createFileRoute\("\/login"\)/);
  assert.match(login, /authClient\.signIn\.email/);
  assert.match(login, /authClient\.signUp\.email/);
  assert.match(login, /useCurrentUserState/);
  assert.match(login, /Navigate/);
  assert.match(login, /returnTo/);
});

test("the login return target cannot leave Property Pricer", () => {
  assert.equal(safeAuthReturnTo("/oauth/authorize?client_id=pp-client"), "/oauth/authorize?client_id=pp-client");
  assert.equal(safeAuthReturnTo("https://evil.example"), "/");
  assert.equal(safeAuthReturnTo("//evil.example"), "/");
});

test("the /api/auth catch-all forwards GET and POST to the Better Auth handler", () => {
  const catchAll = readRel("routes/api/auth/$.ts");
  assert.match(catchAll, /createFileRoute\("\/api\/auth\/\$"\)/);
  assert.match(catchAll, /auth\.handler\(request\)/);
});

test("production public URL is accepted as a trusted auth origin", () => {
  const server = readRel("lib/auth/server.ts");
  assert.match(server, /envOrigin\(/);
  assert.match(server, /"MCP_PUBLIC_BASE_URL"/);
  assert.match(server, /"VERCEL_PROJECT_PRODUCTION_URL"/);
  assert.match(server, /"VERCEL_URL"/);
  assert.match(server, /const trustedOrigins: string\[\] = explicitBaseURL/);
});

test("the generated route tree wires both /login and /api/auth/$", () => {
  const tree = readRel("routeTree.gen.ts");
  assert.match(tree, /\/login/);
  assert.match(tree, /\/api\/auth\/\$/);
});
