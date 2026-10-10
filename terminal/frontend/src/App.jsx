import { useCallback, useEffect, useState } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { PriceChart, SentimentChart, EquityChart, SERIES } from "./charts.jsx";
import { api, pct, money, tone, useApi, Panel, Status, Signal, Sparkline, MixBar, scoreLabel } from "./ui.jsx";
import { SpecialistPanel } from "./specialist.jsx";
import { BriefingPanel } from "./briefing.jsx";

const Grid = WidthProvider(Responsive);
const LAYOUT_KEY = "kw.layouts.v4"; // v2 added the specialist panel, v3 the briefing panel, v4 the glanceable layout
// Most important panels first and open; BRF and BM start collapsed (header plus a one-line summary).
const DEFAULT_LAYOUTS = {
  lg: [
    { i: "px", x: 0, y: 0, w: 8, h: 10, minW: 3, minH: 5 },
    { i: "nws", x: 8, y: 0, w: 4, h: 10, minW: 2, minH: 4 },
    { i: "spc", x: 0, y: 10, w: 12, h: 8, minW: 6, minH: 6 },
    { i: "snt", x: 0, y: 18, w: 7, h: 10, minW: 3, minH: 6 },
    { i: "bt", x: 7, y: 18, w: 5, h: 10, minW: 3, minH: 6 },
    { i: "brf", x: 0, y: 29, w: 12, h: 4, minW: 4, minH: 3 },
    { i: "bm", x: 0, y: 33, w: 12, h: 7, minW: 4, minH: 3 },
  ],
  sm: [
    { i: "px", x: 0, y: 0, w: 1, h: 10 }, { i: "nws", x: 0, y: 10, w: 1, h: 10 }, { i: "spc", x: 0, y: 20, w: 1, h: 18 },
    { i: "snt", x: 0, y: 38, w: 1, h: 11 }, { i: "bt", x: 0, y: 49, w: 1, h: 12 },
    { i: "brf", x: 0, y: 61, w: 1, h: 7 }, { i: "bm", x: 0, y: 68, w: 1, h: 8 },
  ],
};
const PANELS = [["px", "price"], ["nws", "news"], ["spc", "specialist"], ["snt", "sentiment"], ["bt", "backtest"], ["brf", "briefing"], ["bm", "benchmark"]];
const HIDDEN_KEY = "kw.hidden.v1", SAVED_KEY = "kw.saved.v1", COLLAPSED_KEY = "kw.collapsed.v1";
const DEFAULT_COLLAPSED = ["brf", "bm"];
// Collapsed panels render one grid row tall; their stored height is kept so expanding restores it.
const foldLayouts = (layouts, collapsed) => Object.fromEntries(Object.entries(layouts).map(([bp, items]) =>
  [bp, items.map((i) => (collapsed.includes(i.i) ? { ...i, h: 1, minH: 1, isResizable: false } : i))]));
const unfoldLayouts = (next, prev, collapsed) => Object.fromEntries(Object.entries(next).map(([bp, items]) => {
  const old = Object.fromEntries((prev[bp] || []).map((i) => [i.i, i]));
  return [bp, items.map((i) => (collapsed.includes(i.i) && old[i.i]
    ? { ...i, h: old[i.i].h, minH: old[i.i].minH, isResizable: old[i.i].isResizable } : i))];
}));
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
// Keep positions of hidden panels: RGL drops layout items without a child, so merge new items over the old ones.
const mergeLayouts = (prev, next) => Object.fromEntries(Object.keys({ ...prev, ...next }).map((bp) => {
  const n = next[bp] || [], ids = new Set(n.map((i) => i.i));
  return [bp, [...n, ...(prev[bp] || []).filter((i) => !ids.has(i.i))]];
}));
const loadLayouts = () => {
  let l;
  try { l = JSON.parse(localStorage.getItem(LAYOUT_KEY)); } catch { l = null; }
  return l ? mergeLayouts(DEFAULT_LAYOUTS, l) : DEFAULT_LAYOUTS;
};
const QUICK_TICKERS = ["NVDA", "DDOG", "AAPL", "TSLA", "CELH", "SMCI"];

