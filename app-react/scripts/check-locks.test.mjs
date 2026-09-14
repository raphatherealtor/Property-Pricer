import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  APP_ROOT,
  REPO_ROOT,
  engineLockViolations,
  schemaEnumViolations,
  schemaParityViolations,
} from "./check-locks.mjs";

/**
 * Fixtures are built in a temp directory so the checks are proven to fail on a
 * violation — a guard that cannot fail is not a guard.
 */
function makeFixture({ engineFiles, lockFiles, schema, copies, mcpSchema = "create table if not exists mcp_clients (id uuid primary key);\n", mcpCopies }) {
  const root = mkdtempSync(join(tmpdir(), "pp-locks-"));
  const appRoot = join(root, "app-react");
  const engineDir = join(appRoot, "src", "engine");
  mkdirSync(engineDir, { recursive: true });
  mkdirSync(join(appRoot, "scripts"), { recursive: true });

  if (engineFiles) {
    for (const [name, body] of Object.entries(engineFiles)) {
      writeFileSync(join(engineDir, name), body);
    }
  }
  if (lockFiles) {
    writeFileSync(
      join(appRoot, "scripts", "engine.lock.json"),
      JSON.stringify({ algorithm: "sha256", directory: "src/engine", files: lockFiles }),
    );
  }
  if (schema !== undefined) {
    mkdirSync(join(root, "db"), { recursive: true });
    writeFileSync(join(root, "db", "app-schema-v1.sql"), schema);
    // A self-consistent MCP schema + copies so app-schema parity is the only
    // thing these fixtures exercise.
    writeFileSync(join(root, "db", "mcp-schema-v1.sql"), mcpSchema);
    const mcpCopyMap = mcpCopies ?? {
      "app-react/migrations/0003_mcp_gateway.sql": mcpSchema,
      "app-react/public/mcp-schema-v1.sql": mcpSchema,
    };
    for (const [rel, body] of Object.entries(mcpCopyMap)) {
      const target = join(root, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, body);
    }
  }
  for (const [rel, body] of Object.entries(copies ?? {})) {
    const target = join(root, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
  return { root, appRoot };
}

/** SHA-256 of a string, matching the lock file's format. */
async function hashOf(text) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
}

test("engine lock: a matching tree passes", async () => {
  const body = "export const x = 1;\n";
  const { appRoot } = makeFixture({
    engineFiles: { "a.ts": body },
    lockFiles: { "a.ts": await hashOf(body) },
  });
  assert.deepEqual(engineLockViolations(appRoot), []);
});

test("engine lock: a modified engine file is reported", async () => {
  const { appRoot } = makeFixture({
    engineFiles: { "compute.ts": "export const x = 2;\n" },
    lockFiles: { "compute.ts": await hashOf("export const x = 1;\n") },
  });
  const violations = engineLockViolations(appRoot);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /LOCKED ENGINE: src\/engine\/compute\.ts was modified/);
});

test("engine lock: an added or deleted engine file is reported", async () => {
  const added = makeFixture({
    engineFiles: { "a.ts": "a", "b.ts": "b" },
    lockFiles: { "a.ts": await hashOf("a") },
  });
  assert.match(engineLockViolations(added.appRoot)[0], /b\.ts was added/);

  const deleted = makeFixture({
    engineFiles: {},
    lockFiles: { "gone.ts": await hashOf("x") },
  });
  assert.match(engineLockViolations(deleted.appRoot)[0], /gone\.ts is missing/);
});

test("schema parity: identical copies pass, a drifted copy is reported", () => {
  const schema = "create table if not exists users (id uuid primary key);\n";
  const ok = makeFixture({
    schema,
    copies: {
      "app-react/migrations/0002_app_schema_v1.sql": schema,
      "app-react/public/app-schema-v1.sql": schema,
    },
  });
  assert.deepEqual(schemaParityViolations(ok.root), []);

  const drifted = makeFixture({
    schema,
    copies: {
      "app-react/migrations/0002_app_schema_v1.sql": "create table if not exists users ();\n",
      "app-react/public/app-schema-v1.sql": schema,
    },
  });
  const violations = schemaParityViolations(drifted.root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /SCHEMA DRIFT: app-react\/migrations\/0002_app_schema_v1\.sql/);

  const missing = makeFixture({ schema, copies: {} });
  assert.equal(schemaParityViolations(missing.root).length, 2);

  // Line endings must not read as drift: a CRLF checkout has to pass.
  const crlf = makeFixture({
    schema,
    copies: {
      "app-react/migrations/0002_app_schema_v1.sql": schema.replace(/\n/g, "\r\n"),
      "app-react/public/app-schema-v1.sql": schema,
    },
  });
  assert.deepEqual(schemaParityViolations(crlf.root), []);
});

