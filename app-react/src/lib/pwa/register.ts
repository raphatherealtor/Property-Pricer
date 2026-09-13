/**
 * Service-worker registration (CLIENT-ONLY).
 *
 * Runs in both dev and production on purpose. The worker itself decides what is
 * safe to cache — navigations are network-first and the dev server's module graph
 * (`/@*`, `/src/*`, `/node_modules/*`) is never touched — so a registered worker
 * cannot serve stale modules to a running dev session. What it *does* buy in dev
 * is a cached navigation, so the shell still opens offline.
 *
 * Everything here is defensive: a browser that blocks service workers (private
 * mode, an embedded preview iframe, an insecure origin) must degrade to a normal
 * online-only app, never to a broken one. Failures are swallowed and reported
 * through a callback, not thrown into a React tree.
 */

export type ServiceWorkerState =
  | "unsupported"
  | "registering"
  | "ready"
  | "update-available"
  | "error";

export type RegistrationOutcome = {
  state: ServiceWorkerState;
  scope: string | null;
  /** Human-readable detail for the UI; never contains a stack trace. */
  detail: string | null;
};

export type RegisterOptions = {
  /** Notified on every state change, including the initial one. */
  onChange?: (outcome: RegistrationOutcome) => void;
  /** Force a waiting worker to activate immediately. */
  onNeedRefresh?: () => void;
};

/** True when this environment can host a service worker at all. */
export function serviceWorkerSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  // `https`, or the loopback exception the spec grants for local development.
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  return (
    protocol === "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

let registered = false;

/**
 * Last reported outcome, so a caller that mounts after registration (or a second
 * mount under StrictMode) can render the current state without re-registering.
 */
let lastOutcome: RegistrationOutcome = {
  state: "unsupported",
  scope: null,
  detail: null,
};

/**
 * Register `/sw.js`. Safe to call more than once (React StrictMode double-invokes
 * effects); only the first call does work.
 */
export function registerServiceWorker(options: RegisterOptions = {}): void {
  const report = (outcome: RegistrationOutcome) => {
    lastOutcome = outcome;
    options.onChange?.(outcome);
  };

  if (!serviceWorkerSupported()) {
    report({
      state: "unsupported",
      scope: null,
      detail:
        "Service workers need a secure origin — the offline shell is unavailable in this context.",
    });
    return;
  }
  if (registered) {
    options.onChange?.(lastOutcome);
    return;
  }
  registered = true;
  report({ state: "registering", scope: null, detail: null });

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });

      const announce = () => {
        if (registration.waiting) {
          report({
            state: "update-available",
            scope: registration.scope,
            detail: "A new build is ready — reload to pick it up.",
          });
          options.onNeedRefresh?.();
          return;
        }
        report({
          state: "ready",
          scope: registration.scope,
          detail: null,
        });
      };

      announce();
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") announce();
        });
      });

      // A first-ever load has no controller until the worker claims clients;
      // re-announce then so the UI stops saying "registering".
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        report({
          state: "ready",
          scope: registration.scope,
          detail: null,
        });
      });
    } catch (err) {
      report({
        state: "error",
        scope: null,
        detail: err instanceof Error ? err.message : "Service worker registration failed.",
      });
    }
  };

  void register();
}

/** Activate a waiting worker now (used by the "Reload to update" affordance). */
export function activateWaitingWorker(): void {
  if (!serviceWorkerSupported()) return;
  void navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
}
