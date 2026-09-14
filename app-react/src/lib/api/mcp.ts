/**
 * MCP status + admin API (the browser-facing half).
 *
 * The admin panel must be able to show the endpoint, the tool list and recent
 * calls, and to run a real price through the MCP tool — all without the browser
 * ever seeing the MCP token or a provider endpoint. Every value here is derived
 * server-side; the token is only ever reported as "configured / not configured".
 */
import { createServerFn } from "@tanstack/react-start";
import { cloudMiddleware } from "./context.ts";
import { z } from "zod";
import { MCP_OAUTH_SCOPES, type McpScope } from "./schemas.ts";
import type { ClientPresetDto } from "../mcp/clients.ts";

export type { ClientPresetDto };

export type McpToolInfo = { name: string; description: string };

export type McpStatusDto = {
  /** Relative endpoints; the panel prefixes `window.location.origin`. */
  endpoint: string;
  sseEndpoint: string;
  restBridge: {
    toolsList: string;
    toolsCall: string;
    resourcesList: string;
    resourcesRead: string;
    promptsList: string;
    promptsGet: string;
  };
  requireAuth: boolean;
  tokenConfigured: boolean;
  publicBaseUrl: string | null;
  tools: McpToolInfo[];
  rateLimits: { general: number; ai: number; crm: number };
};

export type McpCallDto = {
  id: string;
  clientName: string | null;
  target: string;
  status: "succeeded" | "failed" | "rejected";
  error: string | null;
  createdAt: string;
};

export const getMcpStatus = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async (): Promise<McpStatusDto> => {
    const { listMcpTools } = await import("../mcp/server.ts");
    const { mcpGlobalToken, mcpPublicBaseUrl, mcpRequireAuth } = await import("../mcp/auth.ts");

    return {
      endpoint: "/api/mcp",
      sseEndpoint: "/api/mcp/sse",
      restBridge: {
        toolsList: "/api/mcp/tools/list",
        toolsCall: "/api/mcp/tools/call",
        resourcesList: "/api/mcp/resources/list",
        resourcesRead: "/api/mcp/resources/read",
        promptsList: "/api/mcp/prompts/list",
        promptsGet: "/api/mcp/prompts/get",
      },
      requireAuth: mcpRequireAuth(),
      tokenConfigured: mcpGlobalToken() !== null,
      publicBaseUrl: mcpPublicBaseUrl(),
      tools: listMcpTools().map((t) => ({ name: t.name, description: t.description })),
      rateLimits: { general: 60, ai: 10, crm: 5 },
    };
  });

export const listRecentMcpCalls = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<McpCallDto[]> => {
    const { workspaceFor, listRecentMcpCalls: list } = await import("./store.server.ts");
    const workspace = await workspaceFor(context);
    const rows = await list(workspace, 10);
    return rows.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      target: row.tool_name ?? row.resource_uri ?? row.prompt_name ?? "(handshake)",
      status: row.status,
      error: row.error,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    }));
  });

/** The AI-platform onboarding presets (public catalog; no secrets). */
export const listMcpClientPresets = createServerFn({ method: "POST" }).handler(
  async (): Promise<ClientPresetDto[]> => {
    const { listClientPresets } = await import("../mcp/clients.ts");
    const { mcpPublicBaseUrl } = await import("../mcp/auth.ts");
    return listClientPresets(mcpPublicBaseUrl() || "https://YOUR_DOMAIN");
  },
);

/* ------------------------------------------------------------------ *
 * OAuth 2.1 client registry (operator-managed, per workspace)
 * ------------------------------------------------------------------ */

export type OAuthClientDto = {
  id: string;
  clientId: string;
  displayName: string;
  authMethod: "public_pkce" | "confidential_client";
  redirectUris: string[];
  scopes: McpScope[];
  isEnabled: boolean;
  hasSecret: boolean;
  createdAt: string;
};

