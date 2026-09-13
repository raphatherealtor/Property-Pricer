import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CloudUpload,
  FolderOpen,
  History,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { EngineOutput } from "@/engine/types";
import { usePricer } from "@/store/pricer";
import { daysLabel, pct, usd } from "@/lib/format";
import { describeApiError } from "@/lib/api/client-error";
import {
  deleteSavedScenario,
  getSavedScenario,
  getScenarioHistory,
  listSavedScenarios,
  saveScenario,
} from "@/lib/api/scenarios";
import type { ScenarioHistoryDto, ScenarioSummaryDto } from "@/lib/api/schemas";
import { Empty, KeyValue, Muted, Note, SaasSection, Tag } from "./kit";

/**
 * Saved-scenario history.
 *
 * Worth noting what is sent when saving: the *inputs* only. `expectedInputHash`
 * is the locally computed hash, sent purely so the response can flag
 * `inputHashDrift` — a mismatch means this browser is running a different engine
 * version than the server, which the operator should know about.
 *
 * `out` is the live `EngineOutput` from the store, so every figure shown here is
 * the same computed object the desk and deck render.
 */
export function ScenarioLibrary({ out }: { out: EngineOutput }) {
  const persona = usePricer((s) => s.persona);
  const intake = usePricer((s) => s.intake);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const loadScenario = usePricer((s) => s.loadScenario);

  const [rows, setRows] = useState<ScenarioSummaryDto[] | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<ScenarioHistoryDto[] | null>(null);
  const [drift, setDrift] = useState(false);

  const bundle = useMemo(
    () => ({ intake, lender, investor, commercial }),
    [intake, lender, investor, commercial],
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listSavedScenarios({ data: { limit: 25, offset: 0 } });
      setRows(list);
    } catch (err) {
      setRows(null);
      setError(describeApiError(err).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!name) setName(`${intake.zip || "Scenario"} · ${persona}`);
    // Default the name once from the current readout; afterwards the operator owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async () => {
    setBusy("save");
    setError(null);
    setStatus(null);
    try {
      const result = await saveScenario({ data: {
        ...bundle,
        name: name.trim() || "Untitled Scenario",
        persona,
        property: {
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          state: stateCode.trim() || undefined,
          zip: intake.zip || undefined,
          propertyType: intake.assetClass,
        },
        expectedInputHash: out.inputHash,
      } });
      setDrift(result.inputHashDrift);
      setStatus(
        `${result.created ? "Saved" : "Revised"} ${result.scenario.name} · ${result.computed.caseId} (v${result.computed.calcVersion})`,
      );
      setSelected(result.scenario.id);
      setHistory(null);
      await refresh();
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const onLoad = async (id: string) => {
    setBusy(`load:${id}`);
    setError(null);
    try {
      const scenario = await getSavedScenario({ data: { id } });
      if (!scenario) {
        setError("That scenario no longer exists.");
        return;
      }
      loadScenario({
        persona: scenario.persona,
        intake: scenario.intake,
        lender: scenario.lender ?? undefined,
        investor: scenario.investor ?? undefined,
        commercial: scenario.commercial ?? undefined,
      });
      setStatus(`Loaded ${scenario.name} into the desk.`);
      setSelected(id);
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(`delete:${id}`);
    setError(null);
    try {
      await deleteSavedScenario({ data: { id } });
      if (selected === id) {
        setSelected(null);
        setHistory(null);
      }
      await refresh();
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const onHistory = async (id: string) => {
    setBusy(`history:${id}`);
    setError(null);
    try {
      const timeline = await getScenarioHistory({ data: { id, limit: 20 } });
      setHistory(timeline);
      setSelected(id);
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3">
      <SaasSection
        title="Save this scenario"
        hint="Inputs are re-priced by the server's locked engine before anything is stored."
        actions={
          <Button size="sm" variant="ghost" onClick={() => void refresh()} title="Reload list">
            <RefreshCw className="size-3.5" />
          </Button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Scenario name" className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="123 Main St · pre-list"
              maxLength={160}
            />
          </Field>
          <Field label="Address" hint="optional">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="City" hint="optional">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Austin" />
            </Field>
            <Field label="State" hint="optional">
              <Input
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                placeholder="TX"
                maxLength={40}
              />
            </Field>
          </div>
        </div>

        {/* Live engine provenance, straight from the store's computed output. */}
        <div className="mt-2 rounded-md border border-line bg-panel px-3 py-1.5">
          <KeyValue label="Case id" value={out.caseId} />
          <KeyValue label="Engine" value={`v${out.calcVersion}`} />
          <KeyValue label="Expected DOM" value={`${daysLabel(out.expectedDomDays)}`} />
          <KeyValue label="P(> 120d)" value={pct(out.pStale120d)} />
          <KeyValue label="Cost of testing" value={usd(out.costOfTesting)} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" disabled={busy === "save"} onClick={() => void onSave()}>
            {busy === "save" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CloudUpload className="size-3.5" />
            )}
            Save to workspace
          </Button>
          {drift ? (
            <Tag tone="warn" title="This browser's engine hash differs from the server's">
              Engine version drift
            </Tag>
          ) : null}
        </div>

        {status ? (
          <Note tone="good" className="mt-2">
            {status}
          </Note>
        ) : null}
        {error ? (
          <Note tone="bad" className="mt-2">
            {error}
          </Note>
        ) : null}
      </SaasSection>

      <SaasSection
        title="Scenario history"
        hint="Newest first. Load restores the full bundle, including persona extensions."
      >
        {rows === null ? (
          <Muted>Loading saved scenarios…</Muted>
        ) : rows.length === 0 ? (
          <Empty>No saved scenarios yet. Save one above to start a history.</Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {rows.map((row) => (
              <li key={row.id} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{row.name}</p>
                    <p className="num mt-0.5 text-3xs text-ink-2">
                      {row.caseId ?? "—"} · v{row.calcVersion} · {row.inputHash}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Tag>{row.persona}</Tag>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Load into the desk"
                      disabled={busy === `load:${row.id}`}
                      onClick={() => void onLoad(row.id)}
                    >
                      <FolderOpen className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Show revision history"
                      disabled={busy === `history:${row.id}`}
                      onClick={() => void onHistory(row.id)}
                    >
                      <History className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Delete"
                      disabled={busy === `delete:${row.id}`}
                      onClick={() => void onDelete(row.id)}
                    >
                      <Trash2 className="size-3.5 text-red" />
                    </Button>
                  </div>
                </div>
                <p className="num mt-1 flex flex-wrap gap-x-3 text-3xs text-ink-2">
                  <span>E[DOM] {row.headline.expectedDomDays === null ? "—" : daysLabel(row.headline.expectedDomDays)}</span>
                  <span>P(&gt;120d) {row.headline.pStale120d === null ? "—" : pct(row.headline.pStale120d)}</span>
                  <span>
                    E[price]{" "}
                    {row.headline.expectedSalePrice === null
                      ? "—"
                      : usd(row.headline.expectedSalePrice)}
                  </span>
                  <span>
                    COT {row.headline.costOfTesting === null ? "—" : usd(row.headline.costOfTesting)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {history && history.length > 1 ? (
          <div className="mt-3">
            <p className="label-kicker mb-1.5">Revisions for the selected scenario</p>
            <ol className="space-y-1">
              {history.map((rev) => (
                <li
                  key={rev.scenarioId}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-sm border border-line bg-panel px-2 py-1.5"
                >
                  <button
                    type="button"
                    className="num text-3xs text-ink hover:text-blue"
                    onClick={() => void onLoad(rev.scenarioId)}
                    title="Load this revision"
                  >
                    {new Date(rev.createdAt).toLocaleString()} · {rev.inputHash}
                  </button>
                  <span className="flex items-center gap-1">
                    <Tag>{rev.persona}</Tag>
                    {rev.isCurrent ? <Tag tone="good">current</Tag> : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </SaasSection>
    </div>
  );
}
