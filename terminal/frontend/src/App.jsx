import { useCallback, useEffect, useState } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { PriceChart, SentimentChart, EquityChart, SERIES } from "./charts.jsx";
import { api, pct, money, tone, TAG, useApi, Panel, Status } from "./ui.jsx";
import { SpecialistPanel } from "./specialist.jsx";
import { BriefingPanel } from "./briefing.jsx";

const Grid = WidthProvider(Responsive);
const LAYOUT_KEY = "kw.layouts.v3"; // v2 added the specialist panel, v3 the briefing panel
const DEFAULT_LAYOUTS = {
  lg: [
    { i: "px", x: 0, y: 0, w: 8, h: 10, minW: 3, minH: 5 },
    { i: "nws", x: 8, y: 0, w: 4, h: 10, minW: 2, minH: 4 },
    { i: "brf", x: 0, y: 10, w: 12, h: 4, minW: 4, minH: 3 },
    { i: "snt", x: 0, y: 14, w: 7, h: 11, minW: 3, minH: 7 },
    { i: "bt", x: 7, y: 14, w: 5, h: 11, minW: 3, minH: 8 },
    { i: "spc", x: 0, y: 25, w: 12, h: 12, minW: 6, minH: 8 },
    { i: "bm", x: 0, y: 37, w: 12, h: 6, minW: 4, minH: 3 },
  ],
  sm: [
    { i: "px", x: 0, y: 0, w: 1, h: 10 }, { i: "nws", x: 0, y: 10, w: 1, h: 10 }, { i: "brf", x: 0, y: 20, w: 1, h: 7 },
    { i: "snt", x: 0, y: 27, w: 1, h: 12 }, { i: "bt", x: 0, y: 39, w: 1, h: 13 },
    { i: "spc", x: 0, y: 52, w: 1, h: 20 }, { i: "bm", x: 0, y: 72, w: 1, h: 8 },
  ],
};
const loadLayouts = () => {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || DEFAULT_LAYOUTS; } catch { return DEFAULT_LAYOUTS; }
};

