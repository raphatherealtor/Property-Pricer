#!/usr/bin/env node
/**
 * Two locks this build must not break, checked on disk:
 *
 *  1. **The engine is frozen.** `src/engine/` is a locked, self-tested math SDK —
 *     the UI and the API are allowed to *call* it, never to edit it. Every file's
 *     SHA-256 is pinned in `scripts/engine.lock.json`; a diff means either the
 *     engine was changed (which needs a deliberate re-lock, and a re-run of the
 *     14 self-test assertions) or a file was added/removed.
 *
 *  2. **The schema has one definition.** `db/app-schema-v1.sql` is the reviewed
 *     DDL, and two byte-identical copies exist so the runtime can actually apply
 *     it: `migrations/0002_app_schema_v1.sql` (read by `src/lib/db.ts` for the
 *     PGLite fallback and by `scripts/migrate.mjs` for Neon) and
 *     `public/app-schema-v1.sql` (downloadable reference, matching how
 *     `schema-v1.6.sql` ships). Drift here means production runs a schema nobody
 *     reviewed.
 *
 *   node scripts/check-locks.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = dirname(APP_ROOT);
export const ENGINE_DIR = join(APP_ROOT, "src", "engine");
export const ENGINE_LOCK_REL = "scripts/engine.lock.json";
export const SCHEMA_SOURCE_REL = "db/app-schema-v1.sql";
export const SCHEMA_COPIES_REL = [
  "app-react/migrations/0002_app_schema_v1.sql",
  "app-react/public/app-schema-v1.sql",
];

/** SHA-256 of a string, with newlines normalized so parity ignores line endings. */
function sha256Text(value) {
  return createHash("sha256")
    .update(String(value).replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}

/**
 * SHA-256 of a source file's *text*, with newlines normalized to LF.
 *
 * Hashing raw bytes would make the lock depend on each machine's `core.autocrlf`:
 * a Windows checkout converts LF to CRLF in the working tree, every engine file
 * would hash differently, and the check would report "the engine was modified"
 * for a tree nobody touched. Normalizing keeps the lock about content, which is
 * what it is actually protecting, and it still fails on any real edit (including
 * a whitespace-only change).
 */
function sha256Source(path) {
  return sha256Text(readFileSync(path, "utf8"));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readEngineLock(appRoot = APP_ROOT) {
  return readJson(join(appRoot, ENGINE_LOCK_REL));
}

/** Files currently in `src/engine`, sorted, with their hashes. `null` if the
 * directory itself is gone — that is a violation, not a crash. */
export function engineFileHashes(appRoot = APP_ROOT) {
  const dir = join(appRoot, "src", "engine");
  const out = {};
  try {
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".ts")) continue;
      out[name] = sha256Source(join(dir, name));
    }
  } catch {
    return null;
  }
  return out;
}

/**
 * Violations of the frozen-engine lock. An empty array means the locked SDK is
 * content-identical (line endings aside) to what the lock was written from.
 */
export function engineLockViolations(appRoot = APP_ROOT) {
  const lock = readEngineLock(appRoot);
  const actual = engineFileHashes(appRoot);
  const expected = lock.files ?? {};
  const messages = [];

  if (actual === null) {
    return [
      "LOCKED ENGINE: src/engine/ is missing. It is the locked math SDK this app prices with — restore it.",
    ];
  }

  for (const [name, hash] of Object.entries(expected)) {
    if (!(name in actual)) {
      messages.push(
        `LOCKED ENGINE: src/engine/${name} is missing. It is part of the frozen math SDK — restore it.`,
      );
    } else if (actual[name] !== hash) {
      messages.push(
        `LOCKED ENGINE: src/engine/${name} was modified (expected ${hash.slice(0, 12)}…, found ${actual[name].slice(0, 12)}…). ` +
          "src/engine/ is a locked SDK — revert the change, or re-lock deliberately with " +
          "`node scripts/check-locks.mjs --write-lock` and re-run the engine self-test.",
      );
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) {
      messages.push(
        `LOCKED ENGINE: src/engine/${name} was added. Keep the locked SDK closed — put new code outside src/engine/.`,
      );
    }
  }
  return messages;
}

/**
 * Pull the quoted values out of a `check (<column> in ('a','b',…))` constraint.
 * Returns null when the constraint is absent, so a renamed column is reported as
 * a violation instead of silently passing.
 */
function sqlCheckValues(sql, column) {
  const pattern = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "i");
  const match = sql.match(pattern);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

