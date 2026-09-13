import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  APP_ROOT,
  findStaticServerImports,
  isClientBundled,
  scanClientSecrets,
  stripBlockComments,
} from "./check-no-client-secrets.mjs";

function makeApp(files) {
  const appRoot = mkdtempSync(join(tmpdir(), "pp-secrets-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = join(appRoot, ...rel.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
  return appRoot;
}

test("isClientBundled excludes server-only modules", () => {
  assert.equal(isClientBundled("src/components/app.tsx"), true);
  assert.equal(isClientBundled("src/lib/api/cloud.ts"), true);
  assert.equal(isClientBundled("src/lib/api/store.server.ts"), false);
  assert.equal(isClientBundled("src/lib/ai/providers.server.ts"), false);
  assert.equal(isClientBundled("src/routeTree.gen.ts"), false);
  assert.equal(isClientBundled("server/middleware/x.ts"), false);
});

test("isClientBundled excludes the platform's server-only modules and test files", () => {
  // Regression guards for the false positives this scanner produced on the real
  // tree: these files are server-only (or unbundled) without the `.server` suffix.
  assert.equal(isClientBundled("src/lib/db.ts"), false);
  assert.equal(isClientBundled("src/lib/auth/server.ts"), false);
  assert.equal(isClientBundled("src/lib/ai/prompt.test.ts"), false);
  assert.equal(isClientBundled("src/lib/app-data/app-data.test.ts"), false);
});

test("block comments are stripped, but line comments are not (so URLs survive)", () => {
  const doc = '/**\n * Never do this:\n * import { getSql } from "@/lib/db";\n */\nconst x = 1;\n';
  assert.ok(!stripBlockComments(doc).includes("@/lib/db"));
  // A `//` inside a URL must not be mistaken for a comment: cutting there could
  // hide a real provider endpoint.
  const code = 'const u = "https://api.openai.com/v1"; // live endpoint\n';
  assert.ok(stripBlockComments(code).includes("api.openai.com"));
});

test("a documented counter-example is not reported as a leak", () => {
  const appRoot = makeApp({
    "src/lib/thing.ts":
      '/**\n * Do NOT do this:\n * import { getSql } from "@/lib/db";\n * const k = process.env.OPENAI_API_KEY;\n */\nexport const ok = 1;\n',
  });
  assert.deepEqual(scanClientSecrets(appRoot), []);
});

test("findStaticServerImports ignores type-only and dynamic imports", () => {
  const typeOnly = 'import type { ScenarioDto } from "./store.server.ts";\n';
  assert.deepEqual(findStaticServerImports(typeOnly), []);

  const dynamic = 'const m = await import("./store.server.ts");\n';
  assert.deepEqual(findStaticServerImports(dynamic), []);

  const value = 'import { getScenario } from "./store.server.ts";\n';
  assert.equal(findStaticServerImports(value).length, 1);
  assert.equal(findStaticServerImports(value)[0].specifier, "./store.server.ts");

  const sideEffect = 'import "./telemetry.server";\n';
  assert.equal(findStaticServerImports(sideEffect).length, 1);

  // A value import must not be confused with a later type-only import in the same
  // file — the old whole-file regex did exactly that.
  const mixed =
    'import { createServerFn } from "@tanstack/react-start";\n' +
    'import type { X } from "./types.server.ts";\n';
  assert.deepEqual(findStaticServerImports(mixed), []);
});


test("a static import of a server module from client code is a violation", () => {
  const appRoot = makeApp({
    "src/components/leak.tsx": 'import { getSql } from "@/lib/api/store.server";\n',
  });
  const violations = scanClientSecrets(appRoot);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /CLIENT LEAK: src\/components\/leak\.tsx statically imports/);
});

test("a dynamic import inside a handler is allowed, and import type is ignored", () => {
  const appRoot = makeApp({
    "src/lib/api/cloud.ts":
      'import type { CloudStatusDto } from "./schemas.ts";\n' +
      "export const get = createServerFn({ method: \"POST\" }).handler(async () => {\n" +
      '  const { workspaceFor } = await import("./store.server.ts");\n' +
      "  return workspaceFor({});\n" +
      "});\n",
  });
  assert.deepEqual(scanClientSecrets(appRoot), []);
});

test("server modules may name providers; client files may not", () => {
  const serverSide = makeApp({
    "src/lib/ai/providers.server.ts": 'const url = "https://api.openai.com/v1";\n',
  });
  assert.deepEqual(scanClientSecrets(serverSide), []);

  const leaky = makeApp({
    "src/components/ai.tsx": 'const endpoint = "https://api.anthropic.com/v1/messages";\n',
  });
  assert.match(scanClientSecrets(leaky)[0], /references the provider endpoint api\.anthropic\.com/);
});

test("secret env var names must not appear in client code", () => {
  const appRoot = makeApp({
    "src/components/bad.tsx": "const key = process.env.OPENAI_API_KEY;\n",
  });
  assert.match(scanClientSecrets(appRoot)[0], /references the server env var OPENAI_API_KEY/);
});

test("@/lib/db must not be imported from client code", () => {
  const appRoot = makeApp({
    "src/components/bad.tsx": 'import { getSql } from "@/lib/db";\n',
  });
  assert.match(scanClientSecrets(appRoot)[0], /server-only @\/lib\/db/);
});

test("a credential-shaped literal is reported wherever it appears", () => {
  const appRoot = makeApp({
    "src/lib/ai/providers.server.ts": `const k = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";\n`,
  });
  assert.match(scanClientSecrets(appRoot)[0], /COMMITTED CREDENTIAL/);
});

test("the app's own source is clean", () => {
  const violations = scanClientSecrets(APP_ROOT);
  assert.deepEqual(
    violations,
    [],
    "no client-bundled file may reach a provider, a credential, or a server-only module",
  );
});
