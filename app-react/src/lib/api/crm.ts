/**
 * Figgy AI CRM API (browser-facing half).
 *
 * The browser may configure the connection, read the redacted status, push the
 * current scenario, and read the sync log. It never sees the CRM API key; the
 * `CrmConnectionDto` carries only `hasKey` / `keyHint`.
 *
 * One exception, by design: the **webhook secret** is returned when it is first
 * generated or explicitly rotated. It is not a credential this app presents to a
 * third party — it is the shared token the operator has to paste into Figgy's
 * webhook settings — and it is shown exactly once per rotation.
 */
import { createServerFn } from "@tanstack/react-start";
import { cloudMiddleware } from "./context.ts";
import {
  crmConnectionInputSchema,
  crmEventsInputSchema,
  crmPushInputSchema,
  type CrmConnectionDto,
  type CrmSyncEventDto,
} from "./schemas.ts";

export type CrmStatus = {
  connection: CrmConnectionDto | null;
  /** True when a server-side Figgy key exists even without a stored one. */
  hasEnvKey: boolean;
  defaultBaseUrl: string;
  /** Path/URL suffix the connector posts to, shown so the operator can allowlist it. */
  scenarioPath: string;
};

export type CrmSaveResult = {
  connection: CrmConnectionDto;
  /** Present only when the secret was just created or rotated. Show once. */
  webhookSecret: string | null;
};

export type CrmPushResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  /** Provenance of the payload that was pushed. */
  caseId: string;
  inputHash: string;
  calcVersion: string;
};

type ConnectionInput = ReturnType<typeof crmConnectionInputSchema.parse>;
type PushInput = ReturnType<typeof crmPushInputSchema.parse>;

export const getCrmStatus = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<CrmStatus> => {
    const { workspaceFor, listCrmConnectionRows, crmConnectionDto } = await import(
      "./store.server.ts"
    );
    const { figgyBaseUrl, figgyEnvApiKey, figgyScenarioPath } = await import(
      "../crm/figgy.server.ts"
    );
    const hasEnvKey = Boolean(figgyEnvApiKey());
    const rows = await listCrmConnectionRows(await workspaceFor(context));
    return {
      connection: rows[0] ? crmConnectionDto(rows[0], hasEnvKey) : null,
      hasEnvKey,
      defaultBaseUrl: figgyBaseUrl(),
      scenarioPath: figgyScenarioPath(),
    };
  });

/** Create or update the Figgy connection (one per workspace). */
export const saveCrmConnection = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): ConnectionInput => crmConnectionInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<CrmSaveResult> => {
    const { workspaceFor, upsertCrmConnection, crmConnectionDto } = await import(
      "./store.server.ts"
    );
    const { figgyEnvApiKey } = await import("../crm/figgy.server.ts");
    const { row, webhookSecret } = await upsertCrmConnection(
      await workspaceFor(context),
      data,
    );
    return {
      connection: crmConnectionDto(row, Boolean(figgyEnvApiKey())),
      webhookSecret,
    };
  });

/**
 * Rotate the webhook secret (or mint the first one). Returns the new value once
 * so it can be copied into Figgy.
 */
export const rotateCrmWebhookSecret = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<CrmSaveResult> => {
    const { workspaceFor, listCrmConnectionRows, upsertCrmConnection, crmConnectionDto } =
      await import("./store.server.ts");
    const { figgyEnvApiKey } = await import("../crm/figgy.server.ts");

    const workspace = await workspaceFor(context);
    const existing = await listCrmConnectionRows(workspace);
    if (!existing[0]) {
      throw new Error("Configure the Figgy connection before rotating its webhook secret.");
    }
    const { row, webhookSecret } = await upsertCrmConnection(workspace, {
      baseUrl: existing[0].base_url,
      webhookSecret: newSecret(),
      isEnabled: existing[0].is_enabled,
    });
    return {
      connection: crmConnectionDto(row, Boolean(figgyEnvApiKey())),
      webhookSecret,
    };
  });

function newSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const deleteCrmConnection = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<{ deleted: boolean }> => {
    const { workspaceFor, deleteCrmConnection: remove } = await import("./store.server.ts");
    return { deleted: await remove(await workspaceFor(context)) };
  });

