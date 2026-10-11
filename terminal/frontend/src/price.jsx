import { useMemo, useState } from "react";
import { fmtDay, NAMES, pct, toneClass, usd, useApi, useWidth } from "./ui.jsx";

// Monotone cubic path through points (no overshoot), for a clean area chart.
export function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const m = [], t = [];
  for (let k = 0; k < n - 1; k++) m.push((pts[k + 1][1] - pts[k][1]) / (pts[k + 1][0] - pts[k][0] || 1));
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let k = 1; k < n - 1; k++) t[k] = m[k - 1] * m[k] <= 0 ? 0 : (m[k - 1] + m[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (m[k] === 0) { t[k] = 0; t[k + 1] = 0; continue; }
    const a = t[k] / m[k], b = t[k + 1] / m[k], s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); t[k] = tau * a * m[k]; t[k + 1] = tau * b * m[k]; }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let k = 0; k < n - 1; k++) {
    const dx = (pts[k + 1][0] - pts[k][0]) / 3;
    d += ` C${(pts[k][0] + dx).toFixed(1)},${(pts[k][1] + t[k] * dx).toFixed(1)} ${(pts[k + 1][0] - dx).toFixed(1)},${(pts[k + 1][1] - t[k + 1] * dx).toFixed(1)} ${pts[k + 1][0].toFixed(1)},${pts[k + 1][1].toFixed(1)}`;
  }
  return d;
}

// Area chart of daily closes with a hover cursor. `onHover(i|null)` reports the hovered bar.
export function AreaChart({ bars, height = 260, onHover }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const P = { t: 10, b: 28 };
  const vals = bars.map((b) => b.close);
  const lo = Math.min(...vals), hiV = Math.max(...vals), pad = (hiV - lo) * 0.08 || 1;
  const X = (i) => (i / Math.max(1, bars.length - 1)) * w;
  const Y = (v) => P.t + (1 - (v - (lo - pad)) / (hiV - lo + 2 * pad)) * (height - P.t - P.b);
  const pts = bars.map((b, i) => [X(i), Y(b.close)]);
  const line = smoothPath(pts);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (bars.length - 1)));
  const set = (i) => { setHi(i); onHover?.(i); };
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    set(Math.max(0, Math.min(bars.length - 1, Math.round(((e.clientX - r.left) / r.width) * (bars.length - 1)))));
  };
  const h = hi !== null ? bars[hi] : null;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {w > 0 && bars.length > 1 && (
        <svg width={w} height={height} onMouseMove={move} onMouseLeave={() => set(null)} role="img" aria-label="Price chart">
          <defs>
            <linearGradient id="kd-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--kd-price)", stopOpacity: 0.16 }} />
              <stop offset="100%" style={{ stopColor: "var(--kd-price)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <line x1={0} x2={w} y1={Y(vals[0])} y2={Y(vals[0])} style={{ stroke: "var(--kd-dim)", opacity: 0.35 }} strokeDasharray="3 4" />
          <path d={`${line} L${w},${height - P.b} L0,${height - P.b} Z`} fill="url(#kd-area)" />
          <path d={line} fill="none" style={{ stroke: "var(--kd-price)" }} strokeWidth="2" strokeLinejoin="round" />
          {ticks.map((i, k) => (
            <text key={k} x={X(i)} y={height - 8} fontSize="11" textAnchor={k === 0 ? "start" : k === 4 ? "end" : "middle"} style={{ fill: "var(--kd-dim)" }}>
              {fmtDay(bars[i].time, { month: "short", day: "numeric" })}</text>
          ))}
          {h && <>
            <line x1={X(hi)} x2={X(hi)} y1={P.t} y2={height - P.b} style={{ stroke: "var(--kd-price)", opacity: 0.5 }} />
            <circle cx={X(hi)} cy={Y(h.close)} r="3.5" style={{ fill: "var(--kd-price)", stroke: "var(--kd-ground)" }} strokeWidth="1.5" />
          </>}
        </svg>
      )}
      {h && (
        <div className="pointer-events-none absolute border border-rule bg-ground px-2.5 py-1.5 text-xs"
          style={{ left: Math.min(Math.max(0, X(hi) + 12), w - 150), top: Math.max(0, Y(h.close) - 50) }}>
          <div className="font-medium text-ink">{usd(h.close)}</div><div className="text-dim">{fmtDay(h.time)}</div>
        </div>
      )}
    </div>
  );
}

