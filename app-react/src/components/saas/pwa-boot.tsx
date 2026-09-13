import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  activateWaitingWorker,
  registerServiceWorker,
  type RegistrationOutcome,
} from "@/lib/pwa/register";
import { initInstallCapture, isOnline, subscribeOnline } from "@/lib/pwa/install";

/**
 * Client boot for the installable-app layer. Mounted once from the root route, so
 * it runs on every page and before any install affordance is offered.
 *
 * It renders nothing except two small, self-dismissing status strips:
 *
 *  - a "new build ready" bar when the service worker has an update waiting, and
 *  - an offline strip so it is obvious that what is on screen is the locally
 *    persisted scenario rather than a live cloud read.
 *
 * Everything is guarded for SSR: no `navigator`/`window` access during render.
 */
export function PwaBoot() {
  const [registration, setRegistration] = useState<RegistrationOutcome>({
    state: "registering",
    scope: null,
    detail: null,
  });

  useEffect(() => {
    const stopCapture = initInstallCapture();
    registerServiceWorker({ onChange: setRegistration });
    return stopCapture;
  }, []);

  const online = useSyncExternalStore(
    subscribeOnline,
    isOnline,
    () => true, // server render: assume online, never flash the offline strip
  );

  const updateWaiting = registration.state === "update-available";

  if (online && !updateWaiting) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3">
      <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2 text-2xs shadow-border backdrop-blur-md border-amber/30 bg-amber-soft text-ink-2">
        {!online ? (
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber" aria-hidden />
            <span>
              <strong className="font-semibold">Offline.</strong> Showing your last
              locally saved scenario. The pricing engine runs on-device, so the desk
              and deck stay live.
            </span>
          </span>
        ) : null}
        {updateWaiting ? (
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-blue" aria-hidden />
            <span>{registration.detail ?? "A new build is ready."}</span>
            <button
              type="button"
              className={cn("underline underline-offset-2 hover:text-ink")}
              onClick={() => {
                activateWaitingWorker();
                window.location.reload();
              }}
            >
              Reload
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
