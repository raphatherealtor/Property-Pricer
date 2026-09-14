/**
 * Persistence for the SaaS layers (SERVER-ONLY).
 *
 * One module owns every SQL statement against the tables in
 * `db/app-schema-v1.sql` — users, workspaces, properties, scenarios,
 * scenario_exports, ai_providers, ai_runs, crm_connections, crm_sync_events.
 * Handlers never write SQL themselves, which keeps tenant scoping
 * (`join workspaces w on w.id = … and w.owner_user_id = $n`) in one auditable
 * place.
 *
 * Boundaries worth knowing:
 *
 *  - The server is the only writer of `engine_output_json`. This layer stores
 *    whatever output it is handed; the caller is responsible for having
 *    *computed* it with the locked engine from validated inputs.
 *  - jsonb parameters are always `JSON.stringify`-ed and cast `::jsonb`, because
 *    node-postgres and PGLite disagree about raw object parameters.
 *  - Every returned shape is JSON-serializable (dates become ISO strings), which
 *    is what `createServerFn` requires across the wire.
 *  - Secret columns are read only by the two `*Secret` / `*Secrets` helpers and
 *    are never part of a DTO.
 */
import { getSql } from "../db.ts";
import { decryptSecret, encryptSecret, keyHint } from "../crypto/secrets.server.ts";
import type { EngineOutput } from "../../engine/types.ts";
import { appUserId, fallbackEmail, isUuid } from "./ids.server.ts";
import { assertApiServerOnly } from "./server-only.ts";
import {
  toJsonObject,
  type AiProviderDto,
  type AiProviderId,
  type AiPurpose,
  type AiRunDto,
  type CrmConnectionDto,
  type CrmSyncEventDto,
  type ExportType,
  type PersonaName,
  type PropertyDto,
  type PropertyInput,
  type ScenarioDto,
  type ScenarioExportDto,
  type ScenarioHistoryDto,
  type ScenarioSummaryDto,
  type WorkspaceDto,
} from "./schemas.ts";

assertApiServerOnly("api/store.server");

export const DEFAULT_WORKSPACE_NAME = "Default Workspace";

/** Every workspace-scoped call carries the verified owner id from authMiddleware. */
export type WorkspaceContext = WorkspaceDto;

export type Identity = {
  /** Verified Better Auth user id — never a client-supplied value. */
  id: string;
  email: string | null;
  displayName?: string | null;
};

type Sql = Awaited<ReturnType<typeof getSql>>;

type AiRunStatus = AiRunDto["status"];

/* ------------------------------------------------------------------ *
 * Value helpers
 * ------------------------------------------------------------------ */

/** ISO-8601 for a timestamptz. Both drivers hand back a `Date`. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return "";
}

/** `numeric` arrives as a string from both drivers; `->>` always as text. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** jsonb may arrive pre-parsed (both drivers) or as text; normalize to a value. */
function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function jsonParam(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/* ------------------------------------------------------------------ *
 * Identity + workspace bootstrap
 * ------------------------------------------------------------------ */

/**
 * Find-or-create the app `users` row and its default workspace.
 *
 * The row is keyed on `email` because that column is the schema's unique key:
 * two federated identities that share an address (Google today, the broker's X
 * provider tomorrow) converge on one app user instead of splitting a tenant. The
 * deterministic uuid is only the insert hint.
 */
export async function resolveWorkspaceContext(
  identity: Identity,
): Promise<WorkspaceContext> {
  const sql = await getSql();
  const derivedId = appUserId(identity.id);
  const email = (identity.email?.trim() || fallbackEmail(derivedId)).toLowerCase();
  const displayName = identity.displayName?.trim() || null;

  const userRows = await sql<{
    id: string;
    email: string;
    display_name: string | null;
  }>`
    insert into users (id, email, display_name)
    values (${derivedId}, ${email}, ${displayName})
    on conflict (email) do update
      set display_name = coalesce(excluded.display_name, users.display_name)
    returning id, email, display_name
  `;
  const user = userRows[0];
  if (!user) throw new Error("failed to resolve app user row");

  const workspaceId = await findOrCreateDefaultWorkspace(sql, user.id);

  return {
    userId: user.id,
    workspaceId,
    workspaceName: DEFAULT_WORKSPACE_NAME,
    email: user.email,
    displayName: user.display_name,
  };
}

/**
 * Adapter for the `cloudMiddleware` context, so handlers do not repeat the
 * identity mapping. Kept next to `resolveWorkspaceContext` on purpose.
 */
export async function workspaceFor(context: {
  userId: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
}): Promise<WorkspaceContext> {
  return resolveWorkspaceContext({
    id: context.userId,
    email: context.userEmail ?? null,
    displayName: context.userDisplayName ?? null,
  });
}

async function findOrCreateDefaultWorkspace(sql: Sql, userId: string): Promise<string> {
  const read = () =>
    sql<{ id: string }>`
      select id from workspaces
      where owner_user_id = ${userId} and name = ${DEFAULT_WORKSPACE_NAME}
      order by created_at asc, id asc
      limit 1
    `;

  const existing = await read();
  if (existing[0]) return existing[0].id;

  // `insert … select … where not exists` keeps two concurrent first-requests
  // from both inserting; the losing caller falls through to the read below.
  const created = await sql<{ id: string }>`
    insert into workspaces (owner_user_id, name)
    select ${userId}, ${DEFAULT_WORKSPACE_NAME}
    where not exists (
      select 1 from workspaces
      where owner_user_id = ${userId} and name = ${DEFAULT_WORKSPACE_NAME}
    )
    returning id
  `;
  if (created[0]) return created[0].id;

  const raced = await read();
  if (raced[0]) return raced[0].id;
  throw new Error("failed to resolve default workspace");
}

/* ------------------------------------------------------------------ *
 * Properties
 * ------------------------------------------------------------------ */

type PropertyRow = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  property_type: string | null;
  created_at: unknown;
  updated_at: unknown;
};

