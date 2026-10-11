import { useState } from "react";
import { Backtest, ModelCard } from "./advanced.jsx";
import { HOME, useApi } from "./ui.jsx";

// Model info (/model): facts about the sentiment model itself, not about any one stock. Ours vs. FinBERT, the full
// benchmark table, and the historical backtest of the signal (pick a stock with cached history).
export function ModelInfo({ onBack }) {
  const h = useApi("health");
  const health = h.data;
  const hist = health?.historical_tickers || (h.loading ? [] : HOME); // wait for the list before asking for a backtest
  const [t, setT] = useState(null);
  const ticker = t || hist[0];
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-12 pt-4 sm:px-6 sm:pt-6" data-testid="model-info">
      <button onClick={onBack} className="-ml-1 mb-5 flex items-center gap-1.5 px-1 py-2 text-sm text-dim hover:text-ink" data-testid="back">
        <span aria-hidden>‹</span> Back to stocks</button>
      <h1 className="font-serif text-[30px] font-medium leading-tight text-ink">Model info</h1>
      <p className="mt-2 text-sm text-dim">How the headline tagger was built and how it scores. The same model tags every stock.</p>
      <div className="mt-8 space-y-6">
        <section className="kd-box p-5" aria-label="Model"><ModelCard /></section>
        <section className="kd-box p-5" aria-label="Backtest">
          <div className="mb-3 flex flex-wrap gap-2 text-xs" role="group" aria-label="Backtest stock">
            {hist.map((x) => (
              <button key={x} onClick={() => setT(x)} aria-pressed={x === ticker}
                className={`border px-2.5 py-1 ${x === ticker ? "border-ink bg-ink text-ground" : "border-line text-ink hover:border-rule"}`}>{x}</button>))}
          </div>
          {ticker && <Backtest key={ticker} ticker={ticker} health={health} />}
        </section>
      </div>
      <footer className="mt-16 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}
