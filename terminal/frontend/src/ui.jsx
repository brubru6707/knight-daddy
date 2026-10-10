import { useEffect, useLayoutEffect, useState } from "react";

// Shared helpers for the Knight-Daddy UI. All data comes from /api (terminal/frontend/api/kw.js); nothing is simulated.
export const api = async (path, opts) => {
  const r = await fetch(`/api/${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.detail || `${r.status} ${r.statusText}`);
    e.status = r.status;
    throw e;
  }
  return j;
};

export const pct = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
export const money = (x) => (x === null || x === undefined ? "n/a" : "$" + Math.round(x).toLocaleString("en-US"));
export const usd = (x) => (x === null || x === undefined ? "n/a" : "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const toneClass = (x) => (x > 0 ? "text-up" : x < 0 ? "text-down" : "text-flat");
export const TAG = { Bullish: "text-up", Bearish: "text-down", Neutral: "text-flat" };
export const DOT = { Bullish: "bg-up", Bearish: "bg-down", Neutral: "bg-flat" };
export const scoreLabel = (x, thr = 0.2) => (x > thr ? "Bullish" : x < -thr ? "Bearish" : "Neutral");

// Static reference data (names and peers), not market data.
export const NAMES = {
  NVDA: ["NVIDIA Corporation", "NASDAQ"], DDOG: ["Datadog, Inc.", "NASDAQ"], AAPL: ["Apple Inc.", "NASDAQ"],
  TSLA: ["Tesla, Inc.", "NASDAQ"], CELH: ["Celsius Holdings, Inc.", "NASDAQ"], SMCI: ["Super Micro Computer, Inc.", "NASDAQ"],
  AMD: ["Advanced Micro Devices, Inc.", "NASDAQ"], INTC: ["Intel Corporation", "NASDAQ"], TSM: ["Taiwan Semiconductor", "NYSE"],
  MSFT: ["Microsoft Corporation", "NASDAQ"], GOOGL: ["Alphabet Inc.", "NASDAQ"], AMZN: ["Amazon.com, Inc.", "NASDAQ"],
  RIVN: ["Rivian Automotive, Inc.", "NASDAQ"], LCID: ["Lucid Group, Inc.", "NASDAQ"], F: ["Ford Motor Company", "NYSE"],
  SNOW: ["Snowflake Inc.", "NYSE"], MDB: ["MongoDB, Inc.", "NASDAQ"], DT: ["Dynatrace, Inc.", "NYSE"],
  MNST: ["Monster Beverage Corporation", "NASDAQ"], KDP: ["Keurig Dr Pepper Inc.", "NASDAQ"], PEP: ["PepsiCo, Inc.", "NASDAQ"],
  DELL: ["Dell Technologies Inc.", "NYSE"], HPE: ["Hewlett Packard Enterprise", "NYSE"], QCOM: ["Qualcomm Incorporated", "NASDAQ"],
};
export const PEERS = {
  NVDA: ["AMD", "INTC", "TSM"], AAPL: ["MSFT", "GOOGL", "AMZN"], TSLA: ["RIVN", "LCID", "F"], DDOG: ["SNOW", "MDB", "DT"],
  CELH: ["MNST", "KDP", "PEP"], SMCI: ["DELL", "HPE", "NVDA"], AMD: ["NVDA", "INTC", "QCOM"], MSFT: ["AAPL", "GOOGL", "AMZN"],
};

export function relTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  const s = (Date.now() - t) / 1000;
  if (s < 0) return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export const fmtDay = (d, opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", opts);

// Load data for a path; null path = skip. Returns {data, err, status, loading}.
export function useApi(path, deps = []) {
  const [s, set] = useState({ data: null, err: null, status: null, loading: !!path });
  useEffect(() => {
    if (!path) { set({ data: null, err: null, status: null, loading: false }); return; }
    let live = true;
    set({ data: null, err: null, status: null, loading: true });
    api(path).then((data) => live && set({ data, err: null, status: 200, loading: false }))
      .catch((e) => live && set({ data: null, err: e.message, status: e.status || null, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return s;
}

// Element width, for SVG charts that fill their container.
// Uses a callback ref so it also works when the element mounts after data loads.
export function useWidth() {
  const [el, setEl] = useState(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

export const Status = ({ s, what }) =>
  s.loading ? <div className="text-sm text-dim">Loading {what}<span className="animate-pulse">_</span></div>
  : s.err ? <div className="text-sm text-dim">{what[0].toUpperCase() + what.slice(1)}: n/a <span className="text-xs">({s.err})</span></div> : null;

export const Dot = ({ label, className = "" }) => <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[label] || "bg-dim"} ${className}`} />;

export const SectionTitle = ({ children, right }) => (
  <div className="mb-3 flex items-baseline justify-between gap-3">
    <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
    {right && <div className="text-xs text-dim">{right}</div>}
  </div>
);

// Overall tone from bull/bear/neutral counts.
export function toneOf(c = {}) {
  const b = c.Bullish || 0, r = c.Bearish || 0, n = c.Neutral || 0, t = b + r + n;
  if (!t) return null;
  const net = (b - r) / t;
  if (net > 0.5) return ["Bullish", "Bullish", net];
  if (net > 0.2) return ["Moderately bullish", "Bullish", net];
  if (net < -0.5) return ["Bearish", "Bearish", net];
  if (net < -0.2) return ["Moderately bearish", "Bearish", net];
  return ["Mostly neutral", "Neutral", net];
}

// Turn a Gemini paragraph into at most `max` short bullets. Drops the counts sentence (shown in the breakdown) and any
// line with trading-advice words, whatever the model wrote.
const ADVICE = /\b(buy|buys|buying|sell|sells|selling|hold|holds|holding)\b/i;
export function bullets(text = "", max = 4, maxLen = 90) {
  const out = [];
  const sentences = text.replace(/([a-z0-9%)\]][.!?])\s+(?=[A-Z"])/g, "$1\n").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (/classified|sentiment model/i.test(s)) continue;
    const body = s.replace(/^.*?\b(focused on|centered on|centred on|highlighted|discussed|included|covered)\s+/i, "").replace(/[.!?]$/, "");
    for (let p of body.split(/,|;/).map((x) => x.trim().replace(/^(and|or)\s+/i, "")).filter((x) => x.length > 3)) {
      if (ADVICE.test(p)) continue;
      p = p[0].toUpperCase() + p.slice(1);
      out.push(p.length > maxLen ? p.slice(0, maxLen - 1).trimEnd() + "…" : p);
      if (out.length >= max) return out;
    }
  }
  return out;
}