function Toolbar({ hidden, setHidden, onReset, saved, onSave, onLoad, onDelete }) {
  const [name, setName] = useState("");
  const [sel, setSel] = useState("");
  const names = Object.keys(saved);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel px-3 py-1 text-[11px]" role="toolbar" aria-label="Panels">
      <span className="text-dim" title="Drag panel headers to move, corner to resize, chevron to collapse. Layout and panel choices are saved in this browser.">PANELS</span>
      {PANELS.map(([id, label]) => {
        const on = !hidden.includes(id);
        return (
          <button key={id} aria-pressed={on} onClick={() => setHidden(on ? [...hidden, id] : hidden.filter((h) => h !== id))}
            className={`border px-1 ${on ? "border-amber/70 text-amber" : "border-line text-dim line-through hover:text-ink"}`}>
            {id.toUpperCase()} <span className="normal-case">{label}</span></button>
        );
      })}
      <button onClick={onReset} className="border border-line px-1 text-dim hover:border-amber hover:text-amber">RESET LAYOUT</button>
      <span className="ml-auto flex flex-wrap items-center gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="layout name" aria-label="Layout name" maxLength={24}
          className="w-28 border border-line bg-ground px-1 text-ink outline-none focus:border-amber" />
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); setSel(name.trim()); setName(""); } }}
          className="border border-line px-1 text-dim hover:border-amber hover:text-amber">SAVE</button>
        <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Saved layouts"
          className="border border-line bg-ground px-1 text-ink outline-none focus:border-amber">
          <option value="">saved layouts ({names.length})</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button disabled={!sel} onClick={() => onLoad(sel)} className="border border-line px-1 text-dim hover:border-amber hover:text-amber disabled:opacity-40">LOAD</button>
        <button disabled={!sel} onClick={() => { onDelete(sel); setSel(""); }} className="border border-line px-1 text-dim hover:border-down hover:text-down disabled:opacity-40">DELETE</button>
      </span>
    </div>
  );
}

function Header({ ticker, onSubmit, health }) {
  const [q, setQ] = useState(ticker);
  useEffect(() => setQ(ticker), [ticker]);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber/60 bg-panel px-3 py-1">
      <div className="flex items-center gap-1.5 text-sm font-bold tracking-[0.12em] text-amber" title="Headline sentiment research terminal">
        <img src="/favicon.svg" alt="" className="h-5 w-5" />Knight-Daddy</div>
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); q.trim() && onSubmit(q.trim().toUpperCase()); }}>
        <span className="text-amber">&gt;</span>
        <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} aria-label="Ticker"
          className="w-28 border border-line bg-ground px-2 py-1 font-bold text-ink uppercase outline-none focus:border-amber"
          placeholder="TICKER" maxLength={10} />
        <button className="border border-amber px-2 py-1 text-amber hover:bg-amber hover:text-ground">GO</button>
      </form>
      <div className="flex gap-1">
        {QUICK_TICKERS.map((t) => (
          <button key={t} onClick={() => onSubmit(t)} className={`border px-2 py-1 ${t === ticker ? "border-amber text-amber" : "border-line text-dim hover:text-ink"}`}>{t}</button>
        ))}
      </div>
      <div className="ml-auto flex gap-3 text-[11px]">
        <span>MODEL <b className={health?.gpu || health?.model_endpoint ? "text-up" : "text-down"}>
          {health?.model_endpoint ? "REMOTE" : health?.gpu ? (health.model_loaded ? "GPU READY" : "GPU (lazy)") : "OFFLINE"}</b></span>
        <span className="text-dim">Qwen3.5-2B QLoRA</span>
      </div>
    </div>
  );
}

