import { useEffect, useState } from "react";

// Shared helpers and the panel frame used by every Knight-Daddy panel.
export const api = async (path, opts) => {
  const r = await fetch(`/api/${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `${r.status} ${r.statusText}`);
  return j;
};
export const pct = (x, d = 1) => (x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
export const money = (x) => "$" + Math.round(x).toLocaleString();
export const tone = (x) => (x > 0 ? "text-up" : x < 0 ? "text-down" : "text-flat");
export const TAG = { Bullish: "text-up border-up/50", Bearish: "text-down border-down/50", Neutral: "text-flat border-flat/40" };

// Load data for a ticker-dependent panel; returns {data, err, loading}.
export function useApi(path, deps) {
  const [s, set] = useState({ data: null, err: null, loading: false });
  useEffect(() => {
    if (!path) return;
    let live = true;
    set({ data: null, err: null, loading: true });
    api(path).then((data) => live && set({ data, err: null, loading: false }))
      .catch((e) => live && set({ data: null, err: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

// Panel frame. `collapsed` shows only the header plus `summary` (a glanceable one-liner); the chevron toggles it.
export function Panel({ code, title, right, summary, children, className = "", collapsed = false, onToggle }) {
  return (
    <section className={`flex min-h-0 flex-col border border-line bg-panel ${className}`}>
      <header className={`kw-drag flex cursor-move items-center gap-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${collapsed ? "" : "border-b border-line"}`}>
        {onToggle && (
          <button onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
            className="w-3 text-dim hover:text-amber">{collapsed ? "▸" : "▾"}</button>
        )}
        <span className="bg-amber px-1 font-bold text-ground">{code}</span>
        <span className="font-semibold text-amber">{title}</span>
        {collapsed && summary && <span className="ml-2 flex min-w-0 items-center gap-2 truncate normal-case tracking-normal">{summary}</span>}
        <span className="ml-auto normal-case tracking-normal text-dim">{right}</span>
      </header>
      {!collapsed && <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1">{children}</div>}
    </section>
  );
}

// One-word color-coded signal: green Bullish / red Bearish / gray Neutral (any other tone via `tone`).
const SIG = { Bullish: ["bg-up", "text-up", "BULLISH"], Bearish: ["bg-down", "text-down", "BEARISH"], Neutral: ["bg-flat", "text-flat", "NEUTRAL"] };
export const Signal = ({ label, word, tone: t, title }) => {
  const [dot, txt, w] = SIG[label] || [t === "amber" ? "bg-amber" : "bg-dim", t === "amber" ? "text-amber" : "text-dim", ""];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap font-semibold ${txt}`} title={title}>
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />{word || w}
    </span>
  );
};
export const scoreLabel = (x, thr = 0.2) => (x > thr ? "Bullish" : x < -thr ? "Bearish" : "Neutral");

// Tiny inline line chart; `zero` draws a baseline at 0. Values may contain nulls (skipped).
export function Sparkline({ values, w = 90, h = 18, color = "#ffb000", zero = false, title }) {
  const v = values.map((x, i) => [i, x]).filter(([, x]) => x !== null && x !== undefined);
  if (v.length < 2) return null;
  const ys = v.map(([, x]) => x), lo = Math.min(...ys, zero ? 0 : Infinity), hi = Math.max(...ys, zero ? 0 : -Infinity);
  const X = (i) => (i / (values.length - 1)) * w, Y = (x) => h - 1 - ((x - lo) / (hi - lo || 1)) * (h - 2);
  return (
    <svg width={w} height={h} className="inline-block align-middle" role="img" aria-label={title}>
      {title && <title>{title}</title>}
      {zero && <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="#2a3038" />}
      <path d={v.map(([i, x], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  );
}

// Stacked bull / neutral / bear share bar, with counts on hover.
export const MixBar = ({ c, w = 70 }) => {
  const b = c.Bullish || 0, n = c.Neutral || 0, r = c.Bearish || 0, t = b + n + r || 1;
  return (
    <span className="inline-flex h-1.5 overflow-hidden align-middle" style={{ width: w }} title={`${b} bullish / ${n} neutral / ${r} bearish`}>
      <span className="bg-up" style={{ width: `${(b / t) * 100}%` }} /><span className="bg-flat/50" style={{ width: `${(n / t) * 100}%` }} />
      <span className="bg-down" style={{ width: `${(r / t) * 100}%` }} />
    </span>
  );
};

export const Status = ({ s, what }) =>
  s.loading ? <div className="text-dim">loading {what}<span className="animate-pulse">_</span></div>
  : s.err ? <div className="text-down">ERR {s.err}</div> : null;

