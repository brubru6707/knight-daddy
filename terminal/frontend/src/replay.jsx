import { useMemo } from "react";
import { ProbBar } from "./ai.jsx";
import { Dot, fmtDay, NAMES, pct, TAG, toneClass, usd, useApi } from "./ui.jsx";

// Replay: pick a (ticker, date) pair that Oscar published (/api/replay/available), then show what /api/replay
// recomputed for it: the general model's class probabilities, that day's tagged headlines, and that day's close.
// Always labeled as a historical replay, never as live data.
export function Replay({ ticker, date, onPick, onBack }) {
  const av = useApi("replay/available");
  const pairs = useMemo(() => av.data?.pairs || [], [av.data]);
  const tickers = [...new Set(pairs.map((p) => p.ticker))];
  const t = tickers.includes(ticker) ? ticker : tickers[0] || null;
  const dates = pairs.filter((p) => p.ticker === t);
  const d = dates.some((p) => p.date === date) ? date : null;
  const byMonth = dates.reduce((m, p) => ((m[p.date.slice(0, 7)] ||= []).push(p), m), {});
  const r = useApi(t && d ? `replay?ticker=${t}&date=${d}` : null);

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-12 pt-4 sm:px-6 sm:pt-6">
      <button onClick={onBack} className="-ml-1 mb-5 flex items-center gap-1.5 px-1 py-2 text-sm text-dim hover:text-ink" data-testid="back">
        <span aria-hidden>‹</span> Back to stocks</button>
      <h1 className="font-serif text-[30px] font-medium leading-tight text-ink">Replay</h1>
      <p className="mt-1 text-sm text-dim">Pick a past day. The general model re-reads that day's headlines on Oscar and shows what it would have said then. Historical data, not live.</p>

      {av.loading && <div className="mt-6 text-sm text-dim">Loading replay dates<span className="animate-pulse">_</span></div>}
      {!av.loading && !pairs.length && <div className="mt-6 text-sm text-dim" data-testid="replay-na">Replay: n/a (no replay days published yet).</div>}

      {pairs.length > 0 && (
        <div className="kd-box mt-6 flex flex-wrap items-end gap-4 p-4">
          <div>
            <div className="kd-label mb-1.5">Stock</div>
            <div className="flex gap-1" role="radiogroup" aria-label="Replay stock">
              {tickers.map((x) => (
                <button key={x} role="radio" aria-checked={x === t} onClick={() => onPick(x, null)}
                  className={`border px-3 py-1.5 text-sm ${x === t ? "border-rule font-semibold text-ink" : "border-line text-dim hover:text-ink"}`}>{x}</button>))}
            </div>
          </div>
          <label className="min-w-[220px] flex-1">
            <span className="kd-label mb-1.5 block">Date ({dates.length} days with data)</span>
            <select value={d || ""} onChange={(e) => onPick(t, e.target.value || null)} aria-label="Replay date" data-testid="replay-date"
              className="w-full border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-rule">
              <option value="">Choose a date</option>
              {Object.entries(byMonth).map(([m, ps]) => (
                <optgroup key={m} label={fmtDay(`${m}-15`, { month: "long", year: "numeric" })}>
                  {ps.map((p) => <option key={p.date} value={p.date}>{fmtDay(p.date)} ({p.n} headlines)</option>)}
                </optgroup>))}
            </select>
          </label>
        </div>
      )}

      {t && d && (
        <section className="mt-8" aria-label="Replay result">
          <div className="border border-amber bg-amber/10 px-4 py-2.5 text-sm font-semibold text-amber" data-testid="replay-banner">
            Replay - {fmtDay(d)}</div>
          {r.loading && <div className="mt-6 text-sm text-dim">Recomputing on Oscar<span className="animate-pulse">_</span></div>}
          {r.err && <div className="mt-6 text-sm text-dim" data-testid="replay-error">Replay: n/a for {t} on {fmtDay(d)}.</div>}
          {r.data && (
            <>
              <div className="mt-6">
                <h2 className="font-serif text-[24px] font-medium text-ink">{NAMES[t]?.[0] || t}</h2>
                <div className="kd-label mt-1">{t} · close on {fmtDay(d, { month: "short", day: "numeric", year: "numeric" })}</div>
                <div className="mt-3 text-[40px] font-semibold leading-none text-ink" data-testid="replay-price">{usd(r.data.price?.close)}</div>
                <div className={`mt-2 text-sm ${r.data.price?.change_1d !== null && r.data.price?.change_1d !== undefined ? toneClass(r.data.price.change_1d) : "text-dim"}`}>
                  {pct(r.data.price?.change_1d, 2)} <span className="text-dim">vs the previous close</span></div>
              </div>
              <section className="kd-box mt-6 p-5" data-testid="confidence">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-[17px] font-medium text-ink">Model confidence that day</h3>
                  <span className="text-xs text-dim">Qwen classification, general model</span>
                </div>
                <ProbBar d={r.data} />
              </section>
              <h3 className="kd-section mt-8 font-serif text-[17px] font-medium text-ink">Headlines that day</h3>
              <ul className="mt-2">
                {r.data.items.map((h, k) => (
                  <li key={k} className="flex gap-4 border-b border-line py-3" data-testid="replay-headline">
                    <span className={`flex h-fit w-[80px] shrink-0 items-center gap-1.5 border border-current px-1.5 py-0.5 text-[11px] ${TAG[h.label] || "text-dim"}`}>
                      <Dot label={h.label} />{h.label || "n/a"}</span>
                    <div className="min-w-0">
                      <div className="text-[14px] leading-snug text-ink">{h.title}</div>
                      <div className="mt-1 text-xs text-dim">{[h.source, h.time?.slice(11, 16)].filter(Boolean).join(" · ")}</div>
                    </div>
                  </li>))}
              </ul>
              <p className="mt-4 text-xs text-dim">Headlines from the FNSPID dataset, re-tagged by the general Qwen model. A replay of {fmtDay(d)}, not live data.</p>
            </>
          )}
        </section>
      )}
      <footer className="mt-16 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}
