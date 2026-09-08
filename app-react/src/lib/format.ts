export function usd(n: number, digits = 0): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return (
    sign +
    abs.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    })
  );
}

export function usdCompact(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return usd(n, 0);
}

export function pct(n: number, digits = 1): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}${(Math.abs(n) * 100).toFixed(digits)}%`;
}

export function pctPts(n: number, digits = 1): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${(Math.abs(n) * 100).toFixed(digits)} pts`;
}

export function daysLabel(d: number): string {
  const n = Math.round(d);
  return `${n}d`;
}

export function weeksLabel(w: number): string {
  return `${w.toFixed(1)} wk`;
}

export function bps(n: number): string {
  const v = Math.round(n);
  const sign = v < 0 ? "−" : "+";
  return `${sign}${Math.abs(v)} bps`;
}

export function hashInputs(obj: unknown): string {
  const s = stableStringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
}
