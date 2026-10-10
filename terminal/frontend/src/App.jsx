import { useCallback, useEffect, useRef, useState } from "react";
import { AdvancedResearch } from "./advanced.jsx";
import { Briefing, ConfidenceBar } from "./ai.jsx";
import { FineTune } from "./finetune.jsx";
import { Home } from "./home.jsx";
import { Competitors, Headlines } from "./news.jsx";
import { PriceBlock } from "./price.jsx";
import { api, HOME, NAMES } from "./ui.jsx";

// Two screens: the home list (/) and a ticker detail page (/?t=NVDA). The URL carries the ticker so the browser's own
// Back button works too.
const tickerFromUrl = () => (new URLSearchParams(location.search).get("t") || "").toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 10) || null;

function Header({ onHome, onPick, dark, setDark }) {
  const [q, setQ] = useState("");
  const input = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); input.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const submit = (e) => { e.preventDefault(); const t = q.trim().toUpperCase(); if (t) { onPick(t); setQ(""); input.current?.blur(); } };
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-ground">
      <div className="mx-auto grid h-14 max-w-[720px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:h-16 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-2 text-[15px] font-semibold text-amber" title="Knight-Daddy home">
          <img src="/favicon.svg" alt="" className="h-5 w-5" /><span className="hidden sm:inline">Knight-Daddy</span></button>
        <form onSubmit={submit} className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">⌕</span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stocks..." aria-label="Ticker" list="kd-tickers"
            maxLength={10} className="w-full border border-line bg-ground py-2 pl-8 pr-3 text-sm text-ink outline-none placeholder:text-dim focus:border-rule" />
          <datalist id="kd-tickers">{HOME.map((t) => <option key={t} value={t}>{NAMES[t]?.[0]}</option>)}</datalist>
        </form>
        <button onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="h-9 w-9 text-dim hover:text-ink">{dark ? "☀" : "☾"}</button>
      </div>
    </header>
  );
}

function Detail({ ticker, onBack, onPick }) {
  const [health, setHealth] = useState(null);
  const [info, setInfo] = useState(null);
  const [active, setActive] = useState("general");
  const [specVersion, setSpecVersion] = useState(0);
  useEffect(() => {
    api("health").then(setHealth).catch(() => setHealth(null));
    api("specialist/info").then(setInfo).catch(() => setInfo(null));
    api(`specialist/active?ticker=${ticker}`).then((d) => setActive(d.active === "specialist" ? "specialist" : "general")).catch(() => setActive("general"));
  }, [ticker, specVersion]);
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-12 pt-4 sm:px-6 sm:pt-6">
      <button onClick={onBack} className="-ml-1 mb-5 flex items-center gap-1.5 px-1 py-2 text-sm text-dim hover:text-ink" data-testid="back">
        <span aria-hidden>‹</span> Back to stocks</button>
      <PriceBlock key={ticker} ticker={ticker} />
      <ConfidenceBar key={`c-${ticker}-${active}-${specVersion}`} ticker={ticker} model={active} />
      <Briefing key={`b-${ticker}`} ticker={ticker} />
      <FineTune ticker={ticker} health={health} info={info} active={active}
        onActive={(a) => setActive(a)} onTrained={() => setSpecVersion((v) => v + 1)} />
      <Headlines key={`h-${ticker}-${active}`} ticker={ticker} model={active} specVersion={specVersion} />
      <Competitors ticker={ticker} onPick={onPick} />
      <AdvancedResearch key={`a-${ticker}`} ticker={ticker} health={health} specVersion={specVersion} />
      <footer className="mt-16 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}

export default function App() {
  const [ticker, setTicker] = useState(tickerFromUrl);
  const [dark, setDarkState] = useState(() => document.documentElement.classList.contains("dark"));
  const setDark = (d) => {
    setDarkState(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("kd.theme", d ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    const onPop = () => setTicker(tickerFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((t) => {
    history.pushState(null, "", t ? `/?t=${encodeURIComponent(t)}` : "/");
    setTicker(t);
    window.scrollTo({ top: 0 });
  }, []);
  // Back returns to the home list (the browser history when we came from it, else a fresh push).
  const back = () => (history.state?.kd === "from-home" ? history.back() : go(null));
  const open = (t) => { const fromHome = !ticker; go(t); if (fromHome) history.replaceState({ kd: "from-home" }, "", location.href); };

  return (
    <div className="min-h-screen">
      <Header onHome={() => go(null)} onPick={open} dark={dark} setDark={setDark} />
      {ticker ? <Detail ticker={ticker} onBack={back} onPick={go} /> : <Home onOpen={open} />}
    </div>
  );
}
