/**
 * OpenAPI 3.1 document for the MCP server + REST bridge (SERVER-ONLY).
 *
 * Published at `GET /api/openapi.json` so REST/OpenAPI clients (ChatGPT Actions,
 * n8n, Postman, …) can import the full surface — the Streamable HTTP MCP endpoint,
 * the six REST bridge routes, and the client onboarding presets — in one spec.
 *
 * Two security schemes are declared, matching how the gateway authenticates:
 *   1. `mcpOAuth`   — OAuth 2.0 authorization code **with PKCE** (public clients),
 *                     the recommended path for native MCP clients.
 *   2. `mcpBearer`  — the static MCP gateway token as a bearer header (fallback).
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
  listMcpPrompts,
  listMcpResources,
  listMcpTools,
} from "./server.ts";
import { listClientPresetIds } from "./clients.ts";

assertApiServerOnly("mcp/openapi");

const MCP_SCOPES = {
  "mcp:tools": "Call the Property Pricer pricing tools over MCP.",
  "mcp:resources": "Read the scenario and engine resources over MCP.",
  "mcp:prompts": "Use the Property Pricer prompts over MCP.",
} as const;

function bearerResponse(description: string): Record<string, unknown> {
  return {
    "200": {
      description,
      content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
    },
    "400": { description: "Invalid JSON-RPC request or invalid tool arguments." },
    "401": { description: "Missing or invalid bearer token." },
    "413": { description: "MCP payload exceeds the size limit." },
    "429": { description: "Rate limit exceeded." },
  };
}

function jsonRpcBody(summary: string, example: Record<string, unknown>): Record<string, unknown> {
  return {
    description: `A JSON-RPC 2.0 request. ${summary}`,
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["jsonrpc", "id", "method"],
          properties: {
            jsonrpc: { type: "string", const: "2.0" },
            id: { type: ["string", "number"] },
            method: { type: "string" },
            params: { type: "object", additionalProperties: true },
          },
        },
        example,
      },
    },
  };
}

function bridgeOperation(
  operationId: string,
  summary: string,
  requestBody: Record<string, unknown> | null,
  responseSchema: Record<string, unknown>,
): Record<string, unknown> {
  const op: Record<string, unknown> = {
    operationId,
    summary,
    security: [{ mcpBearer: [] }, { mcpOAuth: Object.keys(MCP_SCOPES) }],
    responses: {
      "200": {
        description: "Bridge result (the unwrapped MCP JSON-RPC `result`).",
        content: { "application/json": { schema: responseSchema } },
      },
      "400": { description: "JSON-RPC error mapped to `{ ok: false, error }`." },
      "401": { description: "Missing or invalid bearer token." },
    },
  };
  if (requestBody) op.requestBody = requestBody;
  return op;
}

function jsonObjectSchema(properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: true };
}

export function buildOpenApiDocument(baseUrl = "https://YOUR_DOMAIN"): Record<string, unknown> {
  const host = baseUrl.replace(/\/+$/, "");
  const tools = listMcpTools();
  const resources = listMcpResources();
  const prompts = listMcpPrompts();

  const toolNames = tools.map((t) => t.name);
  const resourceUris = resources.map((r) => r.uri);
  const promptNames = prompts.map((p) => p.name);

  const paths: Record<string, unknown> = {
    "/api/mcp": {
      post: {
        operationId: "mcpJsonRpc",
        summary: "MCP Streamable HTTP (JSON-RPC 2.0) — the native MCP transport.",
        description:
          `Canonical MCP endpoint. Accepts a single JSON-RPC request or a batch, and returns a ` +
          `plain JSON response (the stateless form of Streamable HTTP). Protocol version ${MCP_PROTOCOL_VERSION}; ` +
          `server ${SERVER_TITLE} v${SERVER_VERSION}.`,
        security: [{ mcpBearer: [] }, { mcpOAuth: Object.keys(MCP_SCOPES) }],
        requestBody: jsonRpcBody("A single `tools/call` request.", {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: toolNames[0], arguments: {} },
        }),
        responses: bearerResponse("JSON-RPC 2.0 response (result or error)."),
      },
    },

    "/api/mcp/tools/list": {
      post: bridgeOperation("bridgeListTools", "REST bridge: list MCP tools.", jsonRpcBody("`tools/list`.", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }), {
        type: "object",
        properties: {
          tools: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "description", "inputSchema"],
              properties: {
                name: { type: "string", enum: toolNames },
                description: { type: "string" },
                inputSchema: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      }),
    },

    "/api/mcp/tools/call": {
      post: bridgeOperation("bridgeCallTool", "REST bridge: call one MCP tool.", jsonRpcBody("`tools/call`.", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolNames[0], arguments: {} },
      }), {
        type: "object",
        properties: {
          ok: { type: "boolean", const: true },
          content: {
            type: "array",
            items: { type: "object", properties: { type: { type: "string", const: "json" }, json: {} } },
          },
        },
      }),
    },

    "/api/mcp/resources/list": {
      get: bridgeOperation("bridgeListResources", "REST bridge: list MCP resources.", null, {
        type: "object",
        properties: {
          resources: {
            type: "array",
            items: {
              type: "object",
              required: ["uri", "name", "description", "mimeType"],
              properties: {
                uri: { type: "string", enum: resourceUris },
                name: { type: "string" },
                description: { type: "string" },
                mimeType: { type: "string" },
              },
            },
          },
        },
      }),
    },

    "/api/mcp/resources/read": {
      post: bridgeOperation("bridgeReadResource", "REST bridge: read one MCP resource.", jsonRpcBody("`resources/read`.", {
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: resourceUris[0] },
      }), {
        type: "object",
        properties: { contents: { type: "array", items: { type: "object", additionalProperties: true } } },
      }),
    },

    "/api/mcp/prompts/list": {
      get: bridgeOperation("bridgeListPrompts", "REST bridge: list MCP prompts.", null, {
        type: "object",
        properties: {
          prompts: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "description", "arguments"],
              properties: {
                name: { type: "string", enum: promptNames },
                description: { type: "string" },
                arguments: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      }),
    },

    "/api/mcp/prompts/get": {
      post: bridgeOperation("bridgeGetPrompt", "REST bridge: render one MCP prompt.", jsonRpcBody("`prompts/get`.", {
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: promptNames[0], arguments: {} },
      }), {
        type: "object",
        properties: {
          description: { type: "string" },
          messages: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      }),
    },

    "/api/mcp/clients/presets": {
      get: {
        operationId: "listClientPresets",
        summary: "List the client onboarding presets (public).",
        responses: {
          "200": {
            description: "One preset per supported AI platform.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    presets: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "clientId", "displayName", "transport", "authMethod"],
                        properties: {
                          id: { type: "string", enum: listClientPresetIds() },
                          clientId: { type: "string" },
                          displayName: { type: "string" },
                          transport: { type: "string", enum: ["mcp", "rest"] },
                          authMethod: { type: "string", enum: ["public_pkce", "confidential_client"] },
                          allowedRedirectUriPatterns: { type: "array", items: { type: "string" } },
                          defaultScopes: { type: "array", items: { type: "string" } },
                          description: { type: "string" },
                          setupInstructions: { type: "string" },
                          configSnippet: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/api/mcp/clients/{id}/setup": {
      get: {
        operationId: "getClientPresetSetup",
        summary: "Setup instructions for one client preset (public).",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", enum: listClientPresetIds() },
          },
        ],
        responses: {
          "200": {
            description: "The preset's setup instructions and copy-paste block.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    preset: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "404": { description: "Unknown preset id." },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: `${SERVER_TITLE} MCP API`,
      version: SERVER_VERSION,
      description:
        `${SERVER_TITLE} as a Model Context Protocol server plus a plain REST bridge. ` +
        `The MCP endpoint speaks JSON-RPC 2.0 (Streamable HTTP, protocol ${MCP_PROTOCOL_VERSION}); ` +
        `the /api/mcp/tools|resources|prompts/* routes are a REST-friendly projection of the same tools. ` +
        `Authenticate with OAuth 2.0 authorization code + PKCE (public clients) or the static MCP gateway token as a bearer header.`,
    },
    servers: [{ url: host }],
    security: [{ mcpBearer: [] }],
    tags: [
      { name: "mcp", description: "Native MCP (JSON-RPC 2.0 over Streamable HTTP)." },
      { name: "bridge", description: "REST projection of the MCP tools/resources/prompts." },
      { name: "onboarding", description: "Public client-preset discovery and setup." },
    ],
    paths,
    components: {
      securitySchemes: {
        mcpOAuth: {
          type: "oauth2",
          description:
            "OAuth 2.0 authorization code flow with PKCE (RFC 7636) — the recommended path for public clients " +
            "(native MCP clients with a loopback redirect). The authorization and token URLs are provided by the " +
            "deployment's authorization server; no client secret is required.",
          flows: {
            authorizationCode: {
              authorizationUrl: `${host}/oauth/authorize`,
              tokenUrl: `${host}/oauth/token`,
              refreshUrl: `${host}/oauth/token`,
              scopes: MCP_SCOPES,
              "x-pkce": true,
            },
          },
        },
        mcpBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "MCP gateway token",
          description:
            "The static Property Pricer MCP gateway token. Simple single-token access for " +
            "clients that do not implement an OAuth loop; use OAuth PKCE for multi-client deployments.",
        },
      },
      schemas: {
        McpJsonRpcRequest: jsonObjectSchema(
          {
            jsonrpc: { type: "string", const: "2.0" },
            id: { type: ["string", "number"] },
            method: { type: "string", enum: ["initialize", "ping", "tools/list", "tools/call", "resources/list", "resources/read", "prompts/list", "prompts/get"] },
            params: { type: "object", additionalProperties: true },
          },
          ["jsonrpc", "id", "method"],
        ),
      },
    },
  };
}
