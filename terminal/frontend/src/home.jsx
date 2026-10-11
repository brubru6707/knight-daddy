import { useState } from "react";
import { CATEGORIES, CRYPTO, dominant, HOME, headlinesPath, isCrypto, NAMES, pct, Pill, short, toneClass, usd, useApi } from "./ui.jsx";

// One tappable row: name on the left; live price and today's change on the right, plus the dominant headline tone for
// stocks. Crypto rows show price only (no model output). The number is the PRICE (we have no accounts or holdings).
// A row with no data at all is hidden.
function Row({ ticker, onOpen, onHide }) {
  const crypto = isCrypto(ticker);
  const p = useApi(`prices?ticker=${ticker}&period=3mo`);
  const h = useApi(crypto ? null : headlinesPath(ticker));
  const dead = crypto ? !!p.err : !!(p.err && h.err);
  if (dead) { onHide?.(ticker); return null; }
  const tone = h.data ? dominant(h.data.items) : null;
  return (
    <li>
      <button onClick={() => onOpen(ticker)} data-testid="home-row" data-ticker={ticker}
        className="flex w-full items-center gap-4 border-b border-line px-1 py-4 text-left hover:bg-card focus:bg-card focus:outline-none">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-rule font-serif text-[15px] text-ink">{short(ticker)[0]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{short(ticker)}</span>
          <span className="block truncate text-xs text-dim">{NAMES[ticker]?.[0] || "n/a"}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[15px] font-semibold text-ink" data-testid="row-price">{p.data ? usd(p.data.last) : p.loading ? "…" : "n/a"}</span>
          <span className="flex items-center gap-2">
            {!crypto && !h.loading && <Pill label={tone} />}
            <span className={`w-16 text-right text-xs ${p.data ? toneClass(p.data.change_1d) : "text-dim"}`} data-testid="row-change">
              {p.data ? pct(p.data.change_1d, 2) : p.loading ? "" : "n/a"}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function Section({ title, label, tickers, onOpen, note, empty, right }) {
  const [hidden, setHidden] = useState([]);
  const hide = (t) => { if (!hidden.includes(t)) setTimeout(() => setHidden((h) => (h.includes(t) ? h : [...h, t]))); };
  return (
    <section className="mt-10 first:mt-6" aria-label={label}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[22px] font-medium text-ink">{title}</h2>
        {right}
      </div>
      {note && <p className="mt-1 text-xs text-dim">{note}</p>}
      <ul className="mt-3 border-t border-rule">
        {tickers.map((t) => <Row key={t} ticker={t} onOpen={onOpen} onHide={hide} />)}
      </ul>
      {hidden.length === tickers.length && <p className="mt-3 text-sm text-dim" data-testid="section-na">{empty}</p>}
    </section>
  );
}

export function Home({ onOpen, list, onEdit, onReplay }) {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-6 sm:px-6 sm:py-10">
      {list.length > 0 && (
        <Section title="Your list" label="Your list" tickers={list} onOpen={onOpen} empty="Your list: n/a right now."
          right={<button onClick={onEdit} className="text-xs text-amber hover:underline">Edit your list</button>} />
      )}
      <Section title="Stocks" label="Stocks" tickers={HOME} onOpen={onOpen} empty="Stocks: n/a right now."
        note="Price and today's change, with the dominant tone of recent headlines."
        right={list.length === 0 ? <button onClick={onEdit} className="text-xs text-amber hover:underline">Build your list</button> : null} />
      <Section title="Crypto" label="Crypto" tickers={CRYPTO} onOpen={onOpen} empty="Crypto prices: n/a right now."
        note="Prices and headlines only. No sentiment model runs on crypto." />
      <button onClick={onReplay} className="mt-10 block w-full border border-line px-4 py-3 text-left hover:bg-card" data-testid="replay-link">
        <span className="font-serif text-[17px] text-ink">Replay</span>
        <span className="mt-0.5 block text-xs text-dim">Re-run the model on a past day's headlines and see what it would have said.</span>
      </button>
      <footer className="mt-12 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}

// First open: the user taps the names or groups they want to follow. It only organizes their own choices (saved in
// this browser); nothing is suggested or ranked. Skip goes straight to the full list.
export function Onboarding({ initial = [], onDone, onSkip }) {
  const [sel, setSel] = useState(initial);
  const toggle = (t) => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const toggleGroup = (g) => setSel((s) => (g.tickers.every((t) => s.includes(t)) ? s.filter((t) => !g.tickers.includes(t)) : [...new Set([...s, ...g.tickers])]));
  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6 sm:py-12" data-testid="onboarding">
      <h1 className="font-serif text-[30px] font-medium leading-tight text-ink">What do you want to follow?</h1>
      <p className="mt-2 text-sm text-dim">Tap names or whole groups. They go in "Your list" at the top of home. This only arranges your screen; it is not a suggestion.</p>
      <div className="mt-8 space-y-7">
        {CATEGORIES.map((g) => {
          const all = g.tickers.every((t) => sel.includes(t));
          return (
            <div key={g.name}>
              <button onClick={() => toggleGroup(g)} aria-pressed={all} data-testid="category"
                className={`kd-label flex items-center gap-2 hover:text-ink ${all ? "text-ink" : ""}`}>
                <span className={`inline-block h-3 w-3 border ${all ? "border-ink bg-ink" : "border-rule"}`} />{g.name}</button>
              <div className="mt-3 flex flex-wrap gap-2">
                {g.tickers.map((t) => {
                  const on = sel.includes(t);
                  return (
                    <button key={t} onClick={() => toggle(t)} aria-pressed={on} data-testid="choice" data-ticker={t}
                      className={`border px-3 py-2 text-left ${on ? "border-ink bg-ink text-ground" : "border-line text-ink hover:border-rule"}`}>
                      <span className="block text-sm font-semibold">{short(t)}</span>
                      <span className={`block text-xs ${on ? "text-ground/80" : "text-dim"}`}>{NAMES[t]?.[0]}</span>
                    </button>);
                })}
              </div>
            </div>);
        })}
      </div>
      <div className="sticky bottom-0 mt-10 flex items-center gap-3 border-t border-rule bg-ground py-4">
        <button onClick={() => onDone(sel)} disabled={!sel.length} data-testid="onboarding-done"
          className="bg-ink px-5 py-2.5 text-sm font-semibold text-ground disabled:opacity-40">
          {sel.length ? `Save my list (${sel.length})` : "Save my list"}</button>
        <button onClick={onSkip} className="px-3 py-2.5 text-sm text-dim hover:text-ink" data-testid="onboarding-skip">Skip</button>
      </div>
      <footer className="border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}