function toOAuthClientDto(row: {
  id: string;
  client_id: string;
  display_name: string;
  auth_method: "public_pkce" | "confidential_client";
  redirect_uris: string[];
  scopes: string[];
  is_enabled: boolean;
  client_secret_hash: string | null;
  created_at: unknown;
}): OAuthClientDto {
  return {
    id: row.id,
    clientId: row.client_id,
    displayName: row.display_name,
    authMethod: row.auth_method,
    redirectUris: row.redirect_uris,
    scopes: row.scopes.filter((s): s is McpScope => (MCP_OAUTH_SCOPES as readonly string[]).includes(s)),
    isEnabled: row.is_enabled,
    hasSecret: row.client_secret_hash != null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export const listMcpOAuthClients = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .handler(async ({ context }): Promise<OAuthClientDto[]> => {
    const { workspaceFor, listOAuthClients } = await import("./store.server.ts");
    const workspace = await workspaceFor(context);
    const rows = await listOAuthClients(workspace);
    return rows.map(toOAuthClientDto);
  });

export const registerMcpOAuthClient = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator(
    z.object({
      displayName: z.string().trim().min(1).max(120),
      authMethod: z.enum(["public_pkce", "confidential_client"]),
      redirectUris: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
      scopes: z.array(z.enum(MCP_OAUTH_SCOPES)).min(1),
    }),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ client: OAuthClientDto; clientSecret: string | null }> => {
      const { workspaceFor, registerOAuthClient } = await import("./store.server.ts");
      const { hashToken, randomClientId, randomClientSecret } = await import("../mcp/oauth.server.ts");
      const workspace = await workspaceFor(context);

      const clientId = randomClientId();
      const clientSecret = data.authMethod === "confidential_client" ? randomClientSecret() : null;
      const row = await registerOAuthClient({
        workspaceId: workspace.workspaceId,
        clientId,
        clientSecretHash: clientSecret ? hashToken(clientSecret) : null,
        displayName: data.displayName,
        authMethod: data.authMethod,
        redirectUris: data.redirectUris,
        scopes: data.scopes,
      });
      return { client: toOAuthClientDto(row), clientSecret };
    },
  );

export const deleteMcpOAuthClient = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator((input: unknown): { id: string } => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("expected { id }");
    const id = (input as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) throw new Error("id is required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<boolean> => {
    const { workspaceFor, deleteOAuthClient } = await import("./store.server.ts");
    const workspace = await workspaceFor(context);
    return deleteOAuthClient(workspace, data.id);
  });

/** Run a real price through the MCP tool path (server-side), from supplied inputs. */
export const testMcpPriceScenario = createServerFn({ method: "POST" })
  .middleware([cloudMiddleware])
  .validator(
    (input: unknown): unknown => {
      // Shape validated by the tool's own schema; the validator only checks it is
      // a plain object so the tool receives the same failure path a client would.
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("expected a scenario object");
      }
      return input;
    },
  )
  .handler(
    async ({ data }): Promise<{
      ok: boolean;
      calcVersion: string;
      inputHash: string;
      summary: {
        expectedDomDays: number;
        p50DomDays: number;
        expectedDiscountPct: number;
        netProceeds: number;
        costOfTesting: number;
        flags: string[];
      };
    }> => {
      const { tools } = await import("../mcp/tools.ts");
      const tool = tools.find((t) => t.name === "property_pricer.price_scenario");
      if (!tool) throw new Error("price_scenario tool is not registered");
      const parsed = tool.schema.parse(data);
      const ctx = {
        token: null,
        mode: "anonymous",
        clientId: null,
        clientName: "mcp-admin-panel",
        clientType: "other",
        clientVersion: null,
        workspaceId: null,
        scopes: null,
        getWorkspace: async () => null,
      } as Parameters<typeof tool.run>[1];
      const result = (await tool.run(parsed, ctx)) as {
        ok: boolean;
        calcVersion: string;
        inputHash: string;
        summary: {
          expectedDomDays: number;
          p50DomDays: number;
          expectedDiscountPct: number;
          netProceeds: number;
          costOfTesting: number;
          flags: string[];
        };
      };
      return result;
    },
  );
