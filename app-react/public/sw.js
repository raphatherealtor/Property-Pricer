/* Property Pricer service worker.
 *
 * Classic (non-module) script served from the scope root so it can control "/".
 * Self-contained on purpose: a service worker that imports helpers has a second
 * file to version and can end up running a mismatched pair. The routing table is
 * exposed on `self.__ppSwInternals` purely as a test seam for `node --test`.
 *
 * Strategy, and why:
 *   - Navigations      network-first, cache fallback, then the cached shell →
 *                      a reload always gets fresh SSR HTML online, and the app
 *                      still opens offline.
 *   - Built assets     cache-first for content-hashed build output under
 *                      `/assets/` (safe forever, they are immutable) and for
 *                      small static files (icons, fonts, css).
 *   - Everything else  NOT intercepted. In particular `/api/*`, `/__grok/*`,
 *                      `/_serverFn`, `/__app-env`, and the dev server's module
 *                      graph (`/@*`, `/src/*`, `/node_modules/*`) pass straight
 *                      through: caching any of those would serve stale modules,
 *                      break HMR, or leak authenticated JSON into a shared cache.
 */

const VERSION = "pp-pwa-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

/* Prefixes that must never be cached or served from cache. */
const BYPASS_PREFIXES = [
  "/api/",
  "/__grok/",
  "/__app-env",
  "/_serverFn",
  "/@",
  "/node_modules/",
  "/src/",
];

/* Content-hashed build output lives here. */
const IMMUTABLE_PREFIX = "/assets/";

const STATIC_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".webmanifest",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".txt",
  ".map",
]);

/**
 * Pathname of a request, a URL string, or a bare pathname.
 *
 * Accepting all three matters: the routing table is consulted with `request.url`
 * from the fetch handler AND with `url.pathname` in `decideStrategy`. Treating a
 * bare pathname as an un-parseable URL would mark every navigation as unknown and
 * silently bypass caching for the whole app.
 */
function pathOf(input) {
  if (typeof input === "string") {
    if (input.startsWith("/")) return input.split("?")[0].split("#")[0];
    try {
      return new URL(input).pathname;
    } catch {
      return "/";
    }
  }
  try {
    return new URL(input && input.url ? input.url : String(input)).pathname;
  } catch {
    return "/";
  }
}

/** True when this path must never touch the cache layer. */
function shouldBypass(input) {
  const path = pathOf(input);
  if (path === "/sw.js") return true;
  return BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function hasStaticExtension(path) {
  const dot = path.lastIndexOf(".");
  if (dot <= 0) return false;
  return STATIC_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Routing decision for one request.
 *
 *   "bypass"       leave it to the network, untouched
 *   "document"     network-first navigation with an offline shell fallback
 *   "cache-first"  serve from cache when present, else fetch and store
 *   "network"      not worth intercepting (non-GET, cross-origin, odd paths)
 */
function decideStrategy(request) {
  if (!request || request.method !== "GET") return "network";

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "network";
  }
  if (url.origin !== self.location.origin) return "network";
  if (shouldBypass(url.pathname)) return "bypass";
  if (request.mode === "navigate") return "document";
  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) return "cache-first";
  if (hasStaticExtension(url.pathname)) return "cache-first";
  return "network";
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing asset cannot fail the whole install.
      await Promise.all(
        SHELL_PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (err) {
            // A 404 here (e.g. an icon renamed without regenerating this list)
            // must not block installation; the app still works online.
            console.warn("[sw] precache miss", url, err && err.message);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (keep.has(name) ? undefined : caches.delete(name))),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ------------------------------------------------------------------ *
 * Fetch
 * ------------------------------------------------------------------ */

async function networkFirstDocument(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline (or the request was aborted): fall back to the cached document,
    // then to the cached shell, then to an inline notice.
    const cached = (await cache.match(request)) ?? (await cache.match("/"));
    if (cached) return cached;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Offline</title>" +
        "<body style=\"font-family:system-ui;background:#0B1220;color:#E8EDF7;padding:2rem\">" +
        "<h1 style=\"font-size:1.1rem\">Property Pricer is offline</h1>" +
        "<p style=\"color:#8FA1C0;font-size:.9rem\">Reconnect once to cache the app shell, " +
        "then this screen will open the last scenario you had loaded.</p>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const strategy = decideStrategy(event.request);
  if (strategy === "document") {
    event.respondWith(networkFirstDocument(event.request));
    return;
  }
  if (strategy === "cache-first") {
    event.respondWith(cacheFirst(event.request));
  }
  // "bypass" / "network" intentionally fall through: the network handles them.
});

/* Test seam (harmless at runtime): lets `node --test` drive the routing table
 * and the precache list without a browser. */
self.__ppSwInternals = {
  VERSION,
  SHELL_CACHE,
  ASSET_CACHE,
  SHELL_PRECACHE,
  BYPASS_PREFIXES,
  IMMUTABLE_PREFIX,
  shouldBypass,
  hasStaticExtension,
  decideStrategy,
  networkFirstDocument,
  cacheFirst,
};
