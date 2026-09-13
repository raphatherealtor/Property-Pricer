import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Download,
  HardDriveDownload,
  KeyRound,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePricer } from "@/store/pricer";
import { cn } from "@/lib/utils";
import { describeApiError } from "@/lib/api/client-error";
import { getCloudStatus, listProperties } from "@/lib/api/cloud";
import type { CloudStatusDto, PropertyDto } from "@/lib/api/schemas";
import {
  initInstallCapture,
  isOnline,
  promptInstall,
  readInstallState,
  subscribeInstallState,
  subscribeOnline,
  type InstallState,
} from "@/lib/pwa/install";
import { KeyValue, Muted, Note, SaasSection, Tag } from "./kit";

const SERVER_RENDER_STATE: InstallState = {
  platform: "unknown",
  installed: false,
  canPrompt: false,
  guidance: "Open this app in a browser to install it.",
};

function formatStamp(iso: string | null): string {
  if (!iso) return "not saved yet";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "not saved yet";
  return at.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Install + offline status, and exactly where the local scenario lives.
 *
 * The "last local scenario persists" promise is worth showing rather than
 * assuming: the operator can see the timestamp of the last local write, which is
 * what the offline shell will restore.
 */
export function InstallCard() {
  const savedAt = usePricer((s) => s.savedAt);
  const persona = usePricer((s) => s.persona);
  const zip = usePricer((s) => s.intake.zip);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<CloudStatusDto | null>(null);
  const [properties, setProperties] = useState<PropertyDto[] | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => initInstallCapture(), []);

  useEffect(() => {
    let cancelled = false;
    // Best-effort: the install/offline half of this tab works without a session,
    // so a cloud failure is shown as a note rather than blocking the panel.
    void (async () => {
      try {
        const [cloud, props] = await Promise.all([getCloudStatus(), listProperties()]);
        if (cancelled) return;
        setStatus(cloud);
        setProperties(props);
      } catch (err) {
        if (cancelled) return;
        setCloudError(describeApiError(err).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useSyncExternalStore(
    subscribeInstallState,
    readInstallState,
    () => SERVER_RENDER_STATE,
  );
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);

  const PlatformIcon = install.platform === "desktop" ? HardDriveDownload : Smartphone;

  return (
    <div className="grid gap-3">
      <SaasSection
        title="Install on this device"
        hint="Installs as a standalone app window and keeps working without a connection."
        actions={
          <>
            <Tag tone={install.installed ? "good" : "info"}>
              {install.installed ? "Installed" : `${install.platform} browser`}
            </Tag>
            <Tag tone={online ? "good" : "warn"}>{online ? "Online" : "Offline"}</Tag>
          </>
        }
      >
        <div className="flex flex-wrap items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-md border",
              install.installed ? "border-teal/30 bg-teal-soft" : "border-line bg-panel",
            )}
            aria-hidden
          >
            <PlatformIcon className="size-5 text-ink-2" />
          </div>
          <div className="min-w-0 flex-1">
            <Muted>{install.guidance}</Muted>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="primary"
                disabled={!install.canPrompt || installing || install.installed}
                onClick={() => {
                  setInstalling(true);
                  void promptInstall().finally(() => setInstalling(false));
                }}
              >
                <Download className="size-3.5" />
                {install.installed ? "Already installed" : "Install app"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  window.open("/?install=1&platform=ios", "_blank", "noopener");
                }}
                title="Opens the platform's Add-to-Home-Screen tutorial"
              >
                iOS instructions
              </Button>
            </div>
            {install.platform === "ios" && !install.installed ? (
              <Note tone="warn" className="mt-2">
                Safari only offers Add to Home Screen through the Share sheet — no web
                app can trigger it programmatically.
              </Note>
            ) : null}
          </div>
        </div>
      </SaasSection>

      <SaasSection
        title="Local scenario"
        hint="Written to this browser's storage on every change, so a reload or a dropped connection restores it."
        actions={<Tag tone={savedAt ? "good" : "warn"}>{savedAt ? "Saved locally" : "Pending"}</Tag>}
      >
        <div className="rounded-md border border-line bg-panel px-3 py-1.5">
          <KeyValue label="Last local write" value={formatStamp(savedAt)} />
          <KeyValue label="Persona" value={persona} />
          <KeyValue label="ZIP" value={zip || "—"} />
        </div>
        <Muted className="mt-2 flex items-start gap-1.5">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-teal" aria-hidden />
          <span>
            Only inputs are stored locally. Every number on screen is recomputed on the
            device by the locked v1.6 engine, and again server-side before anything is
            saved or sent to an AI provider.
          </span>
        </Muted>
      </SaasSection>

      <SaasSection
        title="Workspace"
        hint="Server-side state for this install: saved scenarios, provider keys, and the CRM connection."
        actions={
          <Tag tone={status ? "good" : cloudError ? "warn" : "info"}>
            {status ? "Connected" : cloudError ? "Unavailable" : "Checking…"}
          </Tag>
        }
      >
        {cloudError ? (
          <Note tone="warn">{cloudError}</Note>
        ) : !status ? (
          <Muted>Loading workspace…</Muted>
        ) : (
          <>
            <div className="rounded-md border border-line bg-panel px-3 py-1.5">
              <KeyValue label="Workspace" value={status.workspace.workspaceName} />
              <KeyValue label="Signed in as" value={status.workspace.email} />
              <KeyValue
                label="AI providers"
                value={`${status.providers.filter((p) => p.hasKey).length} with a key / ${status.providers.length} configured`}
              />
              <KeyValue
                label="Figgy CRM"
                value={status.crm ? (status.crm.isEnabled ? "connected" : "disabled") : "not configured"}
              />
              <KeyValue
                label="Properties"
                value={properties === null ? "—" : String(properties.length)}
              />
            </div>

            {/* The credential vault falls back to a process-local key when no
                encryption key is configured, so a stored provider key would stop
                decrypting after a restart. Say so before an operator relies on it.
                The variable is deliberately NOT named here: this file is
                client-bundled, and `scripts/check-no-client-secrets.mjs` fails the
                build if a browser-bound file names a secret env var. The operator
                finds the name in PRICER-SAAS.md, server-side. */}
            {status.vaultDurable ? (
              <Muted className="mt-2 flex items-start gap-1.5">
                <KeyRound className="mt-px size-3.5 shrink-0 text-teal" aria-hidden />
                <span>
                  Provider and CRM keys are encrypted with a key from the deployment's server
                  environment, so they survive restarts.
                </span>
              </Muted>
            ) : (
              <Note tone="warn" className="mt-2">
                No server-side encryption key is configured, so the credential vault is using a
                key that only lives for this server process. Keys saved now will stop decrypting
                after a restart — set the variable documented for this deployment before storing
                credentials you intend to keep.
              </Note>
            )}

            {properties && properties.length > 0 ? (
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
                {properties.slice(0, 5).map((property) => (
                  <li key={property.id} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                    <span className="truncate text-2xs text-ink">
                      {property.address ?? "(no street address)"}
                      {property.city ? `, ${property.city}` : ""}
                      {property.state ? ` ${property.state}` : ""}
                    </span>
                    <span className="num shrink-0 text-3xs text-ink-2">{property.zip ?? "—"}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </SaasSection>
    </div>
  );
}