function toProperty(row: PropertyRow): PropertyDto {
  return {
    id: row.id,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    propertyType: row.property_type,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listProperties(ctx: WorkspaceContext): Promise<PropertyDto[]> {
  const sql = await getSql();
  const rows = await sql<PropertyRow>`
    select id, address, city, state, zip, property_type, created_at, updated_at
    from properties
    where workspace_id = ${ctx.workspaceId}
    order by updated_at desc
    limit 200
  `;
  return rows.map(toProperty);
}

export async function getProperty(
  ctx: WorkspaceContext,
  propertyId: string,
): Promise<PropertyDto | null> {
  if (!isUuid(propertyId)) return null;
  const sql = await getSql();
  const rows = await sql<PropertyRow>`
    select id, address, city, state, zip, property_type, created_at, updated_at
    from properties
    where id = ${propertyId} and workspace_id = ${ctx.workspaceId}
    limit 1
  `;
  const row = rows[0];
  return row ? toProperty(row) : null;
}

export async function upsertProperty(
  ctx: WorkspaceContext,
  input: PropertyInput,
): Promise<PropertyDto> {
  const sql = await getSql();
  const address = input.address?.trim() || null;
  const city = input.city?.trim() || null;
  const state = input.state?.trim() || null;
  const zip = input.zip?.trim() || null;
  const propertyType = input.propertyType?.trim() || null;

  if (isUuid(input.id)) {
    const updated = await sql<PropertyRow>`
      update properties set
        address = ${address},
        city = ${city},
        state = ${state},
        zip = ${zip},
        property_type = ${propertyType},
        updated_at = now()
      where id = ${input.id} and workspace_id = ${ctx.workspaceId}
      returning id, address, city, state, zip, property_type, created_at, updated_at
    `;
    if (updated[0]) return toProperty(updated[0]);
  }

  const inserted = await sql<PropertyRow>`
    insert into properties (workspace_id, address, city, state, zip, property_type)
    values (${ctx.workspaceId}, ${address}, ${city}, ${state}, ${zip}, ${propertyType})
    returning id, address, city, state, zip, property_type, created_at, updated_at
  `;
  const row = inserted[0];
  if (!row) throw new Error("failed to create property");
  return toProperty(row);
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

type ScenarioRow = {
  id: string;
  property_id: string | null;
  name: string;
  persona: PersonaName;
  intake_json: unknown;
  lender_json: unknown;
  investor_json: unknown;
  commercial_json: unknown;
  engine_output_json: unknown;
  calc_version: string;
  input_hash: string;
  created_at: unknown;
  updated_at: unknown;
  case_id?: string | null;
  expected_dom_days?: string | null;
  p_stale_120d?: string | null;
  expected_sale_price?: string | null;
  cost_of_testing?: string | null;
  market_temp?: string | null;
  read_confidence?: string | null;
};

function toSummary(row: ScenarioRow): ScenarioSummaryDto {
  return {
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    persona: row.persona,
    caseId: str(row.case_id),
    inputHash: row.input_hash,
    calcVersion: row.calc_version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    headline: {
      expectedDomDays: num(row.expected_dom_days),
      pStale120d: num(row.p_stale_120d),
      expectedSalePrice: num(row.expected_sale_price),
      costOfTesting: num(row.cost_of_testing),
      marketTemp: str(row.market_temp),
      readConfidence: str(row.read_confidence),
    },
  };
}

function toScenario(row: ScenarioRow): ScenarioDto {
  return {
    ...toSummary(row),
    intake: json(row.intake_json, {} as ScenarioDto["intake"]),
    lender: row.lender_json == null ? null : json(row.lender_json, null),
    investor: row.investor_json == null ? null : json(row.investor_json, null),
    commercial: row.commercial_json == null ? null : json(row.commercial_json, null),
    engineOutput: json(row.engine_output_json, {} as ScenarioDto["engineOutput"]),
  };
}

export type InsertScenarioArgs = {
  name: string;
  persona: PersonaName;
  propertyId: string | null;
  payload: {
    intake: unknown;
    lender: unknown;
    investor: unknown;
    commercial: unknown;
  };
  /** Computed by the caller with the locked engine — never taken from a request. */
  engineOutput: EngineOutput;
  calcVersion: string;
  inputHash: string;
};

export async function createScenario(
  ctx: WorkspaceContext,
  args: InsertScenarioArgs,
): Promise<ScenarioDto> {
  const sql = await getSql();
  const rows = await sql<ScenarioRow>`
    insert into scenarios (
      workspace_id, property_id, name, persona,
      intake_json, lender_json, investor_json, commercial_json,
      engine_output_json, calc_version, input_hash
    ) values (
      ${ctx.workspaceId},
      ${isUuid(args.propertyId ?? undefined) ? args.propertyId : null}::uuid,
      ${args.name},
      ${args.persona},
      ${jsonParam(args.payload.intake)}::jsonb,
      ${jsonParam(args.payload.lender)}::jsonb,
      ${jsonParam(args.payload.investor)}::jsonb,
      ${jsonParam(args.payload.commercial)}::jsonb,
      ${jsonParam(args.engineOutput)}::jsonb,
      ${args.calcVersion},
      ${args.inputHash}
    )
    returning id, property_id, name, persona, intake_json, lender_json,
              investor_json, commercial_json, engine_output_json, calc_version,
              input_hash, created_at, updated_at,
              engine_output_json->>'caseId'            as case_id,
              engine_output_json->>'expectedDomDays'   as expected_dom_days,
              engine_output_json->>'pStale120d'        as p_stale_120d,
              engine_output_json->>'expectedSalePrice' as expected_sale_price,
              engine_output_json->>'costOfTesting'     as cost_of_testing,
              engine_output_json->>'marketTemp'        as market_temp,
              engine_output_json->>'readConfidence'    as read_confidence
  `;
  const row = rows[0];
  if (!row) throw new Error("failed to create scenario");
  return toScenario(row);
}

export type UpdateScenarioArgs = {
  id: string;
  name?: string;
  persona?: PersonaName;
  /** `undefined` leaves the association alone; `null` clears it. */
  propertyId?: string | null;
  payload?: InsertScenarioArgs["payload"];
  engineOutput?: EngineOutput;
  calcVersion?: string;
  inputHash?: string;
};

/** Records a revision on an existing scenario. Callers derive `inputHash` first. */
export async function updateScenario(
  ctx: WorkspaceContext,
  args: UpdateScenarioArgs,
): Promise<ScenarioDto | null> {
  const sql = await getSql();
  const propertyProvided = args.propertyId !== undefined;
  const propertyValue = isUuid(args.propertyId ?? undefined) ? args.propertyId : null;

  const rows = await sql<ScenarioRow>`
    update scenarios s set
      name = coalesce(${args.name ?? null}::text, s.name),
      persona = coalesce(${args.persona ?? null}::text, s.persona),
      property_id = case
        when ${propertyProvided}::boolean then ${propertyValue}::uuid
        else s.property_id
      end,
      intake_json = coalesce(${jsonParam(args.payload?.intake)}::jsonb, s.intake_json),
      lender_json = coalesce(${jsonParam(args.payload?.lender)}::jsonb, s.lender_json),
      investor_json = coalesce(${jsonParam(args.payload?.investor)}::jsonb, s.investor_json),
      commercial_json = coalesce(${jsonParam(args.payload?.commercial)}::jsonb, s.commercial_json),
      engine_output_json = coalesce(${jsonParam(args.engineOutput)}::jsonb, s.engine_output_json),
      calc_version = coalesce(${args.calcVersion ?? null}::text, s.calc_version),
      input_hash = coalesce(${args.inputHash ?? null}::text, s.input_hash),
      updated_at = now()
    from workspaces w
    where s.id = ${args.id}
      and s.workspace_id = w.id
      and w.owner_user_id = ${ctx.userId}
      and s.workspace_id = ${ctx.workspaceId}
    returning s.id, s.property_id, s.name, s.persona, s.intake_json, s.lender_json,
              s.investor_json, s.commercial_json, s.engine_output_json,
              s.calc_version, s.input_hash, s.created_at, s.updated_at,
              s.engine_output_json->>'caseId'            as case_id,
              s.engine_output_json->>'expectedDomDays'   as expected_dom_days,
              s.engine_output_json->>'pStale120d'        as p_stale_120d,
              s.engine_output_json->>'expectedSalePrice' as expected_sale_price,
              s.engine_output_json->>'costOfTesting'     as cost_of_testing,
              s.engine_output_json->>'marketTemp'        as market_temp,
              s.engine_output_json->>'readConfidence'    as read_confidence
  `;
  const row = rows[0];
  return row ? toScenario(row) : null;
}

export type ListScenariosQuery = {
  propertyId?: string;
  persona?: PersonaName;
  search?: string;
  limit: number;
  offset: number;
};

export async function listScenarios(
  ctx: WorkspaceContext,
  query: ListScenariosQuery,
): Promise<ScenarioSummaryDto[]> {
  const sql = await getSql();
  const propertyId = isUuid(query.propertyId) ? query.propertyId : null;
  const persona = query.persona ?? null;
  const search = query.search?.trim() ? `%${query.search.trim().toLowerCase()}%` : null;
  const rows = await sql<ScenarioRow>`
    select s.id, s.property_id, s.name, s.persona, s.calc_version, s.input_hash,
           s.created_at, s.updated_at,
           s.engine_output_json->>'caseId'            as case_id,
           s.engine_output_json->>'expectedDomDays'   as expected_dom_days,
           s.engine_output_json->>'pStale120d'        as p_stale_120d,
           s.engine_output_json->>'expectedSalePrice' as expected_sale_price,
           s.engine_output_json->>'costOfTesting'     as cost_of_testing,
           s.engine_output_json->>'marketTemp'        as market_temp,
           s.engine_output_json->>'readConfidence'    as read_confidence
    from scenarios s
    where s.workspace_id = ${ctx.workspaceId}
      and (${propertyId}::uuid is null or s.property_id = ${propertyId}::uuid)
      and (${persona}::text is null or s.persona = ${persona}::text)
      and (${search}::text is null or lower(s.name) like ${search}::text)
    order by s.updated_at desc, s.created_at desc
    limit ${query.limit} offset ${query.offset}
  `;
  return rows.map(toSummary);
}

export async function getScenario(
  ctx: WorkspaceContext,
  scenarioId: string,
): Promise<ScenarioDto | null> {
  if (!isUuid(scenarioId)) return null;
  const sql = await getSql();
  const rows = await sql<ScenarioRow>`
    select s.id, s.property_id, s.name, s.persona, s.intake_json, s.lender_json,
           s.investor_json, s.commercial_json, s.engine_output_json,
           s.calc_version, s.input_hash, s.created_at, s.updated_at,
           s.engine_output_json->>'caseId'            as case_id,
           s.engine_output_json->>'expectedDomDays'   as expected_dom_days,
           s.engine_output_json->>'pStale120d'        as p_stale_120d,
           s.engine_output_json->>'expectedSalePrice' as expected_sale_price,
           s.engine_output_json->>'costOfTesting'     as cost_of_testing,
           s.engine_output_json->>'marketTemp'        as market_temp,
           s.engine_output_json->>'readConfidence'    as read_confidence
    from scenarios s
    join workspaces w on w.id = s.workspace_id
    where s.id = ${scenarioId}
      and s.workspace_id = ${ctx.workspaceId}
      and w.owner_user_id = ${ctx.userId}
    limit 1
  `;
  const row = rows[0];
  return row ? toScenario(row) : null;
}

export async function deleteScenario(
  ctx: WorkspaceContext,
  scenarioId: string,
): Promise<boolean> {
  if (!isUuid(scenarioId)) return false;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from scenarios s
    using workspaces w
    where s.id = ${scenarioId}
      and s.workspace_id = w.id
      and w.owner_user_id = ${ctx.userId}
      and s.workspace_id = ${ctx.workspaceId}
    returning s.id
  `;
  return rows.length > 0;
}

/**
 * Look up a scenario inside an already-established workspace by its engine
 * provenance (`input_hash`) or its `caseId`. Used by the inbound CRM webhook,
 * where the signed connection row — not a session — is the tenant authority, so
 * this consumes a raw `workspaceId` instead of a `WorkspaceContext`.
 */
export async function findScenarioByRef(
  workspaceId: string,
  ref: { inputHash?: string | null; caseId?: string | null },
): Promise<ScenarioDto | null> {
  if (!isUuid(workspaceId)) return null;
  const inputHash = ref.inputHash?.trim() || null;
  const caseId = ref.caseId?.trim() || null;
  if (!inputHash && !caseId) return null;

  const sql = await getSql();
  const rows = await sql<ScenarioRow>`
    select s.id, s.property_id, s.name, s.persona, s.intake_json, s.lender_json,
           s.investor_json, s.commercial_json, s.engine_output_json,
           s.calc_version, s.input_hash, s.created_at, s.updated_at,
           s.engine_output_json->>'caseId'            as case_id,
           s.engine_output_json->>'expectedDomDays'   as expected_dom_days,
           s.engine_output_json->>'pStale120d'        as p_stale_120d,
           s.engine_output_json->>'expectedSalePrice' as expected_sale_price,
           s.engine_output_json->>'costOfTesting'     as cost_of_testing,
           s.engine_output_json->>'marketTemp'        as market_temp,
           s.engine_output_json->>'readConfidence'    as read_confidence
    from scenarios s
    where s.workspace_id = ${workspaceId}
      and (
        (${inputHash}::text is not null and s.input_hash = ${inputHash}::text)
        or (${caseId}::text is not null and s.engine_output_json->>'caseId' = ${caseId}::text)
      )
    order by s.updated_at desc
    limit 1
  `;
  const row = rows[0];
  return row ? toScenario(row) : null;
}

/**
 * Saved-scenario history for one scenario: every sibling revision that shares
 * its property (when set) or, failing that, its name — ordered oldest first so
 * the UI can render a timeline with the current row marked.
 */
export async function listScenarioHistory(
  ctx: WorkspaceContext,
  scenarioId: string,
  limit: number,
): Promise<ScenarioHistoryDto[]> {
  if (!isUuid(scenarioId)) return [];
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    persona: PersonaName;
    input_hash: string;
    calc_version: string;
    created_at: unknown;
    is_current: boolean;
  }>`
    with target as (
      select id, property_id, name
      from scenarios
      where id = ${scenarioId} and workspace_id = ${ctx.workspaceId}
    )
    select s.id, s.name, s.persona, s.input_hash, s.calc_version, s.created_at,
           (s.id = (select id from target)) as is_current
    from scenarios s, target t
    where s.workspace_id = ${ctx.workspaceId}
      and (
        (t.property_id is not null and s.property_id = t.property_id)
        or (t.property_id is null and s.name = t.name)
      )
    order by s.created_at asc, s.id asc
    limit ${limit}
  `;
  return rows.map((row) => ({
    scenarioId: row.id,
    name: row.name,
    persona: row.persona,
    inputHash: row.input_hash,
    calcVersion: row.calc_version,
    createdAt: iso(row.created_at),
    isCurrent: row.is_current === true,
  }));
}

/* ------------------------------------------------------------------ *
 * Scenario exports
 * ------------------------------------------------------------------ */

export async function createScenarioExport(
  ctx: WorkspaceContext,
  args: {
    scenarioId: string;
    exportType: ExportType;
    payload?: unknown;
    fileUrl?: string;
  },
): Promise<ScenarioExportDto | null> {
  if (!isUuid(args.scenarioId)) return null;
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    scenario_id: string;
    export_type: ExportType;
    file_url: string | null;
    created_at: unknown;
    has_payload: boolean;
  }>`
    insert into scenario_exports (scenario_id, export_type, payload_json, file_url)
    select s.id, ${args.exportType}, ${jsonParam(args.payload)}::jsonb, ${args.fileUrl ?? null}
    from scenarios s
    join workspaces w on w.id = s.workspace_id
    where s.id = ${args.scenarioId}
      and s.workspace_id = ${ctx.workspaceId}
      and w.owner_user_id = ${ctx.userId}
    returning id, scenario_id, export_type, file_url, created_at,
              (payload_json is not null) as has_payload
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    exportType: row.export_type,
    fileUrl: row.file_url,
    createdAt: iso(row.created_at),
    hasPayload: row.has_payload === true,
  };
}

/* ------------------------------------------------------------------ *
 * AI providers
 * ------------------------------------------------------------------ */

export type AiProviderRow = {
  id: string;
  provider: AiProviderId;
  label: string;
  encrypted_api_key: string | null;
  base_url: string | null;
  model_default: string | null;
  is_enabled: boolean;
  created_at: unknown;
};

/**
 * Browser-visible provider shape. The ciphertext column is read (to derive
 * `hasKey` and a short hint) but never returned — the DTO has no field for it.
 */
export function aiProviderDto(
  row: AiProviderRow,
  envKeyPresent: boolean,
): AiProviderDto {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    modelDefault: row.model_default,
    isEnabled: row.is_enabled,
    hasKey: Boolean(row.encrypted_api_key) || envKeyPresent,
    keyHint: keyHint(row.encrypted_api_key),
    usesEnvKey: !row.encrypted_api_key && envKeyPresent,
    createdAt: iso(row.created_at),
  };
}

export async function listAiProviderRows(
  ctx: WorkspaceContext,
): Promise<AiProviderRow[]> {
  const sql = await getSql();
  return sql<AiProviderRow>`
    select id, provider, label, encrypted_api_key, base_url, model_default,
           is_enabled, created_at
    from ai_providers
    where workspace_id = ${ctx.workspaceId}
    order by created_at asc
  `;
}

export async function getAiProviderRow(
  ctx: WorkspaceContext,
  providerId: string,
): Promise<AiProviderRow | null> {
  if (!isUuid(providerId)) return null;
  const sql = await getSql();
  const rows = await sql<AiProviderRow>`
    select id, provider, label, encrypted_api_key, base_url, model_default,
           is_enabled, created_at
    from ai_providers
    where id = ${providerId} and workspace_id = ${ctx.workspaceId}
    limit 1
  `;
  return rows[0] ?? null;
}


/** Decrypted key for a workspace provider row (server-internal). */
export function aiProviderSecret(row: AiProviderRow): string | null {
  return decryptSecret(row.encrypted_api_key);
}

export async function upsertAiProvider(
  ctx: WorkspaceContext,
  input: {
    id?: string;
    provider: AiProviderId;
    label: string;
    apiKey?: string;
    baseUrl?: string;
    modelDefault?: string;
    isEnabled: boolean;
  },
): Promise<AiProviderRow> {
  const sql = await getSql();
  const baseUrl = input.baseUrl?.trim() || null;
  const modelDefault = input.modelDefault?.trim() || null;
  // `undefined` → leave the stored key alone. `""` → explicitly clear it.
  const clearKey = input.apiKey !== undefined && input.apiKey.trim() === "";
  const keyUpdate =
    input.apiKey === undefined || clearKey
      ? null
      : encryptSecret(input.apiKey.trim());

  if (isUuid(input.id)) {
    const rows = await sql<AiProviderRow>`
      update ai_providers set
        provider = ${input.provider},
        label = ${input.label},
        base_url = ${baseUrl},
        model_default = ${modelDefault},
        is_enabled = ${input.isEnabled},
        encrypted_api_key = case
          when ${clearKey}::boolean then null
          when ${keyUpdate}::text is null then encrypted_api_key
          else ${keyUpdate}::text
        end
      where id = ${input.id} and workspace_id = ${ctx.workspaceId}
      returning id, provider, label, encrypted_api_key, base_url, model_default,
                is_enabled, created_at
    `;
    if (rows[0]) return rows[0];
  }

  const rows = await sql<AiProviderRow>`
    insert into ai_providers (
      workspace_id, provider, label, encrypted_api_key, base_url, model_default, is_enabled
    ) values (
      ${ctx.workspaceId}, ${input.provider}, ${input.label},
      ${keyUpdate}::text, ${baseUrl}, ${modelDefault}, ${input.isEnabled}
    )
    returning id, provider, label, encrypted_api_key, base_url, model_default,
              is_enabled, created_at
  `;
  const row = rows[0];
  if (!row) throw new Error("failed to save AI provider");
  return row;
}

export async function deleteAiProvider(
  ctx: WorkspaceContext,
  providerId: string,
): Promise<boolean> {
  if (!isUuid(providerId)) return false;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from ai_providers
    where id = ${providerId} and workspace_id = ${ctx.workspaceId}
    returning id
  `;
  return rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * AI runs
 * ------------------------------------------------------------------ */

type AiRunRow = {
  id: string;
  scenario_id: string | null;
  provider: string;
  model: string;
  purpose: AiPurpose;
  prompt_json: unknown;
  response_json: unknown;
  status: AiRunStatus;
  error: string | null;
  created_at: unknown;
  completed_at: unknown;
};

function toAiRun(row: AiRunRow): AiRunDto {
  const response = json<Record<string, unknown> | null>(row.response_json, null);
  const prompt = json<Record<string, unknown> | null>(row.prompt_json, null);
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    provider: row.provider,
    model: row.model,
    purpose: row.purpose,
    status: row.status,
    text: typeof response?.text === "string" ? response.text : null,
    error: row.error,
    createdAt: iso(row.created_at),
    completedAt: row.completed_at == null ? null : iso(row.completed_at),
    usage: response ? toJsonObject(response.usage) : null,
    inputHash: typeof prompt?.inputHash === "string" ? prompt.inputHash : null,
  };
}

export async function createAiRun(
  ctx: WorkspaceContext,
  args: {
    scenarioId?: string | null;
    provider: string;
    model: string;
    purpose: AiPurpose;
    prompt: Record<string, unknown>;
  },
): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    insert into ai_runs (
      workspace_id, scenario_id, provider, model, purpose, prompt_json, status
    ) values (
      ${ctx.workspaceId},
      ${isUuid(args.scenarioId ?? undefined) ? args.scenarioId : null}::uuid,
      ${args.provider}, ${args.model}, ${args.purpose},
      ${jsonParam(args.prompt)}::jsonb, 'running'
    )
    returning id
  `;
  const row = rows[0];
  if (!row) throw new Error("failed to create AI run");
  return row.id;
}

export async function finishAiRun(
  ctx: WorkspaceContext,
  args: {
    id: string;
    status: "succeeded" | "failed";
    response?: Record<string, unknown> | null;
    error?: string | null;
  },
): Promise<AiRunDto | null> {
  const sql = await getSql();
  const rows = await sql<AiRunRow>`
    update ai_runs set
      status = ${args.status},
      response_json = ${jsonParam(args.response ?? null)}::jsonb,
      error = ${args.error ?? null},
      completed_at = now()
    where id = ${args.id} and workspace_id = ${ctx.workspaceId}
    returning id, scenario_id, provider, model, purpose, prompt_json,
              response_json, status, error, created_at, completed_at
  `;
  const row = rows[0];
  return row ? toAiRun(row) : null;
}

export async function listAiRuns(
  ctx: WorkspaceContext,
  query: { scenarioId?: string; limit: number },
): Promise<AiRunDto[]> {
  const sql = await getSql();
  const scenarioId = isUuid(query.scenarioId) ? query.scenarioId : null;
  const rows = await sql<AiRunRow>`
    select id, scenario_id, provider, model, purpose, prompt_json,
           response_json, status, error, created_at, completed_at
    from ai_runs
    where workspace_id = ${ctx.workspaceId}
      and (${scenarioId}::uuid is null or scenario_id = ${scenarioId}::uuid)
    order by created_at desc
    limit ${query.limit}
  `;
  return rows.map(toAiRun);
}

/* ------------------------------------------------------------------ *
 * CRM connections + sync events
 * ------------------------------------------------------------------ */

export type CrmConnectionRow = {
  id: string;
  provider: string;
  base_url: string;
  encrypted_api_key: string | null;
  webhook_secret: string | null;
  is_enabled: boolean;
  created_at: unknown;
};

/** Browser-visible connection shape: no key, no webhook secret, only presence. */
export function crmConnectionDto(
  row: CrmConnectionRow,
  hasEnvKey: boolean,
): CrmConnectionDto {
  return {
    id: row.id,
    provider: row.provider,
    baseUrl: row.base_url,
    isEnabled: row.is_enabled,
    hasKey: Boolean(row.encrypted_api_key) || hasEnvKey,
    keyHint: keyHint(row.encrypted_api_key),
    hasWebhookSecret: Boolean(row.webhook_secret),
    webhookPath: `/api/crm/figgy/webhook?connection=${row.id}`,
    createdAt: iso(row.created_at),
  };
}

export async function listCrmConnectionRows(
  ctx: WorkspaceContext,
): Promise<CrmConnectionRow[]> {
  const sql = await getSql();
  return sql<CrmConnectionRow>`
    select id, provider, base_url, encrypted_api_key, webhook_secret,
           is_enabled, created_at
    from crm_connections
    where workspace_id = ${ctx.workspaceId}
    order by created_at asc
    limit 1
  `;
}

/** Decrypted CRM credentials for the outbound push / webhook verification. */
export function crmConnectionSecrets(row: CrmConnectionRow): {
  apiKey: string | null;
  webhookSecret: string | null;
} {
  return {
    apiKey: decryptSecret(row.encrypted_api_key),
    webhookSecret: row.webhook_secret,
  };
}

/** Workspace-agnostic lookup used by the inbound webhook (which has no session). */
export async function getCrmConnectionById(
  connectionId: string,
): Promise<{ row: CrmConnectionRow; workspaceId: string } | null> {
  if (!isUuid(connectionId)) return null;
  const sql = await getSql();
  const rows = await sql<CrmConnectionRow & { workspace_id: string }>`
    select id, workspace_id, provider, base_url, encrypted_api_key,
           webhook_secret, is_enabled, created_at
    from crm_connections
    where id = ${connectionId}
    limit 1
  `;
  const row = rows[0];
  return row ? { row, workspaceId: row.workspace_id } : null;
}

export async function upsertCrmConnection(
  ctx: WorkspaceContext,
  input: {
    baseUrl: string;
    apiKey?: string;
    webhookSecret?: string;
    isEnabled: boolean;
  },
): Promise<{ row: CrmConnectionRow; webhookSecret: string | null }> {
  const sql = await getSql();
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const clearKey = input.apiKey !== undefined && input.apiKey.trim() === "";
  const keyUpdate =
    input.apiKey === undefined || clearKey
      ? null
      : encryptSecret(input.apiKey.trim());
  const secretProvided = input.webhookSecret !== undefined;
  const rotatedSecret =
    input.webhookSecret && input.webhookSecret.trim() !== ""
      ? input.webhookSecret.trim()
      : null;

  const existing = await listCrmConnectionRows(ctx);
  if (existing[0]) {
    const rows = await sql<CrmConnectionRow>`
      update crm_connections set
        base_url = ${baseUrl},
        is_enabled = ${input.isEnabled},
        encrypted_api_key = case
          when ${clearKey}::boolean then null
          when ${keyUpdate}::text is null then encrypted_api_key
          else ${keyUpdate}::text
        end,
        webhook_secret = case
          when ${secretProvided}::boolean then ${rotatedSecret}::text
          else webhook_secret
        end
      where id = ${existing[0].id} and workspace_id = ${ctx.workspaceId}
      returning id, provider, base_url, encrypted_api_key, webhook_secret,
                is_enabled, created_at
    `;
    const row = rows[0] ?? existing[0];
    return { row, webhookSecret: row.webhook_secret };
  }

  const generated = rotatedSecret ?? randomWebhookSecret();
  const rows = await sql<CrmConnectionRow>`
    insert into crm_connections (
      workspace_id, provider, base_url, encrypted_api_key, webhook_secret, is_enabled
    ) values (
      ${ctx.workspaceId}, 'figgy', ${baseUrl}, ${keyUpdate}::text, ${generated},
      ${input.isEnabled}
    )
    returning id, provider, base_url, encrypted_api_key, webhook_secret,
              is_enabled, created_at
  `;
  const row = rows[0];
  if (!row) throw new Error("failed to save CRM connection");
  return { row, webhookSecret: row.webhook_secret };
}

/** A 32-byte hex secret the operator pastes into Figgy's webhook settings. */
function randomWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deleteCrmConnection(ctx: WorkspaceContext): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from crm_connections
    where workspace_id = ${ctx.workspaceId}
    returning id
  `;
  return rows.length > 0;
}

export async function recordCrmSyncEvent(args: {
  workspaceId: string;
  scenarioId?: string | null;
  connectionId?: string | null;
  direction: "outbound" | "inbound";
  eventType: string;
  request?: unknown;
  response?: unknown;
  status: "queued" | "succeeded" | "failed";
  error?: string | null;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into crm_sync_events (
      workspace_id, scenario_id, connection_id, direction, event_type,
      request_json, response_json, status, error
    ) values (
      ${args.workspaceId},
      ${isUuid(args.scenarioId ?? undefined) ? args.scenarioId : null}::uuid,
      ${isUuid(args.connectionId ?? undefined) ? args.connectionId : null}::uuid,
      ${args.direction}, ${args.eventType},
      ${jsonParam(args.request ?? null)}::jsonb,
      ${jsonParam(truncateForLog(args.response))}::jsonb,
      ${args.status}, ${args.error ?? null}
    )
  `;
}

