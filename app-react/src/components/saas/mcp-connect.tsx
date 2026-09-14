import { useEffect, useState } from "react";
import { Copy, Loader2, Play, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePricer } from "@/store/pricer";
import { describeApiError } from "@/lib/api/client-error";
import {
  getMcpStatus,
  listMcpClientPresets,
  listRecentMcpCalls,
  testMcpPriceScenario,
  type ClientPresetDto,
  type McpCallDto,
  type McpStatusDto,
} from "@/lib/api/mcp";
import { Empty, KeyValue, Muted, Note, SaasSection, Tag } from "./kit";

/**
 * MCP Connect admin panel.
 *
 * Everything here is a **template**: the endpoint URL is derived from the page's
 * own origin and the bearer token appears only as the placeholder
 * `YOUR_MCP_TOKEN`. The real token never reaches the browser —
 * `scripts/check-no-client-secrets.mjs` fails the build if the token's env name so
 * much as appears in a client-bundled file.
 */
export function McpConnect() {
  const intake = usePricer((s) => s.intake);
  const lender = usePricer((s) => s.lender);
  const investor = usePricer((s) => s.investor);
  const commercial = usePricer((s) => s.commercial);
  const persona = usePricer((s) => s.persona);

  const [status, setStatus] = useState<McpStatusDto | null>(null);
  const [calls, setCalls] = useState<McpCallDto[] | null>(null);
  const [presets, setPresets] = useState<ClientPresetDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const endpointUrl = status ? `${status.publicBaseUrl || origin}${status.endpoint}` : "";
  const restBridgeUrl = status ? `${status.publicBaseUrl || origin}${status.restBridge.toolsCall}` : "";

  const refresh = async () => {
    try {
      const [s, c, p] = await Promise.all([
        getMcpStatus(),
        listRecentMcpCalls(),
        listMcpClientPresets(),
      ]);
      setStatus(s);
      setCalls(c);
      setPresets(p);
      setError(null);
    } catch (err) {
      setStatus(null);
      setCalls(null);
      setPresets(null);
      setError(describeApiError(err).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  };

  const genericConfig = () =>
    JSON.stringify(
      {
        mcpServers: {
          "property-pricer": {
            url: `${status?.publicBaseUrl || origin || "https://YOUR_DOMAIN"}/api/mcp`,
            headers: { Authorization: "Bearer YOUR_MCP_TOKEN" },
          },
        },
      },
      null,
      2,
    );

  const claudeConfig = () =>
    JSON.stringify(
      {
        mcpServers: {
          "property-pricer": {
            type: "http",
            url: `${status?.publicBaseUrl || origin || "https://YOUR_DOMAIN"}/api/mcp`,
            headers: { Authorization: "Bearer YOUR_MCP_TOKEN" },
          },
        },
      },
      null,
      2,
    );

  const bridgeInstructions = () =>
    [
      "If your LLM client cannot connect to MCP directly, use the REST bridge:",
      "",
      `POST ${status?.publicBaseUrl || origin || "https://YOUR_DOMAIN"}/api/mcp/tools/list`,
      `POST ${status?.publicBaseUrl || origin || "https://YOUR_DOMAIN"}/api/mcp/tools/call`,
      "",
      "Always send:",
      "Authorization: Bearer YOUR_MCP_TOKEN",
      "",
      "Local dev:",
      "http://127.0.0.1:4173/api/mcp with Authorization: Bearer DEV_TOKEN",
    ].join("\n");

  const onTest = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const result = (await testMcpPriceScenario({ data: {
        intake,
        lender,
        investor,
        commercial,
        persona,
        returnTrace: false,
      } })) as { ok?: boolean; summary?: Record<string, unknown>; inputHash?: string };
      setTestResult(
        result.ok
          ? `Price scenario OK — E[DOM] ${String(result.summary?.expectedDomDays ?? "—")}d, ` +
              `net ${String(result.summary?.netProceeds ?? "—")}, hash ${result.inputHash ?? "—"}`
          : "Price scenario failed.",
      );
    } catch (err) {
      setTestResult(`Price scenario failed: ${describeApiError(err).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <SaasSection
        title="Connect an LLM client"
        hint="This app is an MCP server. Any MCP-capable client (Claude, ChatGPT, and others) can call the locked engine through it."
        actions={
          <>
            <Tag tone={status?.tokenConfigured ? "good" : "warn"}>
              {status ? (status.tokenConfigured ? "Token set" : "No token") : "…"}
            </Tag>
            <Button size="sm" variant="ghost" title="Reload" onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" />
            </Button>
          </>
        }
      >
        <div className="rounded-md border border-line bg-panel px-3 py-1.5">
          <KeyValue label="MCP endpoint" value={<span className="break-all">{endpointUrl}</span>} />
          <KeyValue label="REST bridge" value={<span className="break-all">{restBridgeUrl}</span>} />
          <KeyValue
            label="Auth"
            value={
              status
                ? status.requireAuth
                  ? "bearer token required"
                  : "optional (auth disabled on server)"
                : "…"
            }
          />
          <KeyValue
            label="Tools"
            value={status ? String(status.tools.length) : "…"}
          />
        </div>

        {!status?.requireAuth ? (
          <Note tone="warn" className="mt-2">
            Auth is currently optional. Set the MCP gateway token and keep auth required (the default) before exposing this endpoint.
          </Note>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => copy("url", endpointUrl)}>
            <Copy className="size-3.5" />
            {copied === "url" ? "Copied" : "Copy MCP URL"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => copy("rest", restBridgeUrl)}>
            <Copy className="size-3.5" />
            {copied === "rest" ? "Copied" : "Copy REST URL"}
          </Button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => copy("claude", claudeConfig())}>
            <Copy className="size-3.5" />
            {copied === "claude" ? "Copied" : "Claude Desktop config"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => copy("generic", genericConfig())}>
            <Copy className="size-3.5" />
            {copied === "generic" ? "Copied" : "Generic MCP config"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => copy("bridge", bridgeInstructions())}>
            <Copy className="size-3.5" />
            {copied === "bridge" ? "Copied" : "Bridge instructions"}
          </Button>
        </div>
      </SaasSection>

      <SaasSection
        title="Platform onboarding"
        hint="Copy-paste setup for each AI platform. OAuth presets are public metadata — no platform secret ever leaves the server."
      >
        {presets === null ? (
          <Muted>Loading presets…</Muted>
        ) : (
          <div className="grid gap-2">
            {presets.map((preset) => (
              <div key={preset.id} className="rounded-md border border-line bg-panel p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-2xs font-medium text-ink">{preset.displayName}</p>
                    <p className="mt-0.5 text-2xs leading-snug text-ink-2">{preset.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tag tone="info">{preset.transport === "mcp" ? "MCP" : "REST"}</Tag>
                    <Tag tone="info">{preset.authMethod === "public_pkce" ? "public PKCE" : "confidential"}</Tag>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copy(`preset-${preset.id}`, preset.configSnippet)}
                    >
                      <Copy className="size-3.5" />
                      {copied === `preset-${preset.id}` ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-2xs font-medium text-ink-2">
                    Setup instructions · redirects · scopes
                  </summary>
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-panel-2 p-2 text-2xs leading-snug text-ink-2">
                    {preset.setupInstructions}
                  </pre>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {preset.allowedRedirectUriPatterns.map((uri) => (
                      <Tag key={uri} tone="info">
                        {uri}
                      </Tag>
                    ))}
                    {preset.defaultScopes.map((scope) => (
                      <Tag key={scope} tone="info">
                        {scope}
                      </Tag>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </SaasSection>

      <SaasSection title="Enabled tools" hint="The full tool surface the MCP endpoint exposes.">
        {!status ? (
          <Muted>Loading tools…</Muted>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {status.tools.map((tool) => (
              <li key={tool.name} className="px-3 py-1.5">
                <p className="num text-3xs text-ink">{tool.name}</p>
                <p className="text-2xs text-ink-2">{tool.description}</p>
              </li>
            ))}
          </ul>
        )}
      </SaasSection>

      <SaasSection
        title="Smoke test"
        hint="Runs a real price through the MCP price_scenario tool with the current desk inputs."
        actions={
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void onTest()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Test MCP Price Scenario
          </Button>
        }
      >
        {testResult ? (
          <Note tone={testResult.startsWith("Price scenario OK") ? "good" : "bad"}>
            <span className="flex items-center gap-1.5">
              <TerminalSquare className="size-3.5" aria-hidden />
              {testResult}
            </span>
          </Note>
        ) : (
          <Muted className="flex items-start gap-1.5">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-teal" aria-hidden />
            <span>
              The smoke test runs the same server-side tool an MCP client would, so it
              exercises the real engine path rather than a stubbed number.
            </span>
          </Muted>
        )}
      </SaasSection>

      <SaasSection title="Recent MCP calls" hint="Last ten calls, newest first.">
        {calls === null ? (
          <Muted>Loading…</Muted>
        ) : calls.length === 0 ? (
          <Empty>No MCP calls yet. Connect a client to see them here.</Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {calls.map((call) => (
              <li key={call.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                <div className="min-w-0">
                  <p className="num text-3xs text-ink-2">
                    {new Date(call.createdAt).toLocaleString()} · {call.clientName ?? "unknown"} ·{" "}
                    {call.target}
                  </p>
                  {call.error ? <p className="text-2xs text-red">{call.error}</p> : null}
                </div>
                <Tag tone={call.status === "succeeded" ? "good" : call.status === "failed" ? "bad" : "warn"}>
                  {call.status}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </SaasSection>

      {error ? (
        <Note tone="bad">{error}</Note>
      ) : null}
    </div>
  );
}
