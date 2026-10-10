import { useEffect, useState } from "react";

// Shared helpers and the panel frame used by every KNIGHTWATCH panel.
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

export function Panel({ code, title, right, children, className = "" }) {
  return (
    <section className={`flex min-h-0 flex-col border border-line bg-panel ${className}`}>
      <header className="kw-drag flex cursor-move items-center gap-2 border-b border-line px-2 py-1 text-[11px] uppercase tracking-wider">
        <span className="bg-amber px-1 font-bold text-ground">{code}</span>
        <span className="font-semibold text-amber">{title}</span>
        <span className="ml-auto normal-case tracking-normal text-dim">{right}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}

export const Status = ({ s, what }) =>
  s.loading ? <div className="text-dim">loading {what}<span className="animate-pulse">_</span></div>
  : s.err ? <div className="text-down">ERR {s.err}</div> : null;

