/**
 * Install + connectivity state for the PWA surface (CLIENT-ONLY).
 *
 * Two things the UI needs that the platform does not provide:
 *
 *  1. **Whether the app is already installed / can be installed.** Chromium
 *     fires `beforeinstallprompt`, which must be captured and replayed from a
 *     user gesture; Safari never fires it and requires the manual
 *     Share → "Add to Home Screen" flow instead. Android/desktop and iOS
 *     therefore need different copy, decided here rather than in the component.
 *  2. **Whether we are online.** `navigator.onLine` plus the `online`/`offline`
 *     events, so the shell can say plainly that the last local scenario is what
 *     is on screen.
 */

export type InstallPlatform = "ios" | "android" | "desktop" | "unknown";

export type InstallState = {
  platform: InstallPlatform;
  /** True when the app is already running as an installed app. */
  installed: boolean;
  /** True when a captured `beforeinstallprompt` can still be replayed. */
  canPrompt: boolean;
  /** One-line instruction for the current platform. */
  guidance: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeInstallState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Attach the platform listeners once, from a client effect. */
export function initInstallCapture(): () => void {
  if (typeof window === "undefined") return () => {};

  const onPrompt = (event: Event) => {
    // Keep the event so the "Install app" button can replay it from a gesture.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  };
  const onInstalled = () => {
    deferredPrompt = null;
    notify();
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

function detectPlatform(nav: Navigator, win: Window): InstallPlatform {
  const ua = nav.userAgent ?? "";
  // iPadOS 13+ reports a desktop UA, so the touch-point count is the tell.
  const iPadOs = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(ua) && !/Mobile/.test(ua)) return "desktop";
  void win;
  return "unknown";
}

function isStandalone(nav: Navigator, win: Window): boolean {
  if (typeof win.matchMedia === "function" && win.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  // iOS Safari exposes its own flag rather than honoring display-mode.
  return (nav as Navigator & { standalone?: boolean }).standalone === true;
}

export function readInstallState(): InstallState {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      platform: "unknown",
      installed: false,
      canPrompt: false,
      guidance: "Open this app in a browser to install it.",
    };
  }
  const platform = detectPlatform(navigator, window);
  const installed = isStandalone(navigator, window);
  const canPrompt = deferredPrompt !== null;

  let guidance: string;
  if (installed) {
    guidance = "Installed — launching from the home screen or dock opens the standalone app.";
  } else if (platform === "ios") {
    guidance =
      "On iPhone/iPad: tap Share, then “Add to Home Screen”. Safari does not expose an install button to web apps.";
  } else if (platform === "android") {
    guidance = canPrompt
      ? "Tap Install app, or use Chrome’s ⋮ menu → “Install app”."
      : "Use Chrome’s ⋮ menu → “Add to Home screen”.";
  } else if (platform === "desktop") {
    guidance = canPrompt
      ? "Tap Install app, or use the install icon in the address bar."
      : "Use your browser’s install icon in the address bar.";
  } else {
    guidance = "Use your browser’s “Install app” / “Add to Home screen” menu item.";
  }

  return { platform, installed, canPrompt, guidance };
}

/** Replay the captured install prompt. Returns false when none is available. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    notify();
    return choice.outcome === "accepted";
  } catch {
    notify();
    return false;
  }
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function subscribeOnline(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
