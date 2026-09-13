/**
 * Single source of truth for the installable-app manifest.
 *
 * Plain ESM so four consumers share it without a build step: the icon generator
 * (`scripts/generate-pwa-icons.mjs`), the emit step that writes
 * `public/manifest.webmanifest`, and `node --test`.
 *
 * Why the app ships its **own** manifest instead of extending the platform's:
 * `scripts/grok-pwa-shared.mjs` serves `/__grok/manifest.webmanifest` from a
 * per-request handler (a Vite plugin in dev, a Nitro middleware when deployed).
 * Rewriting that response would mean depending on plugin/middleware registration
 * order in two different runtimes — a silent way to end up non-installable in
 * production only. A static file under `public/` is served identically by the dev
 * server, `vite preview`, and the CDN, so the manifest is deterministic
 * everywhere. The document declares this manifest **first**; per the HTML spec
 * only the first `rel="manifest"` link is honored, and the platform's link is
 * kept after it so the platform's own head-injection dedupe still sees its tag.
 */
import { DEFAULT_APP_NAME } from "./grok-pwa-shared.mjs";

/** Our manifest. Declared first in the document head; see the note above. */
export const APP_MANIFEST_PATH = "/manifest.webmanifest";

export const APP_NAME = "Property Pricer";
export const APP_SHORT_NAME = "Pricer";
export const THEME_COLOR = "#0B1220";
export const BACKGROUND_COLOR = "#0B1220";
export const APP_DESCRIPTION =
  "Deterministic property pricing diagnostic: survival-analysis engine, desk workbench, client deck, and CRM-ready exports.";

/**
 * Icon files written by `scripts/generate-pwa-icons.mjs`. Every size a browser
 * asks for during install is present: Chrome/Edge want 192 + 512, Android wants a
 * `maskable` 512, and iOS reads the apple-touch link rather than the manifest.
 */
export const PWA_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

/**
 * iOS uses the `apple-touch-icon` link for the Home Screen, not the manifest.
 * The platform head injector emits `href="/__grok/icon-180.png"` unless that
 * exact href is already present — so the branded art is written to that same
 * path by the generator (see `PLATFORM_APPLE_ICON`), giving iOS correct art with
 * exactly one link and no middleware override.
 */
export const APPLE_TOUCH_ICON = {
  src: "/icons/apple-touch-icon-180.png",
  sizes: "180x180",
};

/** The path the platform injector points at; the generator writes art here too. */
export const PLATFORM_APPLE_ICON = {
  src: "/__grok/icon-180.png",
  sizes: "180x180",
};

/** Precache list for the service worker, in install order. */
export const SHELL_PRECACHE = [
  "/",
  APP_MANIFEST_PATH,
  "/favicon.svg",
  ...PWA_ICONS.map((i) => i.src),
  APPLE_TOUCH_ICON.src,
];

/**
 * `short_name` must stay short enough for a Home Screen label. For a multi-word
 * product name the last word is the noun that identifies it ("Property Pricer" →
 * "Pricer"), so that is preferred over a truncation; anything still too long is
 * cut at a word boundary rather than mid-word.
 */
export function shortNameFor(name) {
  const clean = String(name ?? "").trim();
  if (!clean) return APP_SHORT_NAME;
  if (clean.length <= 12) return clean;
  const words = clean.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && last.length <= 12) return last;
  const first = words[0];
  if (first && first.length <= 12) return first;
  return clean.slice(0, 12).trim();
}

/**
 * The full manifest. `name` is parameterized so a published deploy can adopt the
 * platform's host-derived app name (`property-pricer.grok.me` → "Property
 * Pricer") while local dev keeps our own branding instead of the platform's
 * generic `DEFAULT_APP_NAME` placeholder.
 */
export function buildPwaManifest(platformName) {
  const candidate = String(platformName ?? "").trim();
  const name = !candidate || candidate === DEFAULT_APP_NAME ? APP_NAME : candidate;

  return {
    id: "/",
    name,
    short_name: shortNameFor(name),
    description: APP_DESCRIPTION,
    lang: "en-US",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    categories: ["business", "finance", "productivity"],
    prefer_related_applications: false,
    icons: [...PWA_ICONS],
    shortcuts: [
      {
        name: "Engine self-test",
        short_name: "Self-test",
        description: "Run the locked engine assertions on this device.",
        url: "/?selftest=1",
      },
    ],
  };
}

export function renderManifestJson(platformName) {
  return `${JSON.stringify(buildPwaManifest(platformName), null, 2)}\n`;
}

/**
 * Paths the service worker must never cache or intercept: session/API traffic,
 * the platform chrome, the install tutorial, and — critically — the dev server's
 * module graph, where a cached response breaks HMR and serves stale modules.
 * Mirrored in `public/sw.js`; `scripts/pwa.test.mjs` asserts the two agree.
 */
export const SW_BYPASS_PREFIXES = [
  "/api/",
  "/__grok/",
  "/__app-env",
  "/_serverFn",
  "/@",
  "/node_modules/",
  "/src/",
];

export function swShouldBypass(pathname) {
  const path = String(pathname ?? "");
  if (path === "/sw.js") return true;
  return SW_BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}
