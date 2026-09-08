import { HORIZON_WEEKS, M_BASE } from "@/engine/survival";
import type { CostPoint, EngineOutput } from "@/engine/types";
import { usd, usdCompact } from "@/lib/format";
import { useId, useMemo, useState } from "react";

function xmap(w: number, x0: number, x1: number) {
  return x0 + (w / HORIZON_WEEKS) * (x1 - x0);
}
function ymap(s: number, y0: number, y1: number) {
  return y1 - s * (y1 - y0);
}

export function SurvivalChart({
  out,
  actualDom,
  variant = "light",
}: {
  out: EngineOutput;
  actualDom: number | null;
  variant?: "light" | "dark";
}) {
  const uid = useId();
  const W = 640;
  const H = 268;
  const pad = { l: 42, r: 16, t: 18, b: 32 };
  const x0 = pad.l;
  const x1 = W - pad.r;
  const y0 = pad.t;
  const y1 = H - pad.b;
  const pts = out.survival;
  const d = useMemo(() => {
    if (!pts.length) return "";
    return pts
      .map((p, i) => {
        const x = xmap(p.w, x0, x1);
        const y = ymap(p.s, y0, y1);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [pts, x0, x1, y0, y1]);
  const area = `${d} L${xmap(HORIZON_WEEKS, x0, x1)},${y1} L${x0},${y1} Z`;
  const p50w = Math.min(HORIZON_WEEKS, out.p50DomDays / 7);
  const w120 = Math.min(HORIZON_WEEKS, 120 / 7);
  const s120 = pts.reduce((best, p) => (Math.abs(p.w - w120) < Math.abs(best.w - w120) ? p : best), pts[0] ?? { w: 0, s: 1 });
  const ink = variant === "dark" ? "#E8EDF7" : "#16181D";
  const muted = variant === "dark" ? "#8FA1C0" : "#6B7280";
  const grid = variant === "dark" ? "#22304A" : "#E4E2DC";
  const fill = variant === "dark" ? "url(#survFillDark" + uid + ")" : "url(#survFill" + uid + ")";
  const cursorW = actualDom && actualDom > 0 ? Math.min(HORIZON_WEEKS, actualDom / 7) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Time-warped survival curve">
      <defs>
        <linearGradient id={`survFill${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D9488" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#0D9488" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={`survFillDark${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D9488" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0D9488" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((s) => (
        <g key={s}>
          <line x1={x0} x2={x1} y1={ymap(s, y0, y1)} y2={ymap(s, y0, y1)} stroke={grid} strokeWidth="1" />
          <text x={x0 - 8} y={ymap(s, y0, y1) + 3} textAnchor="end" fill={muted} fontSize="9" fontFamily="JetBrains Mono, monospace">
            {s.toFixed(2)}
          </text>
        </g>
      ))}
      {[0, 4, 8, 12, 17.14, 22, 26].map((w) => (
        <line key={w} x1={xmap(w, x0, x1)} x2={xmap(w, x0, x1)} y1={y0} y2={y1} stroke={grid} strokeWidth="1" strokeDasharray={Math.abs(w - 17.14) < 0.2 ? "3 3" : "0"} />
      ))}
      <line
        x1={xmap(w120, x0, x1)}
        x2={xmap(w120, x0, x1)}
        y1={y0}
        y2={y1}
        stroke="#D97706"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <path d={area} fill={fill} />
      <path d={d} fill="none" stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={xmap(p50w, x0, x1)} cy={ymap(0.5, y0, y1)} r="4.5" fill="#2563EB" stroke={variant === "dark" ? "#0B1220" : "#FAFAF8"} strokeWidth="2" />
      <text x={xmap(p50w, x0, x1) + 8} y={ymap(0.5, y0, y1) - 8} fill="#2563EB" fontSize="9" fontFamily="JetBrains Mono, monospace">
        p50 {Math.round(out.p50DomDays)}d
      </text>
      <text x={xmap(w120, x0, x1) + 6} y={y0 + 12} fill="#D97706" fontSize="9" fontFamily="JetBrains Mono, monospace">
        120d  {(s120.s * 100).toFixed(0)}%
      </text>
      {cursorW !== null ? (
        <g>
          <line x1={xmap(cursorW, x0, x1)} x2={xmap(cursorW, x0, x1)} y1={y0} y2={y1} stroke="#2563EB" strokeWidth="1.25" />
          <text x={xmap(cursorW, x0, x1) + 6} y={y1 - 8} fill="#2563EB" fontSize="9" fontFamily="JetBrains Mono, monospace">
            actual {Math.round(cursorW * 7)}d
          </text>
        </g>
      ) : null}
      {[0, 8, 17, 26].map((w) => (
        <text key={w} x={xmap(w, x0, x1)} y={H - 10} textAnchor="middle" fill={muted} fontSize="9" fontFamily="JetBrains Mono, monospace">
          {w === 17 ? "17w" : `${w}w`}
        </text>
      ))}
      <text x={x0} y={12} fill={muted} fontSize="9" fontFamily="Manrope, sans-serif">
        S(w)  ·  κ_eff {out.kappaEff.toFixed(3)}  ·  M_base {M_BASE.toFixed(2)}w
      </text>
    </svg>
  );
}

export function CostCurve({
  points,
  current,
  variant = "light",
}: {
  points: CostPoint[];
  current: number;
  variant?: "light" | "dark";
}) {
  const uid = useId();
  const W = 640;
  const H = 220;
  const pad = { l: 52, r: 16, t: 16, b: 30 };
  const x0 = pad.l;
  const x1 = W - pad.r;
  const y0 = pad.t;
  const y1 = H - pad.b;
  if (points.length < 2) return null;
  const xs = points.map((p) => p.overshoot);
  const ys = points.map((p) => p.cost);
  const xmin = xs[0];
  const xmax = xs[xs.length - 1];
  const ymin = Math.min(...ys, 0);
  const ymax = Math.max(...ys, 0);
  const span = Math.max(1000, ymax - ymin);
  const padY = span * 0.08;
  const yLo = ymin - padY;
  const yHi = ymax + padY;
  const X = (o: number) => x0 + ((o - xmin) / (xmax - xmin)) * (x1 - x0);
  const Y = (c: number) => y1 - ((c - yLo) / (yHi - yLo)) * (y1 - y0);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${X(p.overshoot).toFixed(1)},${Y(p.cost).toFixed(1)}`)
    .join(" ");
  const zeroY = Y(0);
  const ink = variant === "dark" ? "#E8EDF7" : "#16181D";
  const muted = variant === "dark" ? "#8FA1C0" : "#6B7280";
  const grid = variant === "dark" ? "#22304A" : "#E4E2DC";
  const cur = points.reduce((b, p) => (Math.abs(p.overshoot - current) < Math.abs(b.overshoot - current) ? p : b), points[0]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Convex cost of testing">
      <defs>
        <linearGradient id={`pos${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#DC2626" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#DC2626" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={`neg${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D9488" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#0D9488" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <line x1={x0} x2={x1} y1={zeroY} y2={zeroY} stroke={grid} strokeWidth="1" />
      <path d={`${d} L${X(xmax)},${zeroY} L${X(xmin)},${zeroY} Z`} fill={`url(#${cur.cost >= 0 ? "pos" : "neg"}${uid})`} />
      <path d={d} fill="none" stroke={ink} strokeWidth="2" />
      <circle cx={X(cur.overshoot)} cy={Y(cur.cost)} r="4.5" fill="#2563EB" stroke={variant === "dark" ? "#0B1220" : "#fff"} strokeWidth="2" />
      <text x={X(cur.overshoot) + 8} y={Y(cur.cost) - 8} fill="#2563EB" fontSize="9" fontFamily="JetBrains Mono, monospace">
        {usdCompact(cur.cost)}
      </text>
      {[-0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.25].map((o) =>
        o >= xmin && o <= xmax ? (
          <text key={o} x={X(o)} y={H - 8} textAnchor="middle" fill={muted} fontSize="9" fontFamily="JetBrains Mono, monospace">
            {o === 0 ? "0" : `${o > 0 ? "+" : ""}${(o * 100).toFixed(0)}%`}
          </text>
        ) : null,
      )}
      <text x={x0 - 6} y={Y(0) + 3} textAnchor="end" fill={muted} fontSize="9" fontFamily="JetBrains Mono, monospace">
        0
      </text>
    </svg>
  );
}

export function Waterfall({
  out,
  variant = "light",
}: {
  out: EngineOutput;
  variant?: "light" | "dark";
}) {
  const lines = out.holdbackLines;
  const total = out.scaledHoldback;
  const max = Math.max(total, out.holdbackFullReplacement, 1);
  const ink = variant === "dark" ? "#E8EDF7" : "#16181D";
  const muted = variant === "dark" ? "#8FA1C0" : "#3F4550";
  const track = variant === "dark" ? "#22304A" : "#E4E2DC";
  const colors = ["#0D9488", "#2563EB", "#D97706"];
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <div key={l.system} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium" style={{ color: ink }}>
              {l.system}
              {l.terminal ? (
                <span className="ml-1.5 text-3xs tracking-wider uppercase text-red">Terminal</span>
              ) : null}
            </span>
            <span className="num text-xs" style={{ color: muted }}>
              {l.age}y / {l.life}y · {usd(l.amount)}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: track }}>
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.min(100, (l.amount / max) * 100)}%`, background: colors[i] }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between pt-1 border-t" style={{ borderColor: track }}>
        <span className="label-kicker">Scaled holdback · M_class {out.classMultiplier.toFixed(2)}</span>
        <span className="num text-sm font-medium" style={{ color: ink }}>
          {usd(total)}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="label-kicker">Full replacement ceiling</span>
        <span className="num text-xs" style={{ color: muted }}>
          {usd(out.holdbackFullReplacement)}
        </span>
      </div>
    </div>
  );
}

export function BracketChart({
  ask,
  baseline,
  captureAsk,
  captureBase,
  captureBelow,
  variant = "light",
}: {
  ask: number;
  baseline: number;
  captureAsk: number;
  captureBase: number;
  captureBelow: number;
  variant?: "light" | "dark";
}) {
  const muted = variant === "dark" ? "#8FA1C0" : "#3F4550";
  const ink = variant === "dark" ? "#E8EDF7" : "#16181D";
  const grain = 50000;
  const rows = [
    { label: `Just under ${usdCompact(Math.floor(baseline / grain) * grain)}`, v: captureBelow, c: "#0D9488" },
    { label: `At baseline ${usdCompact(baseline)}`, v: captureBase, c: "#2563EB" },
    { label: `At ask ${usdCompact(ask)}`, v: captureAsk, c: "#D97706" },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1">
          <div className="flex justify-between text-xs" style={{ color: muted }}>
            <span>{r.label}</span>
            <span className="num" style={{ color: ink }}>
              {(r.v * 100).toFixed(0)}% capture
            </span>
          </div>
          <div className="h-8 rounded-md overflow-hidden" style={{ background: variant === "dark" ? "#22304A" : "#E4E2DC" }}>
            <div
              className="h-full rounded-md transition-[width] duration-300"
              style={{ width: `${r.v * 100}%`, background: r.c }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiscountBridge({
  baseline,
  expectedSale,
  staleFloor,
  variant = "light",
}: {
  baseline: number;
  expectedSale: number;
  staleFloor: number;
  variant?: "light" | "dark";
}) {
  const max = Math.max(baseline, expectedSale, staleFloor);
  const bars = [
    { label: "Baseline value", v: baseline, c: "#2563EB" },
    { label: "Expected offer", v: expectedSale, c: "#0D9488" },
    { label: "8.4% stale floor", v: staleFloor, c: "#D97706" },
  ];
  const ink = variant === "dark" ? "#E8EDF7" : "#16181D";
  const muted = variant === "dark" ? "#8FA1C0" : "#3F4550";
  const track = variant === "dark" ? "#22304A" : "#F3F4F6";
  return (
    <div className="grid grid-cols-3 gap-3 items-end h-full">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-col items-stretch gap-2 h-56">
          <div className="flex-1 flex items-end rounded-md overflow-hidden" style={{ background: track }}>
            <div
              className="w-full rounded-sm transition-[height] duration-300"
              style={{ height: `${(b.v / max) * 100}%`, background: b.c }}
            />
          </div>
          <div className="num text-sm font-medium" style={{ color: ink }}>
            {usd(b.v)}
          </div>
          <div className="text-2xs leading-tight" style={{ color: muted }}>
            {b.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AskSlider({
  baseline,
  value,
  onChange,
  dark = false,
}: {
  baseline: number;
  value: number;
  onChange: (n: number) => void;
  dark?: boolean;
}) {
  const min = Math.round(baseline * 0.9);
  const max = Math.round(baseline * 1.25);
  const u = baseline > 0 ? value / baseline - 1 : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="label-kicker">Live asking price</span>
        <span className={`num text-sm font-medium ${dark ? "text-dark-ink" : "text-ink"}`}>
          {usd(value)}{" "}
          <span className={u >= 0 ? "text-amber" : "text-teal"}>
            {u >= 0 ? "+" : ""}
            {(u * 100).toFixed(1)}%
          </span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1000}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue h-2"
        aria-label="Asking price"
      />
      <div className={`flex justify-between text-3xs num ${dark ? "text-dark-muted" : "text-gray"}`}>
        <span>{usd(min)}</span>
        <span>baseline {usd(baseline)}</span>
        <span>{usd(max)}</span>
      </div>
    </div>
  );
}

export function HazardBars({
  out,
  variant = "light",
}: {
  out: EngineOutput;
  variant?: "light" | "dark";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const bars = out.survival.slice(0, -1).map((p, i) => {
    const next = out.survival[i + 1];
    return { w: p.w, pSale: Math.max(0, p.s - next.s) };
  });
  const max = Math.max(...bars.map((b) => b.pSale), 0.001);
  const fill = variant === "dark" ? "#8FA1C0" : "#16181D";
  const active = "#2563EB";
  return (
    <div className="flex items-end gap-px h-16 w-full">
      {bars.map((b, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-colors"
          style={{
            height: `${(b.pSale / max) * 100}%`,
            background: hover === i ? active : fill,
            opacity: hover === null || hover === i ? 1 : 0.35,
          }}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={`Week ${b.w.toFixed(1)} · ${(b.pSale * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}
