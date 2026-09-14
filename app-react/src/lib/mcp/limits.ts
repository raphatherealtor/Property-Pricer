/**
 * In-process MCP rate limiting (SERVER-ONLY).
 *
 * A fixed-window limiter keyed by the bearer token, so a bursty client (or a
 * leaked token) cannot take the engine, the database, or the CRM integration with
 * it. Three tiers, per the spec:
 *
 *   general  60 calls/minute per token
 *   ai       10 AI-generating calls/minute per token
 *   crm       5 Figgy pushes/minute per token
 *
 * The state is per-process: on a serverless platform each warm instance has its
 * own window, which is still correct per-instance and is the honest best a
 * dependency-free limiter can do here. A shared store is the upgrade path if the
 * deployment needs cross-instance accounting.
 */
import { assertApiServerOnly } from "../api/server-only.ts";
import { MCP_RATE_LIMITED, McpError } from "./errors.ts";

assertApiServerOnly("mcp/limits");

export type McpLimitTier = "general" | "ai" | "crm";

const TIER_LIMITS: Record<McpLimitTier, number> = {
  general: 60,
  ai: 10,
  crm: 5,
};

const WINDOW_MS = 60_000;

type Bucket = { windowStart: number; count: number };

export class McpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Assert a call is allowed for this key+tier, or throw `MCP_RATE_LIMITED`. */
  consume(key: string, tier: McpLimitTier): void {
    const limit = TIER_LIMITS[tier];
    const now = Date.now();
    const entry = this.buckets.get(key);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) {
      throw new McpError(
        MCP_RATE_LIMITED,
        `Rate limit exceeded for ${tier} calls (${limit}/minute).`,
        { tier, limit, windowMs: WINDOW_MS },
        429,
      );
    }
  }

  /** Test seam: how many buckets this instance is tracking. */
  size(): number {
    return this.buckets.size;
  }
}

/** One shared limiter per process. */
export const mcpRateLimiter = new McpRateLimiter();
