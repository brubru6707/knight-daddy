import { useCallback, useEffect, useRef, useState } from "react";
import { SentimentVsPrice } from "./advanced.jsx";
import { Briefing, ConfidenceBar, ProbBar } from "./ai.jsx";
import { FineTune } from "./finetune.jsx";
import { Home, Onboarding } from "./home.jsx";
import { Competitors, CryptoNews, Headlines } from "./news.jsx";
import { ModelInfo } from "./model.jsx";
import { PriceBlock } from "./price.jsx";
import { Replay } from "./replay.jsx";
import { Settings } from "./settings.jsx";
import { api, CRYPTO, HOME, isCrypto, NAMES, readLocal, useAdvanced, writeLocal } from "./ui.jsx";

// Screens: home list (/), ticker detail (/?t=NVDA), replay (/replay?t=NVDA&d=2023-08-01), model info (/model). The URL carries the state
// so the browser's own Back button works too. First open shows the onboarding list builder before home.
const clean = (x) => (x || "").toUpperCase().replace(/[^A-Z.-]/g, "").slice(0, 10) || null;
const routeFromUrl = () => {
  const q = new URLSearchParams(location.search);
  if (location.pathname.replace(/\/+$/, "") === "/model") return { page: "model" };
  if (location.pathname.replace(/\/+$/, "") === "/replay") return { page: "replay", t: clean(q.get("t")), d: /^\d{4}-\d\d-\d\d$/.test(q.get("d") || "") ? q.get("d") : null };
  const t = clean(q.get("t"));
  return t ? { page: "detail", t } : { page: "home" };
};
const urlOf = (r) => (r.page === "model" ? "/model" : r.page === "replay" ? `/replay${r.t ? `?t=${r.t}${r.d ? `&d=${r.d}` : ""}` : ""}` : r.page === "detail" ? `/?t=${encodeURIComponent(r.t)}` : "/");
const SUPPORTED = [...HOME, ...CRYPTO];

function Header({ onHome, onPick, onReplay, onModel, dark, setDark, current, onModelChange }) {
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
      <div className="mx-auto grid h-14 max-w-[720px] grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-1.5 px-4 sm:h-16 sm:gap-3 sm:px-6">
        <button onClick={onHome} className="flex items-center gap-2 text-[15px] font-semibold text-amber" title="Knight-Daddy home">
          <img src="/favicon.svg" alt="" className="h-5 w-5" /><span className="hidden sm:inline">Knight-Daddy</span></button>
        <form onSubmit={submit} className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">⌕</span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stocks..." aria-label="Ticker" list="kd-tickers"
            maxLength={10} className="w-full border border-line bg-ground py-2 pl-8 pr-3 text-sm text-ink outline-none placeholder:text-dim focus:border-rule" />
          <datalist id="kd-tickers">{SUPPORTED.map((t) => <option key={t} value={t}>{NAMES[t]?.[0]}</option>)}</datalist>
        </form>
        <button onClick={onReplay} className="px-1 text-sm text-dim hover:text-ink" data-testid="nav-replay">Replay</button>
        <button onClick={onModel} className="whitespace-nowrap px-1 text-sm text-dim hover:text-ink" data-testid="nav-model">
          <span className="sm:hidden">Model</span><span className="hidden sm:inline">Model info</span></button>
        <button onClick={() => setDark(!dark)} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="h-9 w-9 text-dim hover:text-ink">{dark ? "☀" : "☾"}</button>
        <Settings current={current} onChanged={onModelChange} />
      </div>
    </header>
  );
}

