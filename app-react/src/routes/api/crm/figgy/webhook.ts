/**
 * Figgy AI CRM inbound webhook — `POST /api/crm/figgy/webhook?connection=<uuid>`.
 *
 * This is the only HTTP endpoint in the app that is reachable without a session,
 * so it is deliberately paranoid:
 *
 *  - The `connection` uuid is the sole tenant hint and is trusted only after the
 *    request proves possession of that connection's `webhook_secret`, either as
 *    an HMAC-SHA256 of the raw body (`x-figgy-signature: sha256=<hex>`) or as an
 *    exact `x-webhook-secret` header compared in constant time.
 *  - The body is read only up to `MAX_WEBHOOK_BYTES` and is read as *text first*,
 *    because an HMAC must be computed over the exact bytes received.
 *  - Nothing is written to another workspace, and every attempt — accepted or
 *    rejected — lands in `crm_sync_events` so an operator can see the traffic.
 *  - The response never contains a credential.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/crm/figgy/webhook")({
  server: {
    handlers: {
      GET: () =>
        json(200, {
          ok: true,
          endpoint: "property-pricer.figgy-webhook",
          message:
            "POST signed Figgy events here. Configure the connection UUID as the " +
            "`connection` query parameter and your webhook secret in Figgy.",
        }),
      POST: ({ request }) => handleWebhook(request),
    },
  },
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleWebhook(request: Request): Promise<Response> {
  const { getCrmConnectionById, crmConnectionSecrets, recordCrmSyncEvent, findScenarioByRef } =
    await import("@/lib/api/store.server.ts");
  const {
    MAX_WEBHOOK_BYTES,
    interpretFiggyEvent,
    verifyFiggyRequest,
  } = await import("@/lib/crm/figgy.server.ts");

  const connectionId = new URL(request.url).searchParams.get("connection")?.trim() ?? "";
  if (!UUID_RE.test(connectionId)) {
    return json(400, {
      ok: false,
      error: "missing or malformed `connection` query parameter (expected a uuid)",
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return json(413, { ok: false, error: "payload too large" });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return json(413, { ok: false, error: "payload too large" });
  }

  const found = await getCrmConnectionById(connectionId);
  if (!found) {
    // No connection: nothing to log against, and no workspace may be inferred.
    return json(404, { ok: false, error: "unknown connection" });
  }

  const { row, workspaceId } = found;
  const { webhookSecret } = crmConnectionSecrets(row);

  const log = async (args: {
    eventType: string;
    status: "succeeded" | "failed";
    response?: unknown;
    error?: string | null;
    request?: unknown;
  }) =>
    recordCrmSyncEvent({
      workspaceId,
      connectionId: row.id,
      direction: "inbound",
      eventType: args.eventType,
      request: args.request ?? { bytes: rawBody.length },
      response: args.response ?? null,
      status: args.status,
      error: args.error ?? null,
    });

  if (!row.is_enabled) {
    await log({
      eventType: "connection.disabled",
      status: "failed",
      error: "connection is disabled",
    });
    return json(403, { ok: false, error: "connection is disabled" });
  }

  const verdict = verifyFiggyRequest({ webhookSecret, rawBody, headers: request.headers });
  if (!verdict.ok) {
    await log({
      eventType: "auth.rejected",
      status: "failed",
      error: verdict.reason,
      request: {
        bytes: rawBody.length,
        hasSignature:
          request.headers.get("x-figgy-signature") !== null ||
          request.headers.get("x-signature") !== null ||
          request.headers.get("x-hub-signature-256") !== null,
      },
    });
    return json(401, { ok: false, error: "signature verification failed" });
  }

  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    await log({
      eventType: "malformed_body",
      status: "failed",
      error: "body is not valid JSON",
    });
    return json(400, { ok: false, error: "body is not valid JSON" });
  }

  const event = interpretFiggyEvent(body);

  if (event.action === "handshake") {
    await log({ eventType: event.eventType, status: "succeeded", response: { handshake: true } });
    return json(200, {
      ok: true,
      connectionId: row.id,
      verified: verdict.scheme,
      subscription: "scenario.request, scenario.note",
    });
  }

  if (event.action === "send_scenario") {
    const scenario = await findScenarioByRef(workspaceId, {
      inputHash: event.inputHash,
      caseId: event.caseId,
    });
    if (!scenario) {
      await log({
        eventType: event.eventType,
        status: "failed",
        error: "no saved scenario matches that input_hash/case_id",
        request: { inputHash: event.inputHash, caseId: event.caseId },
      });
      return json(404, {
        ok: false,
        error: "no saved scenario matches that input_hash or case_id",
      });
    }
    const response = {
      ok: true,
      scenario: {
        id: scenario.id,
        name: scenario.name,
        persona: scenario.persona,
        caseId: scenario.caseId,
        calcVersion: scenario.calcVersion,
        inputHash: scenario.inputHash,
        updatedAt: scenario.updatedAt,
        intake: scenario.intake,
        engineOutput: scenario.engineOutput,
      },
    };
    await log({
      eventType: event.eventType,
      status: "succeeded",
      request: { inputHash: event.inputHash, caseId: event.caseId },
      response: { scenarioId: scenario.id, caseId: scenario.caseId },
    });
    return json(200, response);
  }

  if (event.action === "record_note") {
    await log({
      eventType: event.eventType,
      status: "succeeded",
      request: {
        externalId: event.externalId,
        caseId: event.caseId,
        inputHash: event.inputHash,
        note: event.note,
      },
      response: { accepted: true },
    });
    return json(202, { ok: true, accepted: true });
  }

  await log({
    eventType: event.eventType,
    status: "succeeded",
    request: { externalId: event.externalId },
    response: { accepted: true, action: "noop" },
  });
  return json(202, { ok: true, accepted: true, action: "noop" });
}
