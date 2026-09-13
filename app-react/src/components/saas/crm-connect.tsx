import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { EngineOutput } from "@/engine/types";
import { usePricer } from "@/store/pricer";
import { describeApiError } from "@/lib/api/client-error";
import {
  deleteCrmConnection,
  getCrmStatus,
  listCrmSyncLog,
  pushScenarioToCrm,
  rotateCrmWebhookSecret,
  saveCrmConnection,
  type CrmStatus,
} from "@/lib/api/crm";
import type { CrmSyncEventDto } from "@/lib/api/schemas";
import { Empty, KeyValue, Muted, Note, SaasSection, Tag } from "./kit";

/**
 * Figgy AI CRM connector panel.
 *
 * Outbound: the server rebuilds the payload from a fresh engine run and posts it
 * to Figgy, recording a `crm_sync_events` row whether it succeeds or fails.
 * Inbound: Figgy calls this app's webhook, verified with the connection's
 * webhook secret (shown here once per rotation, because the operator has to paste
 * it into Figgy).
 */
export function CrmConnect({ out }: { out: EngineOutput }) {
  const intake = usePricer((s) => s.intake);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const persona = usePricer((s) => s.persona);

  const [status, setStatus] = useState<CrmStatus | null>(null);
  const [events, setEvents] = useState<CrmSyncEventDto[] | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [crm, log] = await Promise.all([getCrmStatus(), listCrmSyncLog({ data: { limit: 15 } })]);
      setStatus(crm);
      setEvents(log);
      setBaseUrl((current) => current || crm.connection?.baseUrl || "");
      setEnabled(crm.connection?.isEnabled ?? true);
      setError(null);
    } catch (err) {
      setStatus(null);
      setEvents(null);
      setError(describeApiError(err).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connection = status?.connection ?? null;
  const webhookUrl =
    connection && typeof window !== "undefined"
      ? `${window.location.origin}${connection.webhookPath}`
      : connection?.webhookPath ?? "";

  const onSave = async () => {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const saved = await saveCrmConnection({ data: {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() === "" ? undefined : apiKey.trim(),
        isEnabled: enabled,
      } });
      setApiKey("");
      setSecretOnce(saved.webhookSecret);
      setNotice("Connection saved.");
      await refresh();
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const onRotate = async () => {
    setBusy("rotate");
    setError(null);
    try {
      const rotated = await rotateCrmWebhookSecret();
      setSecretOnce(rotated.webhookSecret);
      setNotice("Webhook secret rotated — paste the new value into Figgy now.");
      await refresh();
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const onPush = async () => {
    setBusy("push");
    setError(null);
    setPushResult(null);
    try {
      const result = await pushScenarioToCrm({ data: {
        intake,
        lender,
        investor,
        commercial,
        persona,
        name: `${intake.zip || "Scenario"} · ${persona}`,
      } });
      setPushResult(
        result.ok
          ? `Pushed ${result.caseId} to Figgy in ${result.durationMs} ms (HTTP ${result.status}).`
          : `Push failed: ${result.error}`,
      );
      const log = await listCrmSyncLog({ data: { limit: 15 } });
      setEvents(log);
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3">
      <SaasSection
        title="Figgy AI connection"
        hint="One connection per workspace. Used for outbound scenario pushes and to verify inbound webhooks."
        actions={
          <>
            <Tag tone={connection ? (connection.isEnabled ? "good" : "warn") : "info"}>
              {connection ? (connection.isEnabled ? "Connected" : "Disabled") : "Not configured"}
            </Tag>
            <Button size="sm" variant="ghost" title="Reload" onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" />
            </Button>
          </>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Figgy base URL" className="sm:col-span-2" hint={status?.defaultBaseUrl ?? ""}>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={status?.defaultBaseUrl ?? "Figgy API base URL"}
            />
          </Field>
          <Field label="Figgy API key" hint="write-only">
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={connection?.keyHint ?? "your Figgy key"}
            />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-2xs text-ink-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-3.5"
            />
            Connection enabled
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" disabled={busy === "save" || !baseUrl.trim()} onClick={() => void onSave()}>
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save connection
          </Button>
          <Button size="sm" variant="secondary" disabled={!connection || busy === "rotate"} onClick={() => void onRotate()}>
            <KeyRound className="size-3.5" />
            Rotate webhook secret
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!connection}
            onClick={async () => {
              try {
                await deleteCrmConnection();
                setSecretOnce(null);
                await refresh();
              } catch (err) {
                setError(describeApiError(err).message);
              }
            }}
          >
            <Trash2 className="size-3.5 text-red" />
            Remove
          </Button>
        </div>

        {status?.hasEnvKey ? (
          <Note className="mt-2" tone="info">
            A server-side Figgy key is configured, so pushes work even with no key stored
            on this connection.
          </Note>
        ) : null}

        {secretOnce ? (
          <Note tone="warn" className="mt-2">
            <span className="mb-1 block font-semibold">
              Webhook secret — copy it into Figgy now, it will not be shown again.
            </span>
            <code className="num block break-all text-3xs">{secretOnce}</code>
          </Note>
        ) : null}

        {notice ? (
          <Note tone="good" className="mt-2">
            {notice}
          </Note>
        ) : null}
        {error ? (
          <Note tone="bad" className="mt-2">
            {error}
          </Note>
        ) : null}
      </SaasSection>

      <SaasSection title="Push this scenario" hint="The payload is rebuilt server-side from the locked engine before it leaves the app.">
        <div className="rounded-md border border-line bg-panel px-3 py-1.5">
          <KeyValue label="Case id" value={out.caseId} />
          <KeyValue label="Engine" value={`v${out.calcVersion}`} />
          <KeyValue label="Input hash" value={out.inputHash} />
          <KeyValue label="Endpoint" value={status?.scenarioPath ?? "/api/v1/scenarios"} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" disabled={!connection || busy === "push"} onClick={() => void onPush()}>
            {busy === "push" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Push to Figgy
          </Button>
        </div>
        {pushResult ? (
          <Note tone={pushResult.startsWith("Pushed") ? "good" : "bad"} className="mt-2">
            {pushResult}
          </Note>
        ) : null}
      </SaasSection>

      <SaasSection
        title="Inbound webhook"
        hint="Give this URL and the webhook secret to Figgy so it can request a saved scenario or post a note."
      >
        {connection ? (
          <>
            <div className="rounded-md border border-line bg-panel px-3 py-1.5">
              <KeyValue label="URL" value={<span className="break-all">{webhookUrl}</span>} />
              <KeyValue label="Signature header" value="x-figgy-signature: sha256=<hmac>" />
              <KeyValue label="Events" value="handshake · scenario.request · scenario.note" />
              <KeyValue
                label="Secret"
                value={connection.hasWebhookSecret ? "configured" : "missing (refusing inbound)"}
              />
            </div>
            <Muted className="mt-2 flex items-start gap-1.5">
              <Webhook className="mt-px size-3.5 shrink-0 text-ink-2" aria-hidden />
              <span>
                A <code>scenario.request</code> is answered with the stored engine output for the
                matching <code>input_hash</code> or <code>case_id</code>; anything unsigned is
                rejected and logged below.
              </span>
            </Muted>
          </>
        ) : (
          <Empty>Save a connection first to get a webhook URL and secret.</Empty>
        )}
      </SaasSection>

      <SaasSection title="Sync log" hint="Both directions, newest first.">
        {events === null ? (
          <Muted>Loading sync events…</Muted>
        ) : events.length === 0 ? (
          <Empty>No sync events yet.</Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="num text-3xs text-ink-2">
                    {new Date(event.createdAt).toLocaleString()} · {event.direction} · {event.eventType}
                  </p>
                  {event.error ? (
                    <p className="mt-0.5 text-2xs leading-snug text-red">{event.error}</p>
                  ) : null}
                </div>
                <Tag tone={event.status === "succeeded" ? "good" : event.status === "failed" ? "bad" : "warn"}>
                  {event.status}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </SaasSection>
    </div>
  );
}