/**
 * CRM payloads are logged for audit, but an unbounded body would bloat the table
 * (and could echo back a credential a vendor sent us). Cap it.
 */
function truncateForLog(value: unknown, limit = 4000): unknown {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= limit) return value;
    return { truncated: true, preview: text.slice(0, limit) };
  } catch {
    return { truncated: true, preview: "[unserializable]" };
  }
}

export async function listCrmSyncEvents(
  ctx: WorkspaceContext,
  limit: number,
): Promise<CrmSyncEventDto[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    scenario_id: string | null;
    connection_id: string | null;
    direction: "outbound" | "inbound";
    event_type: string;
    status: "queued" | "succeeded" | "failed";
    error: string | null;
    created_at: unknown;
  }>`
    select id, scenario_id, connection_id, direction, event_type, status,
           error, created_at
    from crm_sync_events
    where workspace_id = ${ctx.workspaceId}
    order by created_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    scenarioId: row.scenario_id,
    connectionId: row.connection_id,
    direction: row.direction,
    eventType: row.event_type,
    status: row.status,
    error: row.error,
    createdAt: iso(row.created_at),
  }));
}

/* ------------------------------------------------------------------ *
 * MCP gateway: client registry + call audit
 * ------------------------------------------------------------------ */

export type McpClientRow = {
  id: string;
  workspace_id: string;
  name: string;
  client_type: string;
  token_hash: string | null;
  is_enabled: boolean;
  created_at: unknown;
};

export type McpCallRow = {
  id: string;
  workspace_id: string | null;
  client_id: string | null;
  user_id: string | null;
  client_name: string | null;
  client_version: string | null;
  tool_name: string | null;
  resource_uri: string | null;
  prompt_name: string | null;
  status: "succeeded" | "failed" | "rejected";
  error: string | null;
  created_at: unknown;
};

/** Resolve an MCP client by its hashed token, returning the client row only. */
export async function findMcpClientByTokenHash(
  tokenHash: string,
): Promise<McpClientRow | null> {
  const sql = await getSql();
  const rows = await sql<McpClientRow>`
    select id, workspace_id, name, client_type, token_hash, is_enabled, created_at
    from mcp_clients
    where token_hash = ${tokenHash}
      and is_enabled = true
    limit 1
  `;
  return rows[0] ?? null;
}

/** A workspace-scoped context built from a workspace id (no auth identity). */
export async function workspaceContextById(
  workspaceId: string,
): Promise<WorkspaceContext | null> {
  if (!isUuid(workspaceId)) return null;
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    name: string;
    owner_user_id: string;
    owner_email: string;
    owner_display_name: string | null;
  }>`
    select w.id, w.name, w.owner_user_id,
           u.email as owner_email, u.display_name as owner_display_name
    from workspaces w
    join users u on u.id = w.owner_user_id
    where w.id = ${workspaceId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.owner_user_id,
    workspaceId: row.id,
    workspaceName: row.name,
    email: row.owner_email,
    displayName: row.owner_display_name,
  };
}

