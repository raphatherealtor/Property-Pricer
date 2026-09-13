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
