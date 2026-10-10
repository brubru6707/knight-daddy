import { useState } from "react";
import { smoothPath } from "./price.jsx";
import { SpecialistResults } from "./specialist.jsx";
import { money, pct, Status, useApi, useWidth } from "./ui.jsx";

const H3 = ({ children }) => <h3 className="text-sm font-semibold text-ink">{children}</h3>;
const Stat = ({ k, v, cls = "text-ink" }) => (
  <div><div className="text-xs text-dim">{k}</div><div className={`mt-1 text-[17px] ${cls}`}>{v}</div></div>);

function SentimentVsPrice({ ticker, health }) {
  const hist = health?.historical_tickers;
  const s = useApi(!hist || hist.includes(ticker) ? `sentiment?ticker=${ticker}` : null);
  const [ref, w] = useWidth();
  const d = s.data;
  const H = 170, B = 22;
  let chart = null, finding = null;
  if (d) {
    const rows = d.rows, n = rows.length;
    const closes = rows.map((r) => r.close), lo = Math.min(...closes), hi = Math.max(...closes);
    const X = (i) => (i / Math.max(1, n - 1)) * w;
    const Yp = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - B - 12);
    const mid = (H - B) / 2, Ys = (v) => mid - v * (mid - 8);
    const bw = Math.max(1, w / n - 1);
    chart = w > 0 && (
      <svg width={w} height={H} role="img" aria-label="Daily sentiment score bars against the closing price">
        <line x1={0} x2={w} y1={mid} y2={mid} style={{ stroke: "var(--kd-line)" }} />
        {rows.map((r, i) => r.score !== null && Math.abs(r.score) > 0.2 && (
          <rect key={i} x={X(i) - bw / 2} width={bw} y={r.score > 0 ? Ys(r.score) : mid} height={Math.abs(Ys(r.score) - mid)}
            style={{ fill: r.score > 0 ? "var(--kd-up)" : "var(--kd-down)", opacity: 0.55 }} />))}
        <path d={smoothPath(rows.map((r, i) => [X(i), Yp(r.close)]))} fill="none" style={{ stroke: "var(--kd-chart)" }} strokeWidth="1.75" />
        {[0, 0.5, 1].map((f, k) => { const i = Math.round(f * (n - 1)); return (
          <text key={k} x={X(i)} y={H - 6} fontSize="11" textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} style={{ fill: "var(--kd-dim)" }}>{rows[i].time}</text>); })}
      </svg>
    );
    const lags = Object.entries(d.corr_by_lag).map(([k, v]) => [Number(k), v]);
    const prev = d.corr_by_lag["-1"], next = d.corr_by_lag["1"];
    const past = Math.max(0, ...lags.filter(([k]) => k < 0).map(([, v]) => Math.abs(v)));
    const fut = Math.max(0, ...lags.filter(([k]) => k > 0).map(([, v]) => Math.abs(v)));
    finding = { lags: past > fut, prev, next };
  }
  return (
    <div>
      <H3>Sentiment vs. price</H3>
      {hist && !hist.includes(ticker) && <p className="mt-2 text-sm text-dim">n/a: historical headlines are cached for {hist.join(", ")} only.</p>}
      <Status s={s} what="sentiment history" />
      {d && (
        <>
          <p className="mt-2 text-sm text-dim">Daily headline sentiment against {ticker}'s close, {d.start} to {d.end} (FNSPID).</p>
          <div ref={ref} className="mt-4 w-full">{chart}</div>
          <div className="mt-2 flex gap-4 text-xs text-dim">
            <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-amber" />Price</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 bg-up opacity-60" />Bullish day</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 bg-down opacity-60" />Bearish day</span>
          </div>
          <p className="mt-4 text-sm text-ink" data-testid="sentiment-caption">
            {finding.lags ? "Sentiment tracks the previous day's move, not the next one. It lags price." : "Sentiment correlates more with the next day's move than the previous one over this window."}</p>
          <p className="mt-1 text-xs text-dim">Correlation with the previous day's return {finding.prev?.toFixed(2) ?? "n/a"}, with the next day's {finding.next?.toFixed(2) ?? "n/a"}.</p>
        </>
      )}
    </div>
  );
}