/** Record one MCP call for the audit log. Never throws (audit must not break a call). */
export async function recordMcpCall(args: {
  workspaceId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  clientName?: string | null;
  clientVersion?: string | null;
  toolName?: string | null;
  resourceUri?: string | null;
  promptName?: string | null;
  request?: unknown;
  response?: unknown;
  status: "succeeded" | "failed" | "rejected";
  error?: string | null;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into mcp_calls (
      workspace_id, client_id, user_id, client_name, client_version,
      tool_name, resource_uri, prompt_name, request_json, response_json,
      status, error
    ) values (
      ${isUuid(args.workspaceId ?? undefined) ? args.workspaceId : null}::uuid,
      ${isUuid(args.clientId ?? undefined) ? args.clientId : null}::uuid,
      ${isUuid(args.userId ?? undefined) ? args.userId : null}::uuid,
      ${args.clientName ?? null},
      ${args.clientVersion ?? null},
      ${args.toolName ?? null},
      ${args.resourceUri ?? null},
      ${args.promptName ?? null},
      ${jsonParam(args.request ?? null)}::jsonb,
      ${jsonParam(truncateForLog(args.response))}::jsonb,
      ${args.status},
      ${args.error ?? null}
    )
  `;
}

/** The last N MCP calls for a workspace (admin panel). */
export async function listRecentMcpCalls(
  ctx: WorkspaceContext,
  limit: number,
): Promise<McpCallRow[]> {
  const sql = await getSql();
  return sql<McpCallRow>`
    select id, workspace_id, client_id, user_id, client_name, client_version,
           tool_name, resource_uri, prompt_name, status, error, created_at
    from mcp_calls
    where workspace_id = ${ctx.workspaceId}
    order by created_at desc
    limit ${limit}
  `;
}

/* ------------------------------------------------------------------ *
 * MCP OAuth 2.1 authorization server (clients / codes / tokens)
 * ------------------------------------------------------------------ */

export type OAuthClientRow = {
  id: string;
  workspace_id: string | null;
  client_id: string;
  client_secret_hash: string | null;
  display_name: string;
  auth_method: "public_pkce" | "confidential_client";
  redirect_uris: string[];
  scopes: string[];
  is_enabled: boolean;
  created_at: unknown;
};

export type OAuthTokenRow = {
  token_hash: string;
  kind: "access" | "refresh";
  client_id: string;
  workspace_id: string | null;
  user_id: string | null;
  scopes: string[];
  expires_at: unknown;
  revoked_at: unknown;
  created_at: unknown;
};

/** `text[]` may arrive pre-parsed (both drivers) or as a Postgres array literal. */
function strArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {
      /* not JSON — fall through */
    }
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function toOAuthClientRow(row: Record<string, unknown>): OAuthClientRow {
  return {
    id: String(row.id),
    workspace_id: str(row.workspace_id),
    client_id: String(row.client_id),
    client_secret_hash: str(row.client_secret_hash),
    display_name: String(row.display_name ?? ""),
    auth_method: row.auth_method === "confidential_client" ? "confidential_client" : "public_pkce",
    redirect_uris: strArray(row.redirect_uris),
    scopes: strArray(row.scopes),
    is_enabled: row.is_enabled !== false,
    created_at: row.created_at,
  };
}

/** Register a new OAuth client. The client id/secret hash are produced by the caller. */
export async function registerOAuthClient(args: {
  workspaceId: string;
  clientId: string;
  clientSecretHash: string | null;
  displayName: string;
  authMethod: "public_pkce" | "confidential_client";
  redirectUris: string[];
  scopes: string[];
}): Promise<OAuthClientRow> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    insert into mcp_oauth_clients (
      workspace_id, client_id, client_secret_hash, display_name,
      auth_method, redirect_uris, scopes, is_enabled
    ) values (
      ${args.workspaceId}::uuid,
      ${args.clientId},
      ${args.clientSecretHash},
      ${args.displayName},
      ${args.authMethod},
      ${JSON.stringify(args.redirectUris)}::text[],
      ${JSON.stringify(args.scopes)}::text[],
      true
    )
    returning *
  `;
  if (!rows[0]) throw new Error("failed to register OAuth client");
  return toOAuthClientRow(rows[0]);
}

export async function findOAuthClientByClientId(clientId: string): Promise<OAuthClientRow | null> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from mcp_oauth_clients where client_id = ${clientId} limit 1
  `;
  return rows[0] ? toOAuthClientRow(rows[0]) : null;
}

export async function findOAuthClientById(id: string): Promise<OAuthClientRow | null> {
  if (!isUuid(id)) return null;
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from mcp_oauth_clients where id = ${id}::uuid limit 1
  `;
  return rows[0] ? toOAuthClientRow(rows[0]) : null;
}

