import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPLE_TOUCH_ICON,
  APP_MANIFEST_PATH,
  PWA_ICONS,
  SHELL_PRECACHE,
  SW_BYPASS_PREFIXES,
  renderManifestJson,
  shortNameFor,
  swShouldBypass,
} from "./pwa-manifest.mjs";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function publicFile(rel) {
  return join(APP_ROOT, "public", rel.replace(/^\//, ""));
}

/** Minimal PNG header reader: signature + IHDR width/height. */
function readPngSize(path) {
  const buf = readFileSync(path);
  assert.equal(
    buf.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${path} is not a PNG`,
  );
  assert.equal(buf.subarray(12, 16).toString("latin1"), "IHDR", `${path} has no IHDR`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

test("public/manifest.webmanifest matches the manifest builder", () => {
  const onDisk = readFileSync(publicFile(APP_MANIFEST_PATH), "utf8");
  assert.equal(
    onDisk,
    renderManifestJson(),
    "public/manifest.webmanifest has drifted from scripts/pwa-manifest.mjs — " +
      "run `node scripts/generate-pwa-icons.mjs` to regenerate it",
  );
});

test("manifest carries everything an installer requires", () => {
  const manifest = JSON.parse(renderManifestJson());
  assert.ok(manifest.name.length > 0, "name is required for installability");
  assert.ok(manifest.short_name.length <= 12, "short_name must fit a Home Screen label");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
  assert.equal(manifest.id, "/");
});

test("manifest declares the icon sizes browsers demand at install time", () => {
  const manifest = JSON.parse(renderManifestJson());
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192"), "Chrome/Edge require a 192px icon");
  assert.ok(sizes.includes("512x512"), "Chrome/Edge require a 512px icon");
  assert.ok(
    manifest.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"),
    "Android adaptive icons need a maskable 512px entry",
  );
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/[A-Za-z0-9._/-]+\.png$/);
    assert.equal(icon.type, "image/png");
  }
});

test("every declared icon exists and its real pixel size matches its declared size", () => {
  for (const icon of PWA_ICONS) {
    const path = publicFile(icon.src);
    assert.ok(statSync(path).isFile(), `${icon.src} is declared in the manifest but missing`);
    const [w, h] = icon.sizes.split("x").map(Number);
    const actual = readPngSize(path);
    assert.equal(actual.width, w, `${icon.src} width`);
    assert.equal(actual.height, h, `${icon.src} height`);
    assert.ok(actual.bytes > 400, `${icon.src} looks empty`);
  }
});

test("the apple-touch icon and the platform icon path hold the same branded art", () => {
  const appIcon = readPngSize(publicFile(APPLE_TOUCH_ICON.src));
  assert.equal(appIcon.width, 180);
  assert.equal(appIcon.height, 180);
  // The platform head injector points at /__grok/icon-180.png; writing the same
  // render there means iOS gets the app icon whichever link it honors.
  const platform = publicFile("/__grok/icon-180.png");
  assert.deepEqual(
    readFileSync(platform),
    readFileSync(publicFile(APPLE_TOUCH_ICON.src)),
    "/__grok/icon-180.png must be byte-identical to the generated apple-touch icon",
  );
});

test("shortNameFor keeps labels short and picks the identifying word", () => {
  assert.equal(shortNameFor("Property Pricer"), "Pricer");
  assert.equal(shortNameFor("Pricer"), "Pricer");
  assert.equal(shortNameFor(""), "Pricer");
  assert.ok(shortNameFor("A Very Long Product Name Indeed").length <= 12);
});

/* ------------------------------------------------------------------ *
 * Service worker
 * ------------------------------------------------------------------ */

/**
 * Load `public/sw.js` into a fake ServiceWorkerGlobalScope. `fetchImpl` is
 * injectable so the offline path can be exercised with a failing fetch.
 */
function loadServiceWorker(fetchImpl) {
  const listeners = new Map();
  const cache = {
    add: async () => {},
    put: async () => {},
    match: async () => undefined,
  };
  const fakeCaches = {
    open: async () => cache,
    keys: async () => ["pp-pwa-v1-shell"],
    delete: async () => true,
  };
  const self = {
    location: { origin: "https://pricer.test" },
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const source = readFileSync(publicFile("/sw.js"), "utf8");
  const doFetch = fetchImpl ?? (async () => new Response("ok", { status: 200 }));
  // Evaluating the worker inside a sandbox is the point of this harness.
  const run = new Function("self", "caches", "fetch", source);
  run(self, fakeCaches, doFetch);

  const internals = self.__ppSwInternals;
  assert.ok(internals, "sw.js must expose __ppSwInternals for these checks");

  const dispatch = (type, event) => {
    for (const handler of listeners.get(type) ?? []) handler(event);
  };
  return { self, internals, listeners, dispatch };
}

/**
 * A request stand-in. A real `Request` cannot be constructed with
 * `mode: "navigate"` (the fetch spec reserves it for the browser), and the
 * worker's routing only ever reads `url`, `method` and `mode`.
 */
function req(url, { method = "GET", mode = "cors" } = {}) {
  return { url, method, mode };
}

function fakeFetchEvent(url, init = {}) {
  const event = {
    request: req(url, init),
    respondedWith: null,
    respondWith(response) {
      this.respondedWith = response;
    },
    waitUntil() {},
  };
  return event;
}

test("the service worker registers the lifecycle and fetch listeners", () => {
  const { listeners } = loadServiceWorker();
  for (const type of ["install", "activate", "fetch", "message"]) {
    assert.ok((listeners.get(type) ?? []).length > 0, `sw.js must handle "${type}"`);
  }
});

test("its precache list matches the shared manifest's shell list", () => {
  const { internals } = loadServiceWorker();
  assert.deepEqual(
    internals.SHELL_PRECACHE,
    SHELL_PRECACHE,
    "public/sw.js and scripts/pwa-manifest.mjs disagree about the offline shell",
  );
  assert.ok(internals.SHELL_PRECACHE.includes("/"), "the offline shell must cache the app document");
});

test("its bypass list matches the shared module's", () => {
  const { internals } = loadServiceWorker();
  assert.deepEqual(internals.BYPASS_PREFIXES, SW_BYPASS_PREFIXES);
  for (const prefix of SW_BYPASS_PREFIXES) {
    assert.equal(swShouldBypass(`${prefix}anything`), true, `${prefix} must be bypassed`);
  }
  // Regression guard: the worker consults this with a bare pathname, and treating
  // a pathname as an un-parseable URL would bypass caching for the whole app.
  assert.equal(internals.shouldBypass("/"), false, "the app document must be cacheable");
  assert.equal(internals.shouldBypass("/assets/x.js"), false);
  assert.equal(internals.shouldBypass("/api/ai"), true);
});

test("routing: API, platform, auth and dev-module traffic is never intercepted", () => {
  const { internals } = loadServiceWorker();
  const bypassed = [
    "https://pricer.test/api/auth/get-session",
    "https://pricer.test/api/crm/figgy/webhook?connection=abc",
    "https://pricer.test/__grok/manifest.webmanifest",
    "https://pricer.test/_serverFn/xyz",
    "https://pricer.test/__app-env",
    "https://pricer.test/@vite/client",
    "https://pricer.test/src/components/app.tsx",
    "https://pricer.test/node_modules/.vite/deps/react.js",
    "https://pricer.test/sw.js",
  ];
  for (const url of bypassed) {
    assert.equal(internals.shouldBypass(url), true, `${url} must bypass the cache`);
    assert.equal(internals.decideStrategy(req(url)), "bypass", `${url} must not be intercepted`);
  }
});

test("routing: navigations are network-first and build assets are cache-first", () => {
  const { internals } = loadServiceWorker();
  assert.equal(internals.decideStrategy(req("https://pricer.test/", { mode: "navigate" })), "document");
  assert.equal(
    internals.decideStrategy(req("https://pricer.test/assets/index-QtqlVaO_.js")),
    "cache-first",
  );
  assert.equal(
    internals.decideStrategy(req("https://pricer.test/icons/icon-192.png")),
    "cache-first",
  );
  assert.equal(internals.decideStrategy(req("https://pricer.test/", { method: "POST" })), "network");
  assert.equal(
    internals.decideStrategy(req("https://cdn.example.com/thing.js")),
    "network",
    "cross-origin requests are left alone",
  );
});

test("the fetch listener stays out of the way of bypassed requests", () => {
  const { dispatch } = loadServiceWorker();

  const api = fakeFetchEvent("https://pricer.test/api/auth/get-session");
  dispatch("fetch", api);
  assert.equal(api.respondedWith, null, "an API request must not be answered by the worker");

  const devModule = fakeFetchEvent("https://pricer.test/src/components/app.tsx");
  dispatch("fetch", devModule);
  assert.equal(devModule.respondedWith, null, "dev module traffic must reach the dev server");

  const navigation = fakeFetchEvent("https://pricer.test/", { mode: "navigate" });
  dispatch("fetch", navigation);
  assert.ok(navigation.respondedWith, "a navigation must be served by the worker's offline path");
});

test("offline fallback still renders a usable page when nothing is cached", async () => {
  const { internals } = loadServiceWorker();
  const online = await internals.networkFirstDocument(
    req("https://pricer.test/", { mode: "navigate" }),
  );
  assert.ok(online instanceof Response, "the online path must return the fetched response");

  const offlineWorker = loadServiceWorker(async () => {
    throw new Error("offline");
  });
  const offline = await offlineWorker.internals.networkFirstDocument(
    req("https://pricer.test/", { mode: "navigate" }),
  );
  assert.equal(offline.status, 200);
  const body = await offline.text();
  assert.match(body, /Property Pricer is offline/);
});
