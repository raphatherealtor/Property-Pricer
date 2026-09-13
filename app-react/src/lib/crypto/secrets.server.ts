/**
 * Secret vault (SERVER-ONLY).
 *
 * Every third-party credential this app stores — AI provider API keys and the
 * Figgy CRM key/webhook secret — is encrypted here before it reaches Postgres,
 * and is decrypted only inside a `createServerFn` handler or a server route.
 * Nothing in this module may ever be imported from client code; the API layer
 * hands the browser *redacted* metadata only (`hasKey` / `keyHint`).
 *
 * Envelope format (single string column, so the schema stays as specified):
 *
 *   v1.<iv-b64url>.<authTag-b64url>.<ciphertext-b64url>      AES-256-GCM
 *
 * The key comes from `APP_ENCRYPTION_KEY` when set (hex, base64 or raw text,
 * ≥ 32 bytes), otherwise it is derived from `BETTER_AUTH_SECRET`, otherwise a
 * process-stable random key is used so local preview still works. The last case
 * is explicitly *not* durable: `isVaultDurable()` reports false and the UI warns
 * that stored keys will not survive a restart.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function env(key: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env[key]?.trim();
  return value ? value : undefined;
}

/** Decode a configured key in hex / base64 / raw form, or null when unusable. */
function decodeConfiguredKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64,}$/.test(raw) && raw.length % 2 === 0) {
    const buf = Buffer.from(raw, "hex");
    if (buf.length >= KEY_BYTES) return buf.subarray(0, KEY_BYTES);
  }
  const b64 = Buffer.from(raw, "base64");
  // A raw passphrase round-trips badly through base64, so only trust the
  // base64 reading when it re-encodes to something of the same shape.
  if (b64.length >= KEY_BYTES && b64.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) {
    return b64.subarray(0, KEY_BYTES);
  }
  const raw_ = Buffer.from(raw, "utf8");
  return createHash("sha256").update(raw_).digest().subarray(0, KEY_BYTES);
}

const globalRef = globalThis as typeof globalThis & {
  __ppSecretVaultKey__?: { key: Buffer; durable: boolean };
};

function vaultKey(): { key: Buffer; durable: boolean } {
  globalRef.__ppSecretVaultKey__ ??= (() => {
    const configured = decodeConfiguredKey(env("APP_ENCRYPTION_KEY"));
    if (configured) return { key: configured, durable: true };
    const derived = decodeConfiguredKey(env("BETTER_AUTH_SECRET"));
    if (derived) return { key: derived, durable: true };
    // Preview / unconfigured: stable for the process (so HMR does not
    // invalidate stored ciphertext) but lost on restart.
    return { key: randomBytes(KEY_BYTES), durable: false };
  })();
  return globalRef.__ppSecretVaultKey__;
}

/**
 * False when the vault key is process-local (no `APP_ENCRYPTION_KEY` and no
 * `BETTER_AUTH_SECRET`). Callers surface this so nobody assumes a key saved in
 * preview will still decrypt after a restart.
 */
export function isVaultDurable(): boolean {
  return vaultKey().durable;
}

/** Encrypt a secret for storage. Never call this in a browser context. */
export function encryptSecret(plaintext: string): string {
  const { key } = vaultKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a stored secret. Returns null for anything malformed, truncated or
 * encrypted under a different key — a credential that cannot be decrypted is a
 * missing credential, never an exception that leaks envelope details.
 */
export function decryptSecret(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  const parts = String(envelope).split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", vaultKey().key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * A non-reversible display hint for a stored key ("sk-live-…3f9a"). Only ever
 * derived from the *decrypted* value, and only the first 4 / last 4 characters
 * survive — never the whole credential, never a prefix long enough to matter.
 */
export function keyHint(envelope: string | null | undefined): string | null {
  const plaintext = decryptSecret(envelope);
  if (!plaintext) return null;
  const trimmed = plaintext.trim();
  if (trimmed.length <= 8) return "•".repeat(8);
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/** HMAC-SHA256 signature as lowercase hex (webhook verification). */
export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex signatures. Length differences short
 * circuit (they are not secret-dependent in a useful way) and anything that is
 * not hex fails closed rather than throwing on a malformed `Buffer`.
 */
export function signaturesMatch(expectedHex: string, providedHex: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(expectedHex) || !/^[0-9a-fA-F]+$/.test(providedHex)) {
    return false;
  }
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(providedHex, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Compare an inbound shared secret (e.g. an `X-Webhook-Secret` header) against
 * the stored plaintext secret in constant time.
 */
export function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