function Backtest({ ticker, health }) {
  const hist = health?.historical_tickers;
  const s = useApi(!hist || hist.includes(ticker) ? `backtest?ticker=${ticker}` : null);
  const [ref, w] = useWidth();
  const d = s.data;
  const sent = d?.metrics?.Sentiment, bh = d?.metrics?.["Buy and hold"];
  const lost = sent && bh && sent.total_return < bh.total_return;
  const H = 110;
  let chart = null;
  if (d && w > 0) {
    const a = d.curves.Sentiment.map((p) => p.value), b = d.curves["Buy and hold"].map((p) => p.value);
    const all = [...a, ...b], lo = Math.min(...all), hi = Math.max(...all);
    const X = (i, n) => (i / Math.max(1, n - 1)) * w, Y = (v) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
    chart = (
      <svg width={w} height={H} role="img" aria-label="Equity curves">
        <path d={smoothPath(b.map((v, i) => [X(i, b.length), Y(v)]))} fill="none" style={{ stroke: "var(--kd-flat)" }} strokeWidth="1.5" />
        <path d={smoothPath(a.map((v, i) => [X(i, a.length), Y(v)]))} fill="none" style={{ stroke: "var(--kd-chart)" }} strokeWidth="2" />
      </svg>
    );
  }
  return (
    <div>
      <H3>Historical backtest</H3>
      {hist && !hist.includes(ticker) && <p className="mt-2 text-sm text-dim">n/a: needs cached historical headlines ({hist.join(", ")}).</p>}
      <Status s={s} what="backtest" />
      {d && sent && bh && (
        <>
          <p className="mt-2 text-sm text-dim">Long when the daily score is above +{d.threshold}, in cash below -{d.threshold}, {d.start} to {d.end}, {money(d.capital)} start, {(d.slippage * 100).toFixed(2)}% slippage.</p>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Stat k="Sentiment strategy" v={pct(sent.total_return, 0)} cls={sent.total_return >= 0 ? "text-up" : "text-down"} />
            <Stat k="Buy-and-hold" v={pct(bh.total_return, 0)} cls={bh.total_return >= 0 ? "text-up" : "text-down"} />
            <Stat k="Sharpe" v={sent.sharpe === null ? "n/a" : sent.sharpe.toFixed(2)} />
            <Stat k="Win rate" v={sent.win_rate === null ? "n/a" : `${Math.round(sent.win_rate * 100)}%`} />
          </div>
          <div ref={ref} className="mt-4 w-full">{chart}</div>
          <div className="mt-1 flex gap-4 text-xs text-dim">
            <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-amber" />Sentiment</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-flat" />Buy-and-hold</span>
          </div>
          <p className="mt-4 text-sm text-ink" data-testid="backtest-caption">
            {lost ? "Trading on sentiment lost to buy-and-hold." : "Trading on sentiment beat buy-and-hold over this window."}</p>
          <p className="mt-1 text-xs text-dim">Beat {d.diagnostics.random_seeds_beaten_by_sentiment} of {d.seeds} random-timing runs with the same number of trades{d.diagnostics.random_seeds_beaten_by_sentiment >= 95 ? "." : ", consistent with luck."}</p>
        </>
      )}
    </div>
  );
}

function ModelCard() {
  const s = useApi("benchmarks");
  const rows = s.data?.rows || [];
  const ours = rows.find((r) => r.model.includes("2B QLoRA"));
  return (
    <div>
      <H3>Model</H3>
      <p className="mt-2 text-sm leading-relaxed text-ink" data-testid="model-copy">
        Qwen3.5-2B QLoRA. 91.9% accuracy, 0.895 macro F1 on 2,388 held-out financial tweets. FinBERT fine-tuned on the same data: 88.9%.</p>
      <Status s={s} what="benchmarks" />
      {ours?.per_class_f1 && (
        <table className="mt-4 w-full text-sm">
          <thead className="text-xs text-dim"><tr><th className="pb-2 text-left font-normal">Class</th><th className="pb-2 text-right font-normal">F1</th></tr></thead>
          <tbody>{["Bullish", "Bearish", "Neutral"].map((c) => (
            <tr key={c} className="border-t border-line"><td className="py-2">{c}</td><td className="py-2 text-right">{ours.per_class_f1[c]?.toFixed(2) ?? "n/a"}</td></tr>))}</tbody>
        </table>
      )}
      {rows.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs text-dim hover:text-amber">All benchmark rows ({s.data.dataset})</summary>
          <table className="mt-2 w-full text-xs">
            <thead className="text-dim"><tr><th className="py-1 text-left font-normal">model</th><th className="py-1 text-right font-normal">accuracy</th><th className="py-1 text-right font-normal">macro F1</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.model} className={`border-t border-line ${r.model.includes("ours") ? "text-ink" : "text-dim"}`}>
                <td className="py-1.5">{r.model}</td><td className="py-1.5 text-right">{(r.accuracy * 100).toFixed(1)}%</td><td className="py-1.5 text-right">{r.macro_f1.toFixed(3)}</td></tr>))}</tbody>
          </table>
          {s.data.crypto && (
            <p className="mt-2 text-xs text-dim">Crypto ({s.data.crypto.dataset}, no Neutral class): {s.data.crypto.rows.map((r) => `${r.model} ${(r.binary_accuracy * 100).toFixed(1)}%`).join(", ")}.</p>
          )}
        </details>
      )}
    </div>
  );
}

export function AdvancedResearch({ ticker, health, specVersion }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-12 border-t border-line pt-6" aria-label="Advanced research">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-baseline gap-2 text-left">
        <span className="text-dim">{open ? "⌃" : "⌄"}</span>
        <span className="text-[15px] text-ink">Advanced research</span>
        <span className="text-xs text-dim">sentiment vs. price, backtest, model, specialist</span>
      </button>
      {open && (
        <div className="mt-8 space-y-12">
          <SentimentVsPrice ticker={ticker} health={health} />
          <div className="grid gap-10 md:grid-cols-2"><Backtest ticker={ticker} health={health} /><ModelCard /></div>
          <SpecialistResults ticker={ticker} specVersion={specVersion} />
        </div>
      )}
    </section>
  );
}
