#!/usr/bin/env node
/**
 * The "never call providers directly from the browser" gate.
 *
 * `scripts/check-auth-invariant.mjs` guards a behavioural invariant; this guards a
 * *security* one, and it is checked against source rather than intent, because a
 * single careless `import` is all it takes to ship a key-handling module to the
 * client:
 *
 *  1. **No static import of a `*.server.ts` module from a client-bundled file.**
 *     Server modules must be reached with a dynamic `await import(...)` *inside* a
 *     `createServerFn` handler or a server route, which is what keeps them out of
 *     the browser bundle. `import type` is exempt: it is erased at compile time.
 *  2. **No vendor endpoint or env-var name in client code.** If the browser knew
 *     `api.openai.com` or `OPENAI_API_KEY`, the next step would be calling it.
 *  3. **No credential-shaped literal anywhere in `src/`.** A committed `sk-…`
 *     string is a leaked key whether or not anything reads it.
 *
 *   node scripts/check-no-client-secrets.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Provider endpoints the browser must never know about. */
export const FORBIDDEN_CLIENT_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "api.x.ai",
  "api.mistral.ai",
  "api.figgy.ai",
];

/** Env vars whose *names* must not appear in client code. */
export const FORBIDDEN_CLIENT_ENV = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "GROK_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "FIGGY_API_KEY",
  "APP_ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
];

const SCANNABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;


/** A credential-shaped literal. */
const CREDENTIAL_LITERAL =
  /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/;

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...listFiles(full));
    } else if (SCANNABLE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Modules that are server-only without following the `.server.ts` suffix, because
 * the platform ships them that way. Listed explicitly (rather than guessed from a
 * doc comment) so the exemption is auditable: `src/lib/db.ts` throws in a browser
 * and opens a connection, and `auth/server.ts` is the Better Auth instance the
 * repo's own docs say must never be imported from client code.
 */
export const SERVER_ONLY_ALLOWLIST = new Set(["src/lib/db.ts", "src/lib/auth/server.ts"]);

/**
 * True when a file can end up in the client bundle.
 *
 * Excluded: `*.server.ts` (the repo's server-only convention), any file named
 * `server.ts`, the allowlist above, `server/` (Nitro middleware), generator output
 * (`routeTree.gen.ts`), and **test files** — a `*.test.ts` is never imported by a
 * route, so it can neither reach the bundle nor leak anything, and it legitimately
 * names vendor hosts in order to assert they are absent.
 */
export function isClientBundled(relPath) {
  const normalized = relPath.split("\\").join("/");
  if (!normalized.startsWith("src/")) return false;
  if (SERVER_ONLY_ALLOWLIST.has(normalized)) return false;
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/\.(test|spec)\.tsx?$/.test(base)) return false;
  if (/\.server\.tsx?$/.test(base)) return false;
  if (base === "server.ts" || base === "server.tsx") return false;
  if (base === "routeTree.gen.ts") return false;
  return true;
}

/**
 * Remove block comments before scanning.
 *
 * Doc comments are where this repo *documents* the boundary — `auth/middleware.ts`
 * shows `import { getSql } from "@/lib/db"` as an example of what not to do — and
 * matching those produced false alarms. Only `/* … *\/` is stripped: stripping `//`
 * line comments would cut a URL at its `//`, which could *hide* a real
 * `https://api.openai.com` leak, so line comments are left intact.
 */
export function stripBlockComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Static (non-type, non-dynamic) imports of a server-only module, found one
 * statement at a time. `import type …` is exempt because it is erased at compile
 * time, and a `await import(…)` inside a handler is the *sanctioned* form — so
 * neither may be reported.
 */
export function findStaticServerImports(text) {
  const hits = [];
  const statementRe = /(?:^|\n)[ \t]*import\b([^;]*);/g;
  let match;
  while ((match = statementRe.exec(text)) !== null) {
    const statement = match[0].trim();
    if (/^import\s+type\b/.test(statement)) continue;
    const from = statement.match(/\bfrom\s*["']([^"']+)["']/);
    const sideEffect = statement.match(/^import\s*["']([^"']+)["']/);
    const specifier = from?.[1] ?? sideEffect?.[1];
    if (!specifier) continue;
    if (/\.server(\.(ts|tsx|js|mjs))?$/.test(specifier)) {
      hits.push({ statement: statement.slice(0, 80), specifier });
    }
  }
  return hits;
}

/**
 * Scan an app root. Returns a list of human-readable violations; an empty array
 * means the browser cannot reach a provider or a credential.
 */
export function scanClientSecrets(appRoot = APP_ROOT) {
  const violations = [];
  const srcDir = join(appRoot, "src");

  let files;
  try {
    files = listFiles(srcDir);
  } catch {
    return [`SECRETS: ${srcDir} not found — cannot verify the client-bundle boundary.`];
  }

  for (const file of files) {
    const rel = relative(appRoot, file).split("\\").join("/");
    const raw = readFileSync(file, "utf8");
    // Scan code, not documentation: doc comments in this repo quote the very
    // examples these rules forbid.
    const text = stripBlockComments(raw);
    const clientFacing = isClientBundled(rel);

    if (clientFacing) {
      for (const hit of findStaticServerImports(text)) {
        violations.push(
          `CLIENT LEAK: ${rel} statically imports the server-only module ` +
            `"${hit.specifier}". Use \`await import(...)\` inside a createServerFn handler or a ` +
            "server route, so the module is never bundled for the browser.",
        );
      }
      if (/from\s+["']([^"']*\/)?lib\/db["']/.test(text)) {
        violations.push(
          `CLIENT LEAK: ${rel} imports the server-only @/lib/db (getSql() throws in a browser); ` +
            "reach it through a server function instead.",
        );
      }
      for (const host of FORBIDDEN_CLIENT_HOSTS) {
        if (text.includes(host)) {
          violations.push(
            `CLIENT LEAK: ${rel} references the provider endpoint ${host}. Provider calls belong in ` +
              "src/lib/ai/providers.server.ts or src/lib/crm/figgy.server.ts (server-only).",
          );
        }
      }
      for (const name of FORBIDDEN_CLIENT_ENV) {
        if (text.includes(name)) {
          violations.push(
            `CLIENT LEAK: ${rel} references the server env var ${name}. Client code must not know ` +
              "secret env names — resolve keys in a server-only module.",
          );
        }
      }
    }

    const credential = raw.match(CREDENTIAL_LITERAL);
    if (credential) {
      violations.push(
        `COMMITTED CREDENTIAL: ${rel} contains a credential-shaped literal ` +
          `(${credential[0].slice(0, 8)}…). Remove it and rotate the key.`,
      );
    }
  }

  // The Vite config decides what is inlined into the client bundle, so a secret
  // added to `define` there would defeat every check above.
  try {
    const viteConfig = readFileSync(join(appRoot, "vite.config.ts"), "utf8");
    for (const name of FORBIDDEN_CLIENT_ENV) {
      if (viteConfig.includes(name)) {
        violations.push(
          `CLIENT LEAK: vite.config.ts references ${name}; never ` +
            "forward a secret through Vite's `define` or a VITE_-prefixed var.",
        );
      }
    }
  } catch {
    /* no vite config to check */
  }

  return violations;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const violations = scanClientSecrets();
  console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
  for (const message of violations) console.error(message);
  process.exitCode = violations.length === 0 ? 0 : 1;
}