test("schema enum parity: a CHECK that disagrees with the app enum is reported", () => {
  const schema = [
    "create table if not exists scenarios (",
    "  persona text not null check (persona in ('listing','lender','investor')),",
    ");",
    "create table if not exists scenario_exports (",
    "  export_type text not null check (export_type in ('json','pdf','deck','crm_payload')),",
    ");",
    "create table if not exists ai_providers (",
    "  provider text not null check (provider in ('openai','anthropic','grok','mistral')),",
    ");",
    "create table if not exists ai_runs (",
    "  purpose text not null check (purpose in ('explain','client_summary','risk_review','crm_note')),",
    ");",
    "",
  ].join("\n");
  const schemas = [
    'export const PERSONAS = ["listing", "lender", "investor", "commercial"] as const;',
    'export const AI_PROVIDER_IDS = ["openai", "anthropic", "grok", "mistral"] as const;',
    'export const AI_PURPOSES = ["explain", "client_summary", "risk_review", "crm_note", "chat"] as const;',
    'export const EXPORT_TYPES = ["json", "pdf", "deck", "crm_payload"] as const;',
    "",
  ].join("\n");
  const engineTypes = 'export type Persona = "listing" | "lender" | "investor" | "commercial";\n';

  const mcpSchema = [
    "create table if not exists mcp_clients (",
    "  client_type text not null check (client_type in ('chatgpt','claude','grok','mistral','kimi','deepseek','local','other')),",
    ");",
    "create table if not exists mcp_calls (",
    "  status text not null check (status in ('succeeded','failed','rejected')),",
    ");",
    "",
  ].join("\n");
  const mcpSchemas = [
    'export const MCP_CLIENT_TYPES = ["chatgpt", "claude", "grok", "mistral", "kimi", "deepseek", "local", "other"] as const;',
    'export const MCP_CALL_STATUSES = ["succeeded", "failed", "rejected"] as const;',
    "",
  ].join("\n");

  const { appRoot, root } = makeFixture({ schema, mcpSchema });
  // The fixture helper only writes engine/migration files, so place these by hand.
  mkdirSync(join(appRoot, "src", "lib", "api"), { recursive: true });
  mkdirSync(join(appRoot, "src", "lib", "mcp"), { recursive: true });
  mkdirSync(join(appRoot, "src", "engine"), { recursive: true });
  writeFileSync(join(appRoot, "src", "lib", "api", "schemas.ts"), schemas);
  writeFileSync(join(appRoot, "src", "lib", "mcp", "schemas.ts"), mcpSchemas);
  writeFileSync(join(appRoot, "src", "engine", "types.ts"), engineTypes);

  const violations = schemaEnumViolations(appRoot, root);
  // persona: DDL is missing "commercial"  → reported
  // purpose: DDL is missing "chat"        → reported
  // provider + export_type agree           → silent
  assert.equal(violations.length, 2, violations.join(" | "));
  assert.ok(violations.some((v) => /persona CHECK/.test(v)), "persona mismatch must be reported");
  assert.ok(violations.some((v) => /purpose CHECK/.test(v)), "purpose mismatch must be reported");
  assert.ok(
    !violations.some((v) => /provider CHECK|export_type CHECK/.test(v)),
    "agreeing enums must not be reported",
  );
});

test("the real workspace satisfies every lock", () => {
  assert.deepEqual(engineLockViolations(APP_ROOT), [], "src/engine/ must be untouched");
  assert.deepEqual(
    schemaParityViolations(REPO_ROOT),
    [],
    "db/app-schema-v1.sql and its two runtime copies must be content-identical",
  );
  assert.deepEqual(
    schemaEnumViolations(APP_ROOT, REPO_ROOT),
    [],
    "every DB CHECK constraint must agree with its app enum",
  );
});