export async function listOAuthClients(ctx: WorkspaceContext): Promise<OAuthClientRow[]> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select * from mcp_oauth_clients
    where workspace_id = ${ctx.workspaceId}
    order by created_at desc
  `;
  return rows.map(toOAuthClientRow);
}

export async function deleteOAuthClient(ctx: WorkspaceContext, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from mcp_oauth_clients
    where id = ${id}::uuid and workspace_id = ${ctx.workspaceId}
    returning id
  `;
  return rows.length > 0;
}

/** Store a freshly minted authorization code (hashed), one-time and short-lived. */
export async function insertOAuthCode(args: {
  codeHash: string;
  clientId: string;
  workspaceId: string | null;
  userId: string | null;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string[];
  expiresAt: Date;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into mcp_oauth_codes (
      code_hash, client_id, workspace_id, user_id, redirect_uri,
      code_challenge, code_challenge_method, scopes, expires_at
    ) values (
      ${args.codeHash},
      ${args.clientId},
      ${isUuid(args.workspaceId ?? undefined) ? args.workspaceId : null}::uuid,
      ${isUuid(args.userId ?? undefined) ? args.userId : null}::uuid,
      ${args.redirectUri},
      ${args.codeChallenge},
      ${args.codeChallengeMethod},
      ${JSON.stringify(args.scopes)}::text[],
      ${args.expiresAt}
    )
  `;
}

/**
 * Atomically mark a code used and return it, or null when it is unknown, already
 * used, or expired. The PKCE challenge is verified by the caller against this row.
 */
export async function consumeOAuthCode(codeHash: string): Promise<{
  clientId: string;
  workspaceId: string | null;
  userId: string | null;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string[];
} | null> {
  const sql = await getSql();
  const rows = await sql<{
    client_id: string;
    workspace_id: string | null;
    user_id: string | null;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    scopes: unknown;
  }>`
    update mcp_oauth_codes
    set used_at = now()
    where code_hash = ${codeHash} and used_at is null and expires_at > now()
    returning client_id, workspace_id, user_id, redirect_uri, code_challenge, code_challenge_method, scopes
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    clientId: row.client_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    scopes: strArray(row.scopes),
  };
}

