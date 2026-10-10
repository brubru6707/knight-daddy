import { dominant, HOME, headlinesPath, NAMES, pct, Pill, toneClass, usd, useApi } from "./ui.jsx";

// One tappable stock row: name on the left; live price, today's change and the dominant headline tone on the right.
// The number is the share PRICE (we have no accounts or holdings). A row with no data at all is hidden.
function Row({ ticker, onOpen }) {
  const p = useApi(`prices?ticker=${ticker}&period=3mo`);
  const h = useApi(headlinesPath(ticker));
  if (p.err && h.err) return null;
  const loading = p.loading || h.loading;
  const tone = h.data ? dominant(h.data.items) : null;
  return (
    <li>
      <button onClick={() => onOpen(ticker)} data-testid="home-row" data-ticker={ticker}
        className="flex w-full items-center gap-4 border-b border-line px-1 py-4 text-left hover:bg-card focus:bg-card focus:outline-none">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-rule font-serif text-[15px] text-ink">{ticker[0]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{ticker}</span>
          <span className="block truncate text-xs text-dim">{NAMES[ticker]?.[0] || "n/a"}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[15px] font-semibold text-ink" data-testid="row-price">{p.data ? usd(p.data.last) : p.loading ? "…" : "n/a"}</span>
          <span className="flex items-center gap-2">
            {!loading && <Pill label={tone} />}
            <span className={`w-16 text-right text-xs ${p.data ? toneClass(p.data.change_1d) : "text-dim"}`} data-testid="row-change">
              {p.data ? pct(p.data.change_1d, 2) : p.loading ? "" : "n/a"}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function Home({ onOpen }) {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-serif text-[30px] font-medium text-ink">Stocks</h1>
      <p className="mt-1 text-xs text-dim">Price and today's change, with the dominant tone of recent headlines.</p>
      <ul className="mt-6 border-t border-rule" aria-label="Stocks">
        {HOME.map((t) => <Row key={t} ticker={t} onOpen={onOpen} />)}
      </ul>
      <footer className="mt-12 border-t border-rule pt-4 text-xs text-dim">News sentiment, not investment advice.</footer>
    </div>
  );
}
