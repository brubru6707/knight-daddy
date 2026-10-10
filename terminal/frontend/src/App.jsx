import { useCallback, useEffect, useRef, useState } from "react";
import { AdvancedResearch } from "./advanced.jsx";
import { AiColumn } from "./ai.jsx";
import { FineTune } from "./finetune.jsx";
import { Competitors, Headlines } from "./news.jsx";
import { PriceBlock } from "./price.jsx";
import { api, NAMES } from "./ui.jsx";

const QUICK = ["NVDA", "DDOG", "AAPL", "TSLA", "CELH", "SMCI"];
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

function Header({ ticker, onPick, dark, setDark, watch }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); input.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const submit = (e) => { e.preventDefault(); const t = q.trim().toUpperCase(); if (t) { onPick(t); setQ(""); input.current?.blur(); } };
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur">
      <div className="mx-auto grid h-16 max-w-[1240px] grid-cols-[1fr_minmax(0,420px)_1fr] items-center gap-4 px-6 md:px-12">
        <button onClick={() => onPick("NVDA")} className="flex items-center gap-2 justify-self-start text-[15px] font-semibold text-amber" title="Knight-Daddy">
          <img src="/favicon.svg" alt="" className="h-5 w-5" />Knight-Daddy</button>
        <form onSubmit={submit} className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">⌕</span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stocks..." aria-label="Ticker" list="kd-tickers"
            maxLength={10} className="w-full rounded-lg bg-card py-2 pl-8 pr-9 text-sm text-ink outline-none placeholder:text-dim focus:ring-1 focus:ring-amber" />
          <datalist id="kd-tickers">{QUICK.map((t) => <option key={t} value={t}>{NAMES[t]?.[0]}</option>)}</datalist>
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-dim">/</kbd>
        </form>
        <div className="relative flex items-center gap-5 justify-self-end text-sm">
          <button onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="text-dim hover:text-ink">{dark ? "☀" : "☾"}</button>
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 text-ink hover:text-amber">
            <span className="text-amber">★</span>Watchlist {watch.list.length > 0 && <span className="text-dim">{watch.list.length}</span>}</button>
          {open && (
            <div className="absolute right-0 top-9 w-56 rounded-lg border border-line bg-ground p-2 shadow-lg" role="menu">
              {watch.list.length === 0 && <div className="px-2 py-1.5 text-xs text-dim">Empty. Star a stock to add it.</div>}
              {watch.list.map((t) => (
                <button key={t} role="menuitem" onClick={() => { onPick(t); setOpen(false); }}
                  className={`flex w-full justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-card ${t === ticker ? "text-amber" : "text-ink"}`}>
                  <span>{t}</span><span className="truncate pl-2 text-xs text-dim">{NAMES[t]?.[0]}</span></button>))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [ticker, setTicker] = useState(() => read("kd.ticker", "NVDA"));
  const [dark, setDarkState] = useState(() => document.documentElement.classList.contains("dark"));
  const [list, setList] = useState(() => read("kd.watchlist", []));
  const [health, setHealth] = useState(null);
  const [info, setInfo] = useState(null);
  const [specVersion, setSpecVersion] = useState(0);
  const [specReady, setSpecReady] = useState(false);

  const setDark = (d) => {
    setDarkState(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("kd.theme", d ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  const pick = useCallback((t) => { setTicker(t); write("kd.ticker", t); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const watched = list.includes(ticker);
  const toggleWatch = () => { const l = watched ? list.filter((t) => t !== ticker) : [...list, ticker]; setList(l); write("kd.watchlist", l); };

  useEffect(() => { api("health").then(setHealth).catch(() => setHealth(null)); api("specialist/info").then(setInfo).catch(() => setInfo(null)); }, [ticker, specVersion]);
  useEffect(() => {
    setSpecReady(false);
    api(`specialist/status?ticker=${ticker}`).then((d) => setSpecReady(d.phase === "done")).catch(() => setSpecReady(false));
  }, [ticker, specVersion]);
  const onTrained = () => setSpecVersion((v) => v + 1);

  return (
    <div className="min-h-screen">
      <Header ticker={ticker} onPick={pick} dark={dark} setDark={setDark} watch={{ list }} />
      <main className="mx-auto grid max-w-[1240px] lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 px-6 py-10 md:px-12 lg:border-r lg:border-line">
          <PriceBlock key={ticker} ticker={ticker} watched={watched} onWatch={toggleWatch}>
            <FineTune ticker={ticker} health={health} info={info} onTrained={onTrained} />
          </PriceBlock>
          <Headlines key={`h-${ticker}`} ticker={ticker} specReady={specReady} specVersion={specVersion} />
          <Competitors ticker={ticker} onPick={pick} />
          <AdvancedResearch key={`a-${ticker}`} ticker={ticker} health={health} specVersion={specVersion} />
          <footer className="mt-16 border-t border-line pt-6 text-xs text-dim">News sentiment, not investment advice.</footer>
        </div>
        <div className="px-6 py-10 md:px-10 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto">
          <AiColumn key={`ai-${ticker}`} ticker={ticker} />
        </div>
      </main>
    </div>
  );
}