// 1D needs intraday bars, which the API does not serve, so it stays disabled (n/a) rather than faked.
const PERIODS = [
  { k: "1D", api: null, label: "today" },
  { k: "1W", api: "3mo", n: 6, label: "past week", span: "1 week" },
  { k: "1M", api: "3mo", n: 22, label: "past month", span: "1 month" },
  { k: "3M", api: "3mo", label: "past 3 months", span: "3 months" },
  { k: "1Y", api: "1y", label: "past year", span: "1 year" },
  { k: "ALL", api: "2y", label: "past 2 years", span: "2 years", title: "All history the API serves: 2 years" },
];

// Crypto trades every day: a week is 7 daily bars and a month 30, not 6 and 22.
const DAYS_7 = { "1W": 7, "1M": 30 };

export function PriceBlock({ ticker, crypto = false, children }) {
  const [pk, setPk] = useState("1M");
  const base = PERIODS.find((p) => p.k === pk);
  const per = crypto && DAYS_7[pk] ? { ...base, n: DAYS_7[pk] } : base;
  const s = useApi(per.api ? `prices?ticker=${ticker}&period=${per.api}` : null, [ticker]);
  const bars = useMemo(() => (s.data ? (per.n ? s.data.bars.slice(-per.n) : s.data.bars) : []), [s.data, per.n]);
  const [hover, setHover] = useState(null);
  const [name, exch] = NAMES[ticker] || [ticker, null];
  const label = ticker.replace(/-USD$/, "");
  const first = bars[0]?.close, cur = hover !== null ? bars[hover] : bars.at(-1);
  const chg = cur && first ? cur.close - first : null;
  const chgPct = chg !== null ? chg / first : null;
  const up = chg !== null && chg >= 0;
  return (
    <section>
      <h1 className="font-serif text-[30px] font-medium leading-tight text-ink">{name}</h1>
      <div className="kd-label mt-1">{label}{exch ? ` · ${exch}` : ""}</div>
      <div className="mt-5 text-[48px] font-semibold leading-none tracking-tight text-ink" data-testid="price">
        {cur ? usd(cur.close) : s.loading ? "…" : "n/a"}</div>
      <div className="mt-2 h-5 text-sm" data-testid="change">
        {chg !== null ? (
          <><span className={toneClass(chg)}>{chg >= 0 ? "+" : "-"}{usd(Math.abs(chg))} ({pct(chgPct, 2)})</span>{" "}
            <span className="text-dim">{hover !== null ? fmtDay(cur.time) : per.label}</span></>
        ) : <span className="text-dim">{per.api ? (s.loading ? "" : s.status === 404 ? `No price data for ${ticker} on the public site yet` : "n/a") : "Intraday prices: n/a"}</span>}
      </div>
      <div className="kd-box mt-6 px-4 pt-4">
        {bars.length > 1 ? <AreaChart bars={bars} onHover={setHover} /> : (
          <div className="flex h-[260px] items-center justify-center text-sm text-dim">
            {s.loading ? "Loading prices…" : per.api ? "Chart: n/a" : "1D needs intraday prices, which the API does not serve (n/a)"}</div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.k} role="tab" aria-selected={p.k === pk} onClick={() => setPk(p.k)} title={p.title || (p.api ? p.label : "Intraday data not available")}
              className={`border px-2 py-1 text-xs sm:px-3 ${p.k === pk ? "border-rule font-semibold text-ink" : "border-transparent text-dim hover:text-ink"} ${p.api ? "" : "opacity-60"}`}>{p.k}</button>
          ))}
        </div>
        {chg !== null && hover === null && <span className={`text-xs ${up ? "text-up" : "text-down"}`}>{up ? "Up" : "Down"} over {per.span}</span>}
      </div>
      {children}
    </section>
  );
}