/** Values of a `const NAME = ["a", "b"] as const;` array in a TS module. */
function tsArrayValues(text, name) {
  const match = text.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

/** Members of an `export type NAME = "a" | "b";` union in a TS module. */
function tsUnionValues(text, name) {
  const match = text.match(new RegExp(`export type ${name}\\s*=\\s*([^;]+);`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

/**
 * Every enum that is declared in three places at once — the Postgres CHECK
 * constraint, the wire schema, and (for personas) the locked engine — must agree.
 *
 * This is the gap the wire schema's compile-time assertions could not cover: a
 * `ZodType` alias proves the *TypeScript* enums match, but nothing proves the
 * database CHECK does. A persona added to the engine and the UI but not to
 * `db/app-schema-v1.sql` inserts fine in dev and fails in production, which is
 * exactly the class of bug a review is supposed to catch.
 */
export function schemaEnumViolations(appRoot = APP_ROOT, repoRoot = REPO_ROOT) {
  const messages = [];
  let sql;
  let schemas;
  let engineTypes;
  try {
    sql = readFileSync(join(repoRoot, SCHEMA_SOURCE_REL), "utf8");
    schemas = readFileSync(join(appRoot, "src", "lib", "api", "schemas.ts"), "utf8");
    engineTypes = readFileSync(join(appRoot, "src", "engine", "types.ts"), "utf8");
  } catch (err) {
    return [`SCHEMA ENUM: could not read a source file (${err.code ?? err.message})`];
  }

  /** Compare a DB CHECK against one or more TypeScript declarations. */
  const compare = (label, column, expected, sources) => {
    const fromSql = sqlCheckValues(sql, column);
    if (fromSql === null) {
      messages.push(
        `SCHEMA ENUM: db/app-schema-v1.sql has no \`check (${column} in (…))\` constraint; ` +
          `${label} is now unconstrained at the database level.`,
      );
      return;
    }
    if (fromSql.join(",") !== expected.join(",")) {
      messages.push(
        `SCHEMA ENUM: ${column} CHECK in ${SCHEMA_SOURCE_REL} is [${fromSql.join(", ")}] but ` +
          `${label} is [${expected.join(", ")}]. Update the DDL (and its copies) or the app enum.`,
      );
    }
    for (const [name, values, file] of sources) {
      if (values === null) {
        messages.push(`SCHEMA ENUM: could not find ${name} in ${file} — has it been renamed?`);
        continue;
      }
      if (values.join(",") !== expected.join(",")) {
        messages.push(
          `SCHEMA ENUM: ${name} in ${file} is [${values.join(", ")}] but ${column} is ` +
            `[${expected.join(", ")}].`,
        );
      }
    }
  };

  const personas = tsArrayValues(schemas, "PERSONAS");
  if (personas) {
    compare("PERSONAS (src/lib/api/schemas.ts)", "persona", personas, [
      ["the engine's Persona union", tsUnionValues(engineTypes, "Persona"), "src/engine/types.ts"],
    ]);
  } else {
    messages.push("SCHEMA ENUM: could not find PERSONAS in src/lib/api/schemas.ts");
  }
  compare(
    "AI_PROVIDER_IDS",
    "provider",
    tsArrayValues(schemas, "AI_PROVIDER_IDS") ?? [],
    [],
  );
  compare("AI_PURPOSES", "purpose", tsArrayValues(schemas, "AI_PURPOSES") ?? [], []);
  compare("EXPORT_TYPES", "export_type", tsArrayValues(schemas, "EXPORT_TYPES") ?? [], []);

  return messages;
}

/** Violations of the single-source-of-truth schema contract. */
export function schemaParityViolations(repoRoot = REPO_ROOT) {
  const messages = [];
  let source;
  try {
    source = readFileSync(join(repoRoot, SCHEMA_SOURCE_REL));
  } catch {
    return [`SCHEMA: ${SCHEMA_SOURCE_REL} is missing — it is the reviewed DDL for the SaaS tables.`];
  }
  // Compared as normalized text, not raw bytes, for the same reason the engine
  // lock is: a CRLF checkout must not read as schema drift.
  const sourceHash = sha256Text(source.toString("utf8"));

  for (const rel of SCHEMA_COPIES_REL) {
    try {
      const copy = readFileSync(join(repoRoot, rel));
      const copyHash = sha256Text(copy.toString("utf8"));
      if (copyHash !== sourceHash) {
        messages.push(
          `SCHEMA DRIFT: ${rel} differs from ${SCHEMA_SOURCE_REL}. ` +
            "Copy the reviewed DDL verbatim (`node scripts/check-locks.mjs --sync-schema`) — " +
            "the runtime applies the copy, so a mismatch means production runs an unreviewed schema.",
        );
      }
    } catch {
      messages.push(`SCHEMA DRIFT: ${rel} is missing; it must mirror ${SCHEMA_SOURCE_REL}.`);
    }
  }
  return messages;
}

export function allLockViolations(appRoot = APP_ROOT, repoRoot = REPO_ROOT) {
  return [
    ...engineLockViolations(appRoot),
    ...schemaParityViolations(repoRoot),
    ...schemaEnumViolations(appRoot, repoRoot),
  ];
}

function writeLock(appRoot = APP_ROOT) {
  const files = engineFileHashes(appRoot);
  if (files === null) {
    console.error("[locks] cannot write a lock: src/engine/ is missing.");
    process.exitCode = 1;
    return;
  }
  const lock = {
    note: "SHA-256 of every file in src/engine/. This SDK is locked: copy the behaviour, never edit it in place.",
    algorithm: "sha256",
    directory: "src/engine",
    files,
  };
  process.stdout.write(`${JSON.stringify(lock, null, 2)}\n`);
}

function syncSchema(repoRoot = REPO_ROOT) {
  const source = readFileSync(join(repoRoot, SCHEMA_SOURCE_REL));
  for (const rel of SCHEMA_COPIES_REL) {
    const target = join(repoRoot, rel);
    // Written only when the content differs, so mtimes stay meaningful.
    try {
      if (readFileSync(target).equals(source)) continue;
    } catch {
      /* fall through to write */
    }
    writeFileSync(target, source);
    console.log(`[locks] synced ${rel}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--write-lock")) {
    writeLock();
  } else if (args.includes("--sync-schema")) {
    syncSchema();
  } else {
    const violations = allLockViolations();
    console.log(
      JSON.stringify(
        {
          ok: violations.length === 0,
          engineFiles: Object.keys(engineFileHashes() ?? {}).length,
          violations,
        },
        null,
        2,
      ),
    );
    for (const message of violations) console.error(message);
    process.exitCode = violations.length === 0 ? 0 : 1;
  }
}
