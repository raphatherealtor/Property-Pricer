/**
 * Identity mapping (SERVER-ONLY).
 *
 * Better Auth issues *text* user ids (and the disabled-auth dev fallback uses
 * `"dev-user"`), while `db/app-schema-v1.sql` types `users.id` as `uuid`. Rather
 * than widen the specified schema, the app derives a **deterministic** uuid from
 * the auth id: the same sign-in always lands on the same `users` row, with no
 * extra mapping table and no trust placed in a client-supplied id.
 *
 * The derivation is a plain SHA-256 over a namespaced string, truncated to 128
 * bits with RFC 4122 version/variant bits set. It is one-way and stable; a
 * collision across two distinct auth ids needs ~2^61 rows.
 */
import { createHash } from "node:crypto";

const NAMESPACE = "property-pricer:v1:app-user:";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic `users.id` uuid for a Better Auth user id. */
export function appUserId(authUserId: string): string {
  const digest = createHash("sha256")
    .update(NAMESPACE + String(authUserId), "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** True for a canonical 8-4-4-4-12 uuid — the shape every `*_id` param must have. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * A syntactically valid, deterministic placeholder email for identities the
 * broker never handed an address for (X issues synthetic ones). `users.email` is
 * `unique not null`, so a row always needs something; `.invalid` is reserved by
 * RFC 2606 and can never resolve to a real mailbox.
 */
export function fallbackEmail(appUserUuid: string): string {
  return `${appUserUuid}@users.pp.invalid`;
}