function PricePanel({ ticker, fold }) {
  const [period, setPeriod] = useState("1y");
  const s = useApi(`prices?ticker=${ticker}&period=${period}`, [ticker, period]);
  const d = s.data;
  return (
    <Panel code="PX" title={`${ticker} daily`} className="h-full" {...fold}
      summary={d && <><b>{d.last.toFixed(2)}</b><span className={tone(d.change_1d)}>1D {pct(d.change_1d, 2)}</span>
        <Sparkline values={d.bars.map((b) => b.close)} color={d.change_period >= 0 ? "#3ddc84" : "#ff5c5c"} title="close" /></>}
      right={<span className="flex gap-1">{["3mo", "6mo", "1y", "2y"].map((p) => (
        <button key={p} onClick={() => setPeriod(p)} className={p === period ? "text-amber" : "hover:text-ink"}>{p}</button>))}</span>}>
      <Status s={s} what="prices" />
      {d && (
        <div className="flex h-full flex-col">
          <div className="mb-0.5 flex flex-wrap items-baseline gap-3 text-[11px]" title={`${d.bars[0].time} to ${d.bars.at(-1).time}`}>
            <span className="text-base font-bold">{d.last.toFixed(2)}</span>
            <span className={tone(d.change_1d)}>1D {pct(d.change_1d, 2)}</span>
            <span className={tone(d.change_period)}>{period.toUpperCase()} {pct(d.change_period)}</span>
            <span className="text-dim">H {d.high.toFixed(2)} L {d.low.toFixed(2)}</span>
          </div>
          <div className="min-h-0 flex-1"><PriceChart bars={d.bars} /></div>
        </div>
      )}
    </Panel>
  );
}