/**
 * Push the current scenario to Figgy. The payload is rebuilt from a fresh
 * server-side engine run, so the CRM receives engine output rather than anything
 * the browser asserted, and the attempt is logged either way.
 */
export const pushScenarioToCrm = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): PushInput => crmPushInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<CrmPushResult> => {
    const {
      workspaceFor,
      listCrmConnectionRows,
      crmConnectionSecrets,
      recordCrmSyncEvent,
      getScenario,
      getProperty,
    } = await import("./store.server.ts");
    const { computeScenario } = await import("./engine-bridge.server.ts");
    const {
      buildFiggyPayload,
      pushScenarioToFiggy,
      figgyEnvApiKey,
      figgyScenarioPath,
    } = await import("../crm/figgy.server.ts");

    const workspace = await workspaceFor(context);
    const { output, facts } = computeScenario(
      {
        intake: data.intake,
        lender: data.lender,
        investor: data.investor,
        commercial: data.commercial,
      },
      new Date().toISOString(),
    );

    const provenance: Pick<CrmPushResult, "caseId" | "inputHash" | "calcVersion"> = {
      caseId: output.caseId,
      inputHash: output.inputHash,
      calcVersion: output.calcVersion,
    };

    const rows = await listCrmConnectionRows(workspace);
    const connection = rows[0];
    if (!connection) {
      return {
        ok: false,
        status: null,
        error: "No Figgy connection is configured for this workspace.",
        durationMs: 0,
        ...provenance,
      };
    }
    if (!connection.is_enabled) {
      return {
        ok: false,
        status: null,
        error: "The Figgy connection is disabled.",
        durationMs: 0,
        ...provenance,
      };
    }

    const { apiKey } = crmConnectionSecrets(connection);
    const resolvedKey = apiKey ?? figgyEnvApiKey();
    if (!resolvedKey) {
      return {
        ok: false,
        status: null,
        error:
          "No Figgy API key is stored for this connection, and the server has no " +
          "Figgy key configured. Add one in the CRM tab.",
        durationMs: 0,
        ...provenance,
      };
    }

    // Use the saved property details when the scenario is attached to one, so the
    // CRM record carries an address rather than only a ZIP.
    const scenario = data.scenarioId ? await getScenario(workspace, data.scenarioId) : null;
    const property = scenario?.propertyId
      ? await getProperty(workspace, scenario.propertyId)
      : null;
    const payload = buildFiggyPayload({
      facts,
      name: scenario?.name ?? data.name,
      persona: data.persona,
      property: property
        ? { address: property.address, city: property.city, state: property.state }
        : null,
      generatedAt: new Date().toISOString(),
      sourceLabel: workspace.workspaceName,
    });

    const result = await pushScenarioToFiggy({
      baseUrl: connection.base_url,
      apiKey: resolvedKey,
      payload,
      eventType: data.eventType,
    });

    await recordCrmSyncEvent({
      workspaceId: workspace.workspaceId,
      scenarioId: data.scenarioId ?? null,
      connectionId: connection.id,
      direction: "outbound",
      eventType: data.eventType,
      request: {
        url: `${connection.base_url.replace(/\/+$/, "")}${figgyScenarioPath()}`,
        caseId: output.caseId,
        inputHash: output.inputHash,
        calcVersion: output.calcVersion,
        persona: data.persona,
        bytes: JSON.stringify(payload).length,
      },
      response: result.body,
      status: result.ok ? "succeeded" : "failed",
      error: result.ok ? null : result.error,
    });

    return {
      ok: result.ok,
      status: result.status,
      error: result.ok ? null : result.error,
      durationMs: result.durationMs,
      ...provenance,
    };
  });

export const listCrmSyncLog = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): ReturnType<typeof crmEventsInputSchema.parse> =>
    crmEventsInputSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<CrmSyncEventDto[]> => {
    const { workspaceFor, listCrmSyncEvents } = await import("./store.server.ts");
    return listCrmSyncEvents(await workspaceFor(context), data.limit);
  });