function Header({ ticker, onSubmit, health }) {
  const [q, setQ] = useState(ticker);
  useEffect(() => setQ(ticker), [ticker]);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber/60 bg-panel px-3 py-2">
      <div className="text-sm font-bold tracking-[0.2em] text-amber">&#9822; KNIGHTWATCH</div>
      <div className="text-[11px] text-dim">headline sentiment research terminal</div>
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); q.trim() && onSubmit(q.trim().toUpperCase()); }}>
        <span className="text-amber">&gt;</span>
        <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} aria-label="Ticker"
          className="w-28 border border-line bg-ground px-2 py-1 font-bold text-ink uppercase outline-none focus:border-amber"
          placeholder="TICKER" maxLength={10} />
        <button className="border border-amber px-2 py-1 text-amber hover:bg-amber hover:text-ground">GO</button>
      </form>
      <div className="flex gap-1">
        {["NVDA", "DDOG"].map((t) => (
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

function PricePanel({ ticker }) {
  const [period, setPeriod] = useState("1y");
  const s = useApi(`prices?ticker=${ticker}&period=${period}`, [ticker, period]);
  const d = s.data;
  return (
    <Panel code="PX" title={`${ticker} daily`} className="h-full"
      right={<span className="flex gap-1">{["3mo", "6mo", "1y", "2y"].map((p) => (
        <button key={p} onClick={() => setPeriod(p)} className={p === period ? "text-amber" : "hover:text-ink"}>{p}</button>))}</span>}>
      <Status s={s} what="prices" />
      {d && (
        <div className="flex h-full flex-col">
          <div className="mb-1 flex flex-wrap gap-4">
            <span className="text-lg font-bold">{d.last.toFixed(2)}</span>
            <span className={tone(d.change_1d)}>1D {pct(d.change_1d, 2)}</span>
            <span className={tone(d.change_period)}>{period.toUpperCase()} {pct(d.change_period)}</span>
            <span className="text-dim">HI {d.high.toFixed(2)} LO {d.low.toFixed(2)}</span>
            <span className="text-dim">{d.bars[0].time} to {d.bars.at(-1).time}</span>
          </div>
          <div className="min-h-0 flex-1"><PriceChart bars={d.bars} /></div>
        </div>
      )}
    </Panel>
  );
}

function NewsPanel({ ticker, specReady, specVersion }) {
  const [source, setSource] = useState("live");
  const [model, setModel] = useState("general");
  useEffect(() => { if (!specReady) setModel("general"); }, [specReady]);
  const s = useApi(`headlines?ticker=${ticker}&source=${source}&limit=40&model=${model}`, [ticker, source, model, specVersion]);
  const items = s.data?.items || [];
  const counts = items.reduce((a, i) => ((a[i.label] = (a[i.label] || 0) + 1), a), {});
  return (
    <Panel code="NWS" title="headlines" className="h-full"
      right={<span className="flex gap-2">
        {specReady && ["general", "specialist"].map((x) => (
          <button key={x} onClick={() => setModel(x)} className={x === model ? "text-amber" : "hover:text-ink"}>{x}</button>))}
        {specReady && <span className="text-line">|</span>}
        {["live", "historical"].map((x) => (
          <button key={x} onClick={() => setSource(x)} className={x === source ? "text-amber" : "hover:text-ink"}>{x}</button>))}</span>}>
      <Status s={s} what={source === "live" ? "headlines (first run loads the model, about 30s)" : "headlines"} />
      {s.data && (
        <div className="flex h-full flex-col">
          <div className="mb-1 flex gap-3 text-[11px]">
            <span className="text-up">BULL {counts.Bullish || 0}</span>
            <span className="text-down">BEAR {counts.Bearish || 0}</span>
            <span className="text-flat">NEUT {counts.Neutral || 0}</span>
            {model === "specialist" && <span className="text-amber">{ticker} SPECIALIST, {items.filter((i) => i.general_label && i.general_label !== i.label).length} changed</span>}
            <span className={`ml-auto ${s.data.provider_note ? "text-amber" : "text-dim"}`} title={s.data.provider_note || ""}>
              {source === "live" ? s.data.provider : "FNSPID 2023"}</span>
          </div>
          {source === "live" && (s.data.filter_note || s.data.provider_note) && (
            <div className={`mb-1 text-[10px] ${s.data.provider_note ? "text-amber" : "text-dim"}`}>
              {s.data.provider_note || s.data.filter_note}</div>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 && <li className="text-dim">no headlines found</li>}
            {items.map((i, k) => (
              <li key={k} className="flex gap-2 border-b border-line/60 py-1">
                <span className={`h-fit w-14 shrink-0 border px-1 text-center text-[10px] ${TAG[i.label] || "border-line text-dim"}`}
                  title={i.p_bull !== undefined ? `bull ${(i.p_bull * 100).toFixed(0)}% / bear ${(i.p_bear * 100).toFixed(0)}% / neutral ${(i.p_neut * 100).toFixed(0)}%` : "not classified"}>
                  {i.label ? i.label.slice(0, 4).toUpperCase() : "----"}</span>
                <div className="min-w-0">
                  {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="hover:text-amber">{i.title}</a> : <span>{i.title}</span>}
                  <div className="text-[10px] text-dim">{(i.time || "").slice(0, 16).replace("T", " ")} {i.source}
                    {i.general_label && i.general_label !== i.label && <span className="ml-2 text-amber">was {i.general_label.slice(0, 4).toUpperCase()}</span>}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function SentimentPanel({ ticker }) {
  const s = useApi(`sentiment?ticker=${ticker}`, [ticker]);
  const d = s.data;
  const lags = d ? Object.entries(d.corr_by_lag).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]) : [];
  return (
    <Panel code="SNT" title="sentiment vs price" className="h-full"
      right={d && `${d.start} to ${d.end}, FNSPID headlines`}>
      <Status s={s} what="sentiment" />
      {d && (
        <div className="flex h-full flex-col gap-2">
          <div className="text-[11px] text-dim">
            Amber: close. Bars: daily score = (bullish - bearish) / headlines, green above +0.2, red below -0.2.
          </div>
          <div className="min-h-0 flex-1"><SentimentChart rows={d.rows} /></div>
          <div className="border-t border-line pt-1">
            <div className="mb-1 text-[11px]">
              <span className="text-amber">KEY FINDING</span> headlines lag price: today's score vs the return k days away
            </div>
            <div className="flex items-end gap-1">
              {lags.map(([k, v]) => (
                <div key={k} className="flex flex-1 flex-col items-center" title={`k=${k}: corr ${v.toFixed(3)}`}>
                  <div className="text-[10px] text-ink">{v.toFixed(2)}</div>
                  <div className="flex h-10 w-full items-end justify-center">
                    <div className={`w-3/5 rounded-t-[3px] ${k < 0 ? "bg-amber" : "bg-dim/60"}`}
                      style={{ height: `${Math.max(2, Math.abs(v) / 0.35 * 100)}%`, opacity: v < 0 ? 0.5 : 1 }} />
                  </div>
                  <div className="text-[10px] text-dim">{k === 0 ? "day 0" : k < 0 ? `${k}d past` : `+${k}d next`}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function BacktestPanel({ ticker }) {
  const [run, setRun] = useState(0);
  const s = useApi(run ? `backtest?ticker=${ticker}` : null, [ticker, run]);
  useEffect(() => setRun(0), [ticker]);
  const d = s.data;
  const order = ["Sentiment", "Buy and hold", "Random (mean of 100)", "Cash"];
  return (
    <Panel code="BT" title="backtest" className="h-full"
      right={<button onClick={() => setRun((x) => x + 1)} className="border border-amber px-2 text-amber hover:bg-amber hover:text-ground">RUN</button>}>
      {!run && <div className="text-dim">Run our sentiment strategy on {ticker} for 2022-12-16 to 2023-12-15. Press RUN.</div>}
      <Status s={s} what="backtest (about 2s)" />
      {d && (
        <div className="flex h-full flex-col gap-1">
          <div className="text-[11px] text-dim">
            {money(d.capital)} start. Long if score &gt; +{d.threshold}, cash if &lt; -{d.threshold}, trade next open, {(d.slippage * 100).toFixed(2)}% slippage.
            Random = same trade count, {d.seeds} seeds; dotted band = 5th to 95th pct.
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
          <div className="border-l-2 border-amber pl-2 text-[11px]">
            <span className="text-amber">HONEST READ </span>
            {d.metrics.Sentiment.total_return > d.metrics["Buy and hold"].total_return ? "Sentiment beat buy and hold here, " : "Sentiment lost to buy and hold, "}
            and beat {d.diagnostics.random_seeds_beaten_by_sentiment} of {d.seeds} random-timing runs, which is
            {d.diagnostics.random_seeds_beaten_by_sentiment >= 95 ? " unusual. Still one stock, one year." : " consistent with luck, not skill."}
          </div>
        </div>
      )}
    </Panel>
  );
}

function BenchmarkPanel() {
  const s = useApi("benchmarks", []);
  const rows = s.data?.rows || [];
  return (
    <Panel code="BM" title="model benchmark" className="h-full" right={s.data?.dataset}>
      <Status s={s} what="benchmarks" />
      {s.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-right">
            <thead className="text-dim"><tr><th className="text-left font-normal">model</th><th className="font-normal">accuracy</th><th className="font-normal">macro F1</th><th className="font-normal">F1 bear</th><th className="font-normal">F1 bull</th><th className="font-normal">F1 neutral</th><th className="font-normal">ex/s</th><th className="font-normal">gpu</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.model} className={`border-t border-line/60 ${r.model.includes("ours") ? "text-ink" : "text-dim"}`}>
                <td className="text-left">{r.model.includes("2B QLoRA") && <span className="text-amber">&#9654; </span>}{r.model}</td>
                <td>{r.accuracy.toFixed(4)}</td><td>{r.macro_f1.toFixed(4)}</td>
                <td>{r.per_class_f1.Bearish.toFixed(3)}</td><td>{r.per_class_f1.Bullish.toFixed(3)}</td><td>{r.per_class_f1.Neutral.toFixed(3)}</td>
                <td>{Math.round(r.examples_per_sec)}</td><td className="text-dim">{r.gpu.replace("NVIDIA ", "")}</td>
              </tr>))}</tbody>
          </table>
          <div className="mt-1 text-[11px] text-dim">&#9654; model serving this terminal. Speed is GPU eval throughput; the 9B ran on a different GPU.</div>
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
      {hist.length > 0 && !hist.includes(ticker) && (
        <div className="mx-1 mt-1 border border-line bg-panel px-2 py-1 text-[11px] text-dim">
          Sentiment history and backtest need cached FNSPID headlines, available for {hist.join(", ")}. See README to add {ticker}.
        </div>
      )}
      <div className="flex justify-end gap-3 px-2 pt-1 text-[10px] text-dim">
        <span>drag panel headers to move, corner to resize; layout is saved in this browser</span>
        <button onClick={() => { try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ } setLayouts(DEFAULT_LAYOUTS); setGridKey((k) => k + 1); }}
          className="text-amber hover:underline">RESET LAYOUT</button>
      </div>
      <Grid key={gridKey} className="layout" layouts={layouts} breakpoints={{ lg: 1000, sm: 0 }} cols={{ lg: 12, sm: 1 }}
        rowHeight={34} margin={[4, 4]} containerPadding={[4, 4]} draggableHandle=".kw-drag"
        draggableCancel="button,input,a" onLayoutChange={(_, all) => {
          setLayouts(all);
          try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
        }}>
        <div key="px"><PricePanel ticker={ticker} /></div>
        <div key="nws"><NewsPanel ticker={ticker} specReady={specReady} specVersion={specVersion} /></div>
        <div key="brf"><BriefingPanel ticker={ticker} /></div>
        <div key="snt"><SentimentPanel ticker={ticker} /></div>
        <div key="bt"><BacktestPanel ticker={ticker} /></div>
        <div key="spc"><SpecialistPanel ticker={ticker} onTrained={() => setSpecVersion((v) => v + 1)} /></div>
        <div key="bm"><BenchmarkPanel /></div>
      </Grid>
      <footer className="px-3 py-2 text-[10px] text-dim">KNIGHTWATCH, Hack Knight finance track. Research demo, not investment advice.</footer>
    </div>
  );
}