function NewsPanel({ ticker, specReady, specVersion, fold }) {
  const [source, setSource] = useState("live");
  const [model, setModel] = useState("general");
  useEffect(() => { if (!specReady) setModel("general"); }, [specReady]);
  const s = useApi(`headlines?ticker=${ticker}&source=${source}&limit=40&model=${model}`, [ticker, source, model, specVersion]);
  const items = s.data?.items || [];
  const counts = items.reduce((a, i) => ((a[i.label] = (a[i.label] || 0) + 1), a), {});
  const tagged = (counts.Bullish || 0) + (counts.Bearish || 0) + (counts.Neutral || 0);
  const net = tagged ? ((counts.Bullish || 0) - (counts.Bearish || 0)) / tagged : 0;
  const mood = tagged > 0 && <Signal label={scoreLabel(net)} title={`net (bull - bear) / tagged = ${net.toFixed(2)}`} />;
  return (
    <Panel code="NWS" title="headlines" className="h-full" {...fold}
      summary={s.data && <>{mood}<MixBar c={counts} /><span className="text-dim">{items.length}</span></>}
      right={<span className="flex gap-2">
        {specReady && ["general", "specialist"].map((x) => (
          <button key={x} onClick={() => setModel(x)} className={x === model ? "text-amber" : "hover:text-ink"}>{x}</button>))}
        {specReady && <span className="text-line">|</span>}
        {["live", "historical"].map((x) => (
          <button key={x} onClick={() => setSource(x)} className={x === source ? "text-amber" : "hover:text-ink"}>{x}</button>))}</span>}>
      <Status s={s} what={source === "live" ? "headlines (first run loads the model, about 30s)" : "headlines"} />
      {s.data && (
        <div className="flex h-full flex-col">
          <div className="mb-0.5 flex items-center gap-2 text-[10px]">
            {mood}<MixBar c={counts} />
            <span className="text-up">BULL {counts.Bullish || 0}</span>
            <span className="text-down">BEAR {counts.Bearish || 0}</span>
            <span className="text-flat">NEUT {counts.Neutral || 0}</span>
            {model === "specialist" && <span className="text-amber" title={`${ticker} specialist: tags that differ from the general model`}>
              SPC {items.filter((i) => i.general_label && i.general_label !== i.label).length}&#916;</span>}
            <span className={`ml-auto truncate ${s.data.provider_note ? "text-amber" : "text-dim"}`}
              title={source === "live" ? [s.data.provider_note, s.data.filter_note].filter(Boolean).join("\n") : ""}>
              {source === "live" ? s.data.provider : "FNSPID 2023"}{source === "live" && s.data.provider_note ? " !" : ""}</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 && <li className="text-dim">no headlines found</li>}
            {items.map((i, k) => (
              <li key={k} className="flex items-baseline gap-2 border-b border-line/50 py-0.5 text-[11px] leading-snug">
                <span className="w-11 shrink-0 text-[10px]"
                  title={i.p_bull !== undefined ? `bull ${(i.p_bull * 100).toFixed(0)}% / bear ${(i.p_bear * 100).toFixed(0)}% / neutral ${(i.p_neut * 100).toFixed(0)}%` : "not classified"}>
                  {i.label ? <Signal label={i.label} word={i.label.slice(0, 4).toUpperCase()} /> : <span className="text-dim">----</span>}</span>
                <div className="min-w-0 flex-1" title={`${(i.time || "").slice(0, 16).replace("T", " ")} ${i.source || ""}`}>
                  {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="hover:text-amber">{i.title}</a> : <span>{i.title}</span>}
                  {i.general_label && i.general_label !== i.label && <span className="ml-1 text-[10px] text-amber">was {i.general_label.slice(0, 4).toUpperCase()}</span>}
                </div>
                <span className="shrink-0 text-[10px] text-dim">{(i.time || "").slice(5, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function SentimentPanel({ ticker, fold }) {
  const s = useApi(`sentiment?ticker=${ticker}`, [ticker]);
  const d = s.data;
  const lags = d ? Object.entries(d.corr_by_lag).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]) : [];
  // Data-driven finding: does today's score track past returns (lags) or future returns (leads) more strongly?
  const peak = (f) => Math.max(0, ...lags.filter(([k]) => f(k)).map(([, v]) => Math.abs(v)));
  const past = peak((k) => k < 0), next = peak((k) => k > 0);
  const scores = d ? d.rows.map((r) => r.score) : [];
  const last30 = scores.slice(-30).filter((x) => x !== null);
  const avg30 = last30.length ? last30.reduce((a, b) => a + b, 0) / last30.length : null;
  const finding = d && <Signal tone="amber" word={past > next ? "LAGS PRICE" : "LEADS PRICE"}
    title={`peak |corr| with past returns ${past.toFixed(2)}, with future returns ${next.toFixed(2)}`} />;
  const glance = d && <>
    {avg30 !== null && <Signal label={scoreLabel(avg30)} title="mean daily score, last 30 days with headlines" />}
    {avg30 !== null && <span className="text-dim">30d {avg30 >= 0 ? "+" : ""}{avg30.toFixed(2)}</span>}
    <Sparkline values={scores.slice(-90)} zero color="#9aa3ad" title="daily score, last 90 days" />
    {finding}
  </>;
  return (
    <Panel code="SNT" title="sentiment vs price" className="h-full" {...fold} summary={glance}
      right={d && `${d.start} to ${d.end} · FNSPID`}>
      <Status s={s} what="sentiment" />
      {d && (
        <div className="flex h-full flex-col gap-1">
          <div className="flex items-center gap-2 text-[10px]"
            title="Amber line: close. Bars: daily score = (bullish - bearish) / headlines; green above +0.2, red below -0.2.">
            {glance}
          </div>
          <div className="min-h-0 flex-1"><SentimentChart rows={d.rows} /></div>
          <div className="border-t border-line pt-0.5">
            <div className="mb-0.5 text-[10px]" title="Correlation of today's score with the return k days away. Bars on the left (past) dominate: headlines react to price.">
              <span className="text-amber">KEY FINDING</span> {finding} <span className="text-dim">corr(score, return at k)</span>
            </div>
            <div className="flex items-end gap-1">
              {lags.map(([k, v]) => (
                <div key={k} className="flex flex-1 flex-col items-center" title={`k=${k}: corr ${v.toFixed(3)}`}>
                  <div className="text-[10px] text-ink">{v.toFixed(2)}</div>
                  <div className="flex h-7 w-full items-end justify-center">
                    <div className={`w-3/5 rounded-t-[3px] ${k < 0 ? "bg-amber" : "bg-dim/60"}`}
                      style={{ height: `${Math.max(2, Math.abs(v) / 0.35 * 100)}%`, opacity: v < 0 ? 0.5 : 1 }} />
                  </div>
                  <div className="text-[10px] text-dim">{k === 0 ? "0d" : k < 0 ? `${k}d` : `+${k}d`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function BacktestPanel({ ticker, fold }) {
  const [run, setRun] = useState(0);
  const s = useApi(run ? `backtest?ticker=${ticker}` : null, [ticker, run]);
  useEffect(() => setRun(0), [ticker]);
  const d = s.data;
  const order = ["Sentiment", "Buy and hold", "Random (mean of 100)", "Cash"];
  const read = d && (() => {
    const beat = d.metrics.Sentiment.total_return > d.metrics["Buy and hold"].total_return;
    const nRand = d.diagnostics.random_seeds_beaten_by_sentiment, skill = nRand >= 95;
    return <>
      <Signal label={beat ? "Bullish" : "Bearish"} word={beat ? "BEAT B&H" : "LOST TO B&H"} title={`sentiment ${pct(d.metrics.Sentiment.total_return)} vs buy and hold ${pct(d.metrics["Buy and hold"].total_return)}`} />
      <Signal tone={skill ? "amber" : undefined} word={skill ? "UNUSUAL" : "LUCK"}
        title={skill ? "Beat 95+ of the random-timing runs: unusual, but still one stock, one year." : "Within the range of random timing: consistent with luck, not skill."} />
      <span className="text-dim">beat {nRand}/{d.seeds} random</span>
    </>;
  })();
  return (
    <Panel code="BT" title="backtest" className="h-full" {...fold} summary={read}
      right={<button onClick={() => setRun((x) => x + 1)} className="border border-amber px-2 text-amber hover:bg-amber hover:text-ground">RUN</button>}>
      {!run && <div className="text-[11px] text-dim">{ticker} · 2022-12-16 to 2023-12-15 · press RUN</div>}
      <Status s={s} what="backtest (about 2s)" />
      {d && (
        <div className="flex h-full flex-col gap-1">
          <div className="flex flex-wrap gap-x-3 text-[10px] text-dim"
            title={`${money(d.capital)} start. Long if score > +${d.threshold}, cash if < -${d.threshold}, trade next open, ${(d.slippage * 100).toFixed(2)}% slippage. Random = same trade count, ${d.seeds} seeds; dotted band = 5th to 95th pct.`}>
            <span>{money(d.capital)}</span><span>long &gt;+{d.threshold} / cash &lt;-{d.threshold}</span>
            <span>{(d.slippage * 100).toFixed(2)}% slip</span><span>{d.seeds} random seeds, band 5-95%</span>
          </div>
          <div className="min-h-0 flex-1"><EquityChart curves={d.curves} band={d.random_band} /></div>
          <table className="w-full text-right text-[11px]">
            <thead className="text-dim"><tr><th className="text-left font-normal">strategy</th><th className="font-normal">final</th><th className="font-normal">return</th><th className="font-normal">max dd</th><th className="font-normal">trades</th><th className="font-normal">win</th><th className="font-normal">sharpe</th></tr></thead>
            <tbody>{order.map((k) => { const m = d.metrics[k]; return (
              <tr key={k} className="border-t border-line/60">
                <td className="text-left"><span className="mr-1 inline-block h-2 w-2" style={{ background: SERIES[k] }} />{k.replace(" (mean of 100)", " (avg)")}</td>
                <td>{money(m.final_value)}</td><td className={tone(m.total_return)}>{pct(m.total_return)}</td>
                <td>{pct(m.max_drawdown)}</td><td>{Math.round(m.orders)}</td>
                <td>{m.win_rate === null ? "n/a" : pct(m.win_rate, 0).replace("+", "")}</td>
                <td>{m.sharpe === null ? "n/a" : m.sharpe.toFixed(2)}</td>
              </tr>); })}</tbody>
          </table>
          <div className="flex items-center gap-2 border-l-2 border-amber pl-2 text-[11px]">
            <span className="text-amber">HONEST READ</span>{read}
          </div>
        </div>
      )}
    </Panel>
  );
}

function BenchmarkPanel({ fold }) {
  const s = useApi("benchmarks", []);
  const rows = s.data?.rows || [];
  const ours = rows.find((r) => r.model.includes("2B QLoRA")), fb = rows.find((r) => r.model.toLowerCase().includes("finbert fine"));
  const summary = ours && <>
    <span>ours 2B <b>{(ours.accuracy * 100).toFixed(1)}%</b> <span className="text-dim">F1 {ours.macro_f1.toFixed(3)}</span></span>
    {fb && <span className="text-dim">FinBERT-ft {(fb.accuracy * 100).toFixed(1)}%</span>}
    {fb && <Signal label={ours.accuracy > fb.accuracy ? "Bullish" : "Bearish"} word={ours.accuracy > fb.accuracy ? "AHEAD" : "BEHIND"} />}
  </>;
  return (
    <Panel code="BM" title="model benchmark" className="h-full" right={s.data?.dataset} {...fold} summary={summary}>
      <Status s={s} what="benchmarks" />
      {s.data && (
        <div className="overflow-x-auto text-[11px]">
          <table className="w-full min-w-[640px] text-right" title="▶ model serving this terminal. Speed is GPU eval throughput; the 9B ran on a different GPU.">
            <thead className="text-dim"><tr><th className="text-left font-normal">model</th><th className="font-normal">accuracy</th><th className="font-normal">macro F1</th><th className="font-normal">F1 bear</th><th className="font-normal">F1 bull</th><th className="font-normal">F1 neutral</th><th className="font-normal">ex/s</th><th className="font-normal">gpu</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.model} className={`border-t border-line/60 ${r.model.includes("ours") ? "text-ink" : "text-dim"}`}>
                <td className="text-left">{r.model.includes("2B QLoRA") && <span className="text-amber">&#9654; </span>}{r.model}</td>
                <td>{r.accuracy.toFixed(4)}</td><td>{r.macro_f1.toFixed(4)}</td>
                <td>{r.per_class_f1.Bearish.toFixed(3)}</td><td>{r.per_class_f1.Bullish.toFixed(3)}</td><td>{r.per_class_f1.Neutral.toFixed(3)}</td>
                <td>{Math.round(r.examples_per_sec)}</td><td className="text-dim">{r.gpu.replace("NVIDIA ", "")}</td>
              </tr>))}</tbody>
          </table>
          {s.data.crypto && (
            <div className="mt-1">
              <div className="text-[10px]" title={s.data.crypto.note}><span className="text-amber">CRYPTO </span>{s.data.crypto.dataset}{" "}
                <span className="border border-amber/60 px-1 text-amber">NO NEUTRAL CLASS</span></div>
              <table className="w-full min-w-[480px] text-right">
                <thead className="text-dim"><tr><th className="text-left font-normal">model</th><th className="font-normal">binary accuracy [95% CI]</th><th className="font-normal">macro F1</th><th className="font-normal">says Neutral</th></tr></thead>
                <tbody>{s.data.crypto.rows.map((r) => (
                  <tr key={r.model} className={`border-t border-line/60 ${r.model.includes("specialist") ? "text-ink" : "text-dim"}`}>
                    <td className="text-left">{r.model}</td>
                    <td>{r.binary_accuracy.toFixed(3)} <span className="text-dim">[{r.ci95[0].toFixed(3)}, {r.ci95[1].toFixed(3)}]</span></td>
                    <td>{r.macro_f1.toFixed(3)}</td><td>{(r.neutral_rate * 100).toFixed(0)}%</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export default function App() {
  const [ticker, setTicker] = useState(() => {
    try { return localStorage.getItem("kw.ticker") || "NVDA"; } catch { return "NVDA"; }
  });
  const [health, setHealth] = useState(null);
  const [layouts, setLayouts] = useState(loadLayouts);
  const [hidden, setHiddenState] = useState(() => readJSON(HIDDEN_KEY, []));
  const [saved, setSaved] = useState(() => readJSON(SAVED_KEY, {}));
  const [collapsed, setCollapsedState] = useState(() => readJSON(COLLAPSED_KEY, DEFAULT_COLLAPSED));
  const setCollapsed = (c) => { setCollapsedState(c); writeJSON(COLLAPSED_KEY, c); };
  const fold = (id) => ({ collapsed: collapsed.includes(id),
    onToggle: () => setCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]) });
  const setHidden = (h) => { setHiddenState(h); writeJSON(HIDDEN_KEY, h); };
  const applyLayouts = (l) => { setLayouts(l); writeJSON(LAYOUT_KEY, l); setGridKey((k) => k + 1); };
  const resetLayout = () => { try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ } setHidden([]); setCollapsed(DEFAULT_COLLAPSED); setLayouts(DEFAULT_LAYOUTS); setGridKey((k) => k + 1); };
  const saveLayout = (n) => { const s = { ...saved, [n]: { layouts, hidden, collapsed } }; setSaved(s); writeJSON(SAVED_KEY, s); };
  const loadSaved = (n) => { const x = saved[n]; if (x) { setHidden(x.hidden || []); setCollapsed(x.collapsed || DEFAULT_COLLAPSED); applyLayouts(x.layouts || DEFAULT_LAYOUTS); } };
  const deleteSaved = (n) => { const s = { ...saved }; delete s[n]; setSaved(s); writeJSON(SAVED_KEY, s); };
  const [gridKey, setGridKey] = useState(0);
  const [specVersion, setSpecVersion] = useState(0);
  const [specReady, setSpecReady] = useState(false);
  useEffect(() => {
    setSpecReady(false);
    api(`specialist/status?ticker=${ticker}`).then((d) => setSpecReady(d.phase === "done")).catch(() => setSpecReady(false));
  }, [ticker, specVersion]);
  const choose = useCallback((t) => {
    setTicker(t);
    try { localStorage.setItem("kw.ticker", t); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { api("health").then(setHealth).catch(() => setHealth(null)); }, [ticker]);
  const hist = health?.historical_tickers || [];
  return (
    <div className="min-h-full">
      <Header ticker={ticker} onSubmit={choose} health={health} />
      <Toolbar hidden={hidden} setHidden={setHidden} onReset={resetLayout} saved={saved}
        onSave={saveLayout} onLoad={loadSaved} onDelete={deleteSaved} />
      {health?.mode === "vercel" && (
        <div className="mx-1 mt-1 border border-amber/40 bg-panel px-2 py-1 text-[11px] text-dim">
          <span className="text-amber">PUBLIC MIRROR </span>
          Data pushed from our Oscar GPU worker{health.snapshot_pushed_at ? ` at ${new Date(health.snapshot_pushed_at).toLocaleString()}` : ""}.
          Tracked: {(health.tracked_tickers || []).join(", ")}. Worker {health.worker_online ? <span className="text-up">online</span> : <span className="text-down">offline (training unavailable)</span>}.
        </div>
      )}
      {hist.length > 0 && !hist.includes(ticker) && (
        <div className="mx-1 mt-1 border border-line bg-panel px-2 py-1 text-[11px] text-dim">
          Sentiment history and backtest need cached FNSPID headlines, available for {hist.join(", ")}. See README to add {ticker}.
        </div>
      )}
      <Grid key={gridKey} className="layout" layouts={foldLayouts(layouts, collapsed)} breakpoints={{ lg: 1000, sm: 0 }} cols={{ lg: 12, sm: 1 }}
        rowHeight={30} margin={[4, 4]} containerPadding={[4, 4]} draggableHandle=".kw-drag"
        draggableCancel="button,input,a" onLayoutChange={(_, all) => {
          setLayouts((prev) => { const m = mergeLayouts(prev, unfoldLayouts(all, prev, collapsed)); writeJSON(LAYOUT_KEY, m); return m; });
        }}>
        {[
          ["px", <PricePanel ticker={ticker} fold={fold("px")} />],
          ["nws", <NewsPanel ticker={ticker} specReady={specReady} specVersion={specVersion} fold={fold("nws")} />],
          ["brf", <BriefingPanel ticker={ticker} fold={fold("brf")} />],
          ["snt", <SentimentPanel ticker={ticker} fold={fold("snt")} />],
          ["bt", <BacktestPanel ticker={ticker} fold={fold("bt")} />],
          ["spc", <SpecialistPanel ticker={ticker} onTrained={() => setSpecVersion((v) => v + 1)} fold={fold("spc")} />],
          ["bm", <BenchmarkPanel fold={fold("bm")} />],
        ].filter(([id]) => !hidden.includes(id)).map(([id, el]) => (
          <div key={id}>{el}</div>
        ))}
      </Grid>
      {hidden.length === PANELS.length && <div className="px-3 py-6 text-center text-dim">All panels hidden. Turn one on in the PANELS toolbar.</div>}
      <footer className="px-3 py-2 text-[10px] text-dim">Knight-Daddy, Hack Knight finance track. Research demo, not investment advice.</footer>
    </div>
  );
}
