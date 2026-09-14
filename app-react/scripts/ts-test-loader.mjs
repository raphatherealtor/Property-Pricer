#!/usr/bin/env node
/**
 * Registers `scripts/ts-resolve-hook.mjs` for `node --test` runs.
 *
 * Used as `node --import ./scripts/ts-test-loader.mjs --experimental-strip-types
 * --test src/lib/ai/prompt.test.ts`, which is how the engine-grounded prompt test
 * runs: it needs the real locked engine, whose extensionless relative imports only
 * this hook can resolve.
 */
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);

// Tests run under Node, where the platform's Vite-only `import.meta.glob` DB
// bootstrap (src/lib/db.ts) cannot work. That bootstrap fires as a module-load
// side effect and rejects, which node --test reports as "asynchronous activity
// after the test ended" even when every assertion passed. Pre-seeding its promise
// keeps importing server modules harmless: modules that reach `getSql()` directly
// still fail inside their own best-effort try/catch, but the load-time rejection
// never happens.
(globalThis).__pgBootstrapPromise__ = Promise.resolve();

