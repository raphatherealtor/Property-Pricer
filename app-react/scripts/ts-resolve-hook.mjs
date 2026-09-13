/**
 * A Node ESM resolve hook for running this app's TypeScript directly under
 * `node --test` (with `--experimental-strip-types`).
 *
 * Two gaps it closes, both of which otherwise make the locked engine untestable
 * outside a bundler:
 *
 *  1. `src/engine/` (a hand-off SDK we must not edit) uses extensionless relative
 *     imports like `../lib/format`. Node's ESM resolver requires an explicit
 *     extension, so the import fails even though TypeScript and Vite accept it.
 *  2. `@/…` path aliases are declared in `tsconfig.json`, which Node does not read.
 *
 * The hook only ever *adds* resolution attempts; anything Node can already resolve
 * is left alone, so a test cannot silently start resolving a different module than
 * the bundler would.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_ROOT = join(APP_ROOT, "src");

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];
const INDEX_SUFFIXES = EXTENSIONS.map((ext) => `/index${ext}`);

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolved(url) {
  return { url: pathToFileURL(url).href, shortCircuit: true };
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = join(SRC_ROOT, specifier.slice(2));
    const hit = firstExisting([base, ...EXTENSIONS.map((e) => base + e), ...INDEX_SUFFIXES.map((s) => base + s)]);
    if (hit) return resolved(hit);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!isRelative || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    const hit = firstExisting([
      ...EXTENSIONS.map((e) => base + e),
      ...INDEX_SUFFIXES.map((s) => base + s),
    ]);
    if (!hit) throw err;
    return resolved(hit);
  }
}
