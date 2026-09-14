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
