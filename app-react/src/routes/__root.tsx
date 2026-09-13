import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { PwaBoot } from "@/components/saas/pwa-boot";
import appCss from "../styles.css?url";

const APP_NAME = "Property Pricer";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // `viewport-fit=cover` lets the standalone app paint under the notch/status
      // bar on iOS instead of letterboxing itself.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Institutional property pricing diagnostic — survival-analysis engine, desk workbench, and client deck.",
      },
      { name: "theme-color", content: "#0B1220" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      // The app's own manifest. Declared FIRST because a document may only have
      // one effective manifest — the browser honors the first `rel="manifest"`
      // link — and because `public/manifest.webmanifest` is a static file, it is
      // served identically by the dev server, `vite preview`, and the CDN. The
      // platform's manifest follows so its own head-injection dedupe still finds
      // its tag; browsers ignore the second declaration.
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      // Branded 180px art (written by scripts/generate-pwa-icons.mjs). The
      // platform's `/__grok/icon-180.png` is written from the same render, so
      // whichever link a browser picks, iOS gets the app icon rather than the
      // platform placeholder.
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/icons/apple-touch-icon-180.png",
      },
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@500;600;700&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <PreviewHostBridge />
        {/* Registers the service worker, captures the install prompt, and warns
            when the shell is running offline or a new build is waiting. */}
        <PwaBoot />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