// Crypto: Coinbase price chart and crypto headlines (tags only once the worker pushes them). No fine-tune.
function CryptoDetail({ ticker, onBack }) {
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-12 pt-4 sm:px-6 sm:pt-6" data-testid="crypto-detail">
      <button onClick={onBack} className="-ml-1 mb-5 flex items-center gap-1.5 px-1 py-2 text-sm text-dim hover:text-ink" data-testid="back">
        <span aria-hidden>‹</span> Back to stocks</button>
      <PriceBlock key={ticker} ticker={ticker} crypto />
      <CryptoNews key={`n-${ticker}`} ticker={ticker} Bar={ProbBar} />
      <footer className="mt-16 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}

function Detail({ ticker, onBack, onPick, modelVersion }) {
  const [health, setHealth] = useState(undefined); // undefined while loading, null if it failed
  const [info, setInfo] = useState(null);
  const [active, setActive] = useState("general");
  const [specVersion, setSpecVersion] = useState(0);
  const [adv, setAdv] = useAdvanced();
  useEffect(() => {
    api("health").then(setHealth).catch(() => setHealth(null));
    api("specialist/info").then(setInfo).catch(() => setInfo(null));
    api(`specialist/active?ticker=${ticker}`).then((d) => setActive(d.active === "specialist" ? "specialist" : "general")).catch(() => setActive("general"));
  }, [ticker, specVersion, modelVersion]);
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-12 pt-4 sm:px-6 sm:pt-6">
      <div className="-ml-1 mb-5 flex items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 px-1 py-2 text-sm text-dim hover:text-ink" data-testid="back">
          <span aria-hidden>‹</span> Back to stocks</button>
        <button onClick={() => setAdv(!adv)} role="switch" aria-checked={adv} data-testid="advanced-toggle"
          className="flex items-center gap-2 py-2 text-xs text-dim hover:text-ink">
          Advanced
          <span className={`relative inline-block h-[18px] w-8 border ${adv ? "border-amber bg-amber" : "border-rule bg-ground"}`}>
            <span className={`absolute top-[2px] h-3 w-3 transition-all ${adv ? "left-[16px] bg-ground" : "left-[2px] bg-dim"}`} /></span>
        </button>
      </div>
      <PriceBlock key={ticker} ticker={ticker} />
      <ConfidenceBar key={`c-${ticker}-${active}-${specVersion}`} ticker={ticker} model={active} />
      <Briefing key={`b-${ticker}`} ticker={ticker} adv={adv} />
      <section className="kd-box mt-6 p-5" aria-label="Sentiment vs. price"><SentimentVsPrice key={`s-${ticker}`} ticker={ticker} health={health} /></section>
      <Headlines key={`h-${ticker}-${active}`} ticker={ticker} model={active} specVersion={specVersion} adv={adv} />
      <Competitors ticker={ticker} onPick={onPick} />
      <FineTune ticker={ticker} health={health} info={info} active={active} adv={adv}
        onActive={(a) => setActive(a)} onTrained={() => setSpecVersion((v) => v + 1)} />
      <footer className="mt-16 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(routeFromUrl);
  const [list, setList] = useState(() => readLocal("kd.list", []).filter((t) => SUPPORTED.includes(t)));
  const [onboarded, setOnboarded] = useState(() => readLocal("kd.onboarded", false));
  const [editing, setEditing] = useState(false);
  const [modelVersion, setModelVersion] = useState(0); // bumped when settings reset a model
  const [dark, setDarkState] = useState(() => document.documentElement.classList.contains("dark"));
  const setDark = (d) => {
    setDarkState(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("kd.theme", d ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    const onPop = () => setRoute(routeFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((r, replace = false) => {
    history[replace ? "replaceState" : "pushState"](null, "", urlOf(r));
    setRoute(r); setEditing(false);
    if (!replace) window.scrollTo({ top: 0 });
  }, []);
  const home = { page: "home" };
  // Back returns to the home list (the browser history when we came from it, else a fresh push).
  const back = () => (history.state?.kd === "from-home" ? history.back() : go(home));
  const open = (raw) => {
    const t = CRYPTO.includes(`${raw}-USD`) ? `${raw}-USD` : raw; // "BTC" in the search box opens Bitcoin
    const fromHome = route.page === "home";
    go({ page: "detail", t });
    if (fromHome) history.replaceState({ kd: "from-home" }, "", location.href);
  };
  const finishOnboarding = (sel) => { setList(sel); writeLocal("kd.list", sel); setOnboarded(true); writeLocal("kd.onboarded", true); setEditing(false); };

  let page;
  if (route.page === "model") page = <ModelInfo onBack={() => go(home)} />;
  else if (route.page === "replay") page = <Replay ticker={route.t} date={route.d} onBack={() => go(home)} onPick={(t, d) => go({ page: "replay", t, d }, true)} />;
  else if (route.page === "detail") page = isCrypto(route.t) ? <CryptoDetail ticker={route.t} onBack={back} />
    : <Detail ticker={route.t} onBack={back} onPick={(t) => go({ page: "detail", t })} modelVersion={modelVersion} />;
  else if (!onboarded || editing) page = <Onboarding initial={list} onDone={finishOnboarding} onSkip={() => finishOnboarding(editing ? list : [])} />;
  else page = <Home onOpen={open} list={list} onEdit={() => setEditing(true)} onReplay={() => go({ page: "replay" })}
    onAdd={(t) => { const l = list.includes(t) ? list : [...list, t]; setList(l); writeLocal("kd.list", l); }} />;

  return (
    <div className="min-h-screen">
      <Header onHome={() => go(home)} onPick={open} onReplay={() => go({ page: "replay" })} onModel={() => go({ page: "model" })} dark={dark} setDark={setDark}
        current={route.page === "detail" ? route.t : null} onModelChange={() => setModelVersion((v) => v + 1)} />
      {page}
    </div>
  );
}