export async function insertOAuthToken(args: {
  tokenHash: string;
  kind: "access" | "refresh";
  clientId: string;
  workspaceId: string | null;
  userId: string | null;
  scopes: string[];
  expiresAt: Date;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into mcp_oauth_tokens (
      token_hash, kind, client_id, workspace_id, user_id, scopes, expires_at
    ) values (
      ${args.tokenHash},
      ${args.kind},
      ${args.clientId},
      ${isUuid(args.workspaceId ?? undefined) ? args.workspaceId : null}::uuid,
      ${isUuid(args.userId ?? undefined) ? args.userId : null}::uuid,
      ${JSON.stringify(args.scopes)}::text[],
      ${args.expiresAt}
    )
  `;
}

export async function findOAuthTokenByHash(tokenHash: string): Promise<OAuthTokenRow | null> {
  const sql = await getSql();
  const rows = await sql<OAuthTokenRow>`
    select token_hash, kind, client_id, workspace_id, user_id, scopes, expires_at, revoked_at, created_at
    from mcp_oauth_tokens
    where token_hash = ${tokenHash}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { ...row, scopes: strArray(row.scopes) };
}

export async function revokeOAuthToken(tokenHash: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ token_hash: string }>`
    update mcp_oauth_tokens
    set revoked_at = now()
    where token_hash = ${tokenHash} and revoked_at is null
    returning token_hash
  `;
  return rows.length > 0;
}
