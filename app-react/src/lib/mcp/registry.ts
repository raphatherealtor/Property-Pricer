/**
 * MCP registry (SERVER-ONLY).
 *
 * The single source of truth for what this server exposes: every tool, resource
 * and prompt is registered here with its metadata, its zod input schema, and the
 * handler that runs it. The JSON-RPC dispatcher (`server.ts`) and the REST bridge
 * both read this registry, so the two transports can never list different tools.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import type { z } from "zod";
import type { McpContext } from "./context.ts";
import type { McpLimitTier } from "./limits.ts";

assertApiServerOnly("mcp/registry");

export type ToolDefinition = {
  name: string;
  description: string;
  /** Zod schema for the tool arguments; also emitted as JSON Schema. */
  schema: z.ZodType;
  inputSchema: Record<string, unknown>;
  /** Rate-limit tier this tool consumes. */
  tier: McpLimitTier;
  /** Run the tool. `args` is the zod-parsed, typed input. */
  run: (args: unknown, ctx: McpContext) => Promise<unknown>;
};

export type ResourceDefinition = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  /** Null for static resources; the concrete URI otherwise (may contain a param). */
  template?: boolean;
  read: (uri: string, ctx: McpContext) => Promise<{ uri: string; mimeType: string; text: string }>;
};

export type PromptDefinition = {
  name: string;
  description: string;
  argumentsSchema: z.ZodType;
  /** Render the prompt to messages, reading scenario context from the store. */
  get: (args: unknown, ctx: McpContext) => Promise<{
    description: string;
    messages: { role: "user"; content: string }[];
  }>;
};

/** Emit a JSON Schema object from a zod schema (draft-07). */
import { toJsonSchema } from "./schemas.ts";

export function toolInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return toJsonSchema(schema);
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function jsonContent(value: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent: unknown;
} {
  return {
    content: [{ type: "text", text: jsonText(value) }],
    structuredContent: value,
  };
}
