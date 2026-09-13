import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { EngineOutput } from "@/engine/types";
import { usePricer } from "@/store/pricer";
import { describeApiError } from "@/lib/api/client-error";
import {
  deleteAiProvider,
  listAiProviders,
  listAiRunHistory,
  runScenarioAi,
  saveAiProvider,
} from "@/lib/api/ai";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  AI_PURPOSE_LABELS,
  AI_PURPOSES,
  type AiProviderDto,
  type AiProviderId,
  type AiPurpose,
  type AiRunDto,
} from "@/lib/api/schemas";
import { Empty, KeyValue, Muted, Note, SaasSection, Tag } from "./kit";

/**
 * AI narrative panel.
 *
 * The browser sends engine **inputs**, never numbers and never a credential. The
 * server re-prices them with the locked engine, builds the prompt from that
 * output, resolves the provider key from the encrypted vault, calls the vendor,
 * records the run, and returns text plus provenance. This component only ever
 * sees `text`, `model`, and `calcVersion`/`inputHash` — which is exactly why the
 * returned narrative can be traced back to an engine version.
 */
export function AiCopilot({ out }: { out: EngineOutput }) {
  const intake = usePricer((s) => s.intake);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const persona = usePricer((s) => s.persona);

  const [providers, setProviders] = useState<AiProviderDto[] | null>(null);
  const [runs, setRuns] = useState<AiRunDto[] | null>(null);
  const [purpose, setPurpose] = useState<AiPurpose>("explain");
  const [providerId, setProviderId] = useState<string | "auto">("auto");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    | { text: string; provider: string; model: string; calcVersion: string; inputHash: string; latencyMs: number }
    | null
  >(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, history] = await Promise.all([
        listAiProviders(),
        listAiRunHistory({ data: { limit: 10 } }),
      ]);
      setProviders(list);
      setRuns(history);
      setError(null);
    } catch (err) {
      setProviders(null);
      setRuns(null);
      setError(describeApiError(err).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRun = async () => {
    setBusy("run");
    setError(null);
    try {
      const response = await runScenarioAi({ data: {
        intake,
        lender,
        investor,
        commercial,
        persona,
        purpose,
        providerId: providerId === "auto" ? undefined : providerId,
        question: purpose === "chat" ? question : undefined,
      } });
      if (!response.ok) {
        setError(response.message);
        setResult(null);
      } else {
        setResult({
          text: response.text,
          provider: response.provider,
          model: response.model,
          calcVersion: response.calcVersion,
          inputHash: response.inputHash,
          latencyMs: response.latencyMs,
        });
      }
      const history = await listAiRunHistory({ data: { limit: 10 } });
      setRuns(history);
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const configured = providers ?? [];

  return (
    <div className="grid gap-3">
      <SaasSection
        title="Ask the engine's narrative layer"
        hint="Prompts are built from the server's own engine run — the browser never sends a figure."
        actions={
          <>
            <Button size="sm" variant="ghost" title="Reload" onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" />
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
              <Plus className="size-3.5" />
              Provider
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {AI_PURPOSES.map((id) => {
            const meta = AI_PURPOSE_LABELS[id];
            const on = purpose === id;
            return (
              <button
                key={id}
                type="button"
                title={meta.hint}
                onClick={() => setPurpose(id)}
                className={
                  "rounded-sm border px-2 py-1 text-2xs transition-colors " +
                  (on
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-panel text-ink-2 hover:text-ink")
                }
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {purpose === "chat" ? (
          <Field label="Question" className="mt-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Would waiting two weeks change the expected sale price?"
              maxLength={2000}
            />
          </Field>
        ) : null}

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Provider" hint={configured.length ? `${configured.length} configured` : "none yet"}>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="h-9 w-full rounded-md border border-line bg-panel px-2 text-sm text-ink"
            >
              <option value="auto">Auto (first with a key)</option>
              {configured.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.modelDefault ?? "default model"}
                  {p.hasKey ? "" : " (no key)"}
                </option>
              ))}
            </select>
          </Field>
          <div className="self-end">
            <Button
              size="sm"
              variant="primary"
              disabled={busy === "run"}
              onClick={() => void onRun()}
              className="w-full"
            >
              {busy === "run" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run
            </Button>
          </div>
        </div>

        {error ? (
          <Note tone="bad" className="mt-2">
            {error}
          </Note>
        ) : null}

        {result ? (
          <div className="mt-2 rounded-md border border-line bg-panel p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Sparkles className="size-3.5 text-teal" aria-hidden />
              <Tag tone="good">{result.provider}</Tag>
              <Tag>{result.model}</Tag>
              <Tag>engine v{result.calcVersion}</Tag>
              <Tag title="Engine input hash the narrative was written from">{result.inputHash}</Tag>
              <span className="num text-3xs text-ink-2">{result.latencyMs} ms</span>
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{result.text}</p>
          </div>
        ) : null}
      </SaasSection>

      {showForm ? (
        <ProviderForm
          onSaved={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      ) : null}

      <SaasSection
        title="Configured providers"
        hint="Keys are encrypted before they reach the database and are never returned to the browser."
      >
        {providers === null ? (
          <Muted>Loading providers…</Muted>
        ) : providers.length === 0 ? (
          <Empty>
            No provider configured. Add one, or set a server API-key environment
            variable so runs use the server key.
          </Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {providers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    {p.label}{" "}
                    <span className="text-3xs text-ink-2">{p.provider}</span>
                  </p>
                  <p className="num mt-0.5 text-3xs text-ink-2">
                    {p.modelDefault ?? "provider default model"} ·{" "}
                    {p.keyHint ?? (p.usesEnvKey ? "server env key" : "no key")}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {p.usesEnvKey ? <Tag tone="info">env key</Tag> : null}
                  <Tag tone={p.hasKey ? "good" : "warn"}>{p.hasKey ? "ready" : "no key"}</Tag>
                  <Tag tone={p.isEnabled ? "good" : "warn"}>
                    {p.isEnabled ? "enabled" : "disabled"}
                  </Tag>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Remove"
                    onClick={async () => {
                      try {
                        await deleteAiProvider({ data: { id: p.id } });
                        await refresh();
                      } catch (err) {
                        setError(describeApiError(err).message);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5 text-red" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SaasSection>

      <SaasSection title="Recent runs" hint="Every attempt is recorded, including failures.">
        {runs === null ? (
          <Muted>Loading run history…</Muted>
        ) : runs.length === 0 ? (
          <Empty>No AI runs yet.</Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {runs.map((run) => (
              <li key={run.id} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="num text-3xs text-ink-2">
                    {new Date(run.createdAt).toLocaleString()} · {run.provider}/{run.model} ·{" "}
                    {run.purpose}
                  </p>
                  <Tag tone={run.status === "succeeded" ? "good" : run.status === "failed" ? "bad" : "warn"}>
                    {run.status}
                  </Tag>
                </div>
                {run.text ? (
                  <p className="mt-1 line-clamp-2 text-2xs leading-snug text-ink-2">{run.text}</p>
                ) : null}
                {run.error ? (
                  <p className="mt-1 text-2xs leading-snug text-red">{run.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SaasSection>

      <div className="rounded-md border border-line bg-panel px-3 py-1.5">
        <KeyValue label="Engine facts sent" value={`v${out.calcVersion} · ${out.inputHash}`} />
        <KeyValue label="Read confidence" value={out.readConfidence} />
        <KeyValue label="Flags" value={out.flags.length ? out.flags.join(", ") : "none"} />
      </div>
    </div>
  );
}

function ProviderForm({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState<AiProviderId>("openai");
  const [label, setLabel] = useState(AI_PROVIDER_LABELS.openai);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onProviderChange = (next: AiProviderId) => {
    setProvider(next);
    setLabel(AI_PROVIDER_LABELS[next]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveAiProvider({ data: {
        provider,
        label: label.trim() || AI_PROVIDER_LABELS[provider],
        apiKey: apiKey.trim() === "" ? undefined : apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        modelDefault: model.trim() || undefined,
        isEnabled: enabled,
      } });
      onSaved();
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SaasSection title="Add a provider" hint="The API key is write-only: it is encrypted on save and never read back.">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as AiProviderId)}
            className="h-9 w-full rounded-md border border-line bg-panel px-2 text-sm text-ink"
          >
            {AI_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {AI_PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        <Field label="API key" hint="write-only">
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="your provider key"
          />
        </Field>
        <Field label="Model" hint="blank = provider default">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="provider default"
          />
        </Field>
        <Field label="Base URL" className="sm:col-span-2" hint="blank = provider default">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="leave blank unless self-hosting"
          />
        </Field>
      </div>
      <label className="mt-2 flex items-center gap-2 text-2xs text-ink-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-3.5"
        />
        Enabled for runs
      </label>
      {error ? (
        <Note tone="bad" className="mt-2">
          {error}
        </Note>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save provider
        </Button>
      </div>
    </SaasSection>
  );
}
