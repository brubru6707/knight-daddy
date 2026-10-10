"""Broadened backtest: same strategy and rules as backtest.py, more tickers and one more year.

Outputs go to ~/scratch/poc1/backtest_broad/ (NOT the dashboard's backtest cache, so the dashboard is unaffected).
  python broaden.py prep       # scan FNSPID once for all tickers (CPU, ~5 min), fetch prices
  python broaden.py classify   # tag name-matched headlines with the general 2B adapter (GPU)
  python broaden.py run        # backtest every ticker x window, write results/backtest_broad.json
Rules (identical to backtest.py): a headline dated D (UTC) trades at the next open after D; daily score =
(bull - bear) / headlines; long if > +0.2, cash if < -0.2, else hold; 0.05% slippage per side; random baseline =
same number of orders on random days, 100 seeds.
"""
import json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backtest as bt  # noqa: E402  (reuse simulate/stats and constants; module has no side effects on import)

OUT = os.path.expanduser("~/scratch/poc1/backtest_broad")
SRC = "/oscar/scratch/brrodrig/poc1/backtest/fnspid/Stock_news/nasdaq_exteral_data.csv"
NAMES = {"NVDA": r"\bnvidia\b|\bnvda\b", "DDOG": r"\bdatadog\b|\bddog\b", "AAPL": r"\bapple\b|\baapl\b",
         "MSFT": r"\bmicrosoft\b|\bmsft\b", "AMZN": r"\bamazon\b|\bamzn\b", "TSLA": r"\btesla\b|\btsla\b"}
WINDOWS = {"2023": ("2022-12-16", "2023-12-15"), "2022": ("2021-12-16", "2022-12-15")}
os.makedirs(OUT, exist_ok=True)


def prep():
    parts = {t: [] for t in NAMES}
    for ch in pd.read_csv(SRC, usecols=["Date", "Article_title", "Stock_symbol"], chunksize=500_000, dtype=str):
        ch = ch[ch.Stock_symbol.isin(NAMES)]
        for t in NAMES:
            parts[t].append(ch[ch.Stock_symbol == t])
    for t, pat in NAMES.items():
        df = pd.concat(parts[t]).dropna(subset=["Date", "Article_title"])
        df["date_utc"] = pd.to_datetime(df.Date, utc=True).dt.date.astype(str)
        df = df[df.Article_title.str.contains(pat, case=False, regex=True)].drop_duplicates(["date_utc", "Article_title"])
        df[["date_utc", "Article_title"]].to_parquet(f"{OUT}/news_{t}.parquet")
        cov = {w: int(df[(df.date_utc >= s) & (df.date_utc < e)].date_utc.nunique()) for w, (s, e) in WINDOWS.items()}
        print(f"{t}: {len(df)} name-matched headlines; headline days per window {cov}")
    import yfinance as yf
    for t in NAMES:
        p = yf.download(t, start="2021-11-01", end="2024-01-10", auto_adjust=True, progress=False)
        p.columns = p.columns.get_level_values(0)
        p.to_parquet(f"{OUT}/prices_{t}.parquet")
        print(f"prices {t}: {len(p)} days, NaNs {int(p.isna().sum().sum())}")


def classify():
    sys.path.insert(0, os.path.join(HERE, "..", "terminal", "backend"))
    from classifier import SentimentModel
    m = SentimentModel(os.path.expanduser("~/poc1/adapters/qwen35-2b"))
    for t in NAMES:
        df = pd.read_parquet(f"{OUT}/news_{t}.parquet")
        df = df[(df.date_utc >= "2021-12-15") & (df.date_utc <= "2023-12-14")].reset_index(drop=True)
        res = m.classify(df.Article_title.tolist(), bs=32)
        df["label"] = [r["label"] for r in res]
        df.to_parquet(f"{OUT}/sentiment_{t}.parquet")
        print(f"{t}: {len(df)} headlines tagged, {df.label.value_counts().to_dict()}")


def daily_scores(s, days):
    rows = []
    for i, T in enumerate(days):
        prev = days[i - 1] if i else T - pd.Timedelta(days=1)
        h = s[(s.d >= prev) & (s.d < T)]
        n = len(h)
        rows.append((T, n, ((h.label == "Bullish").sum() - (h.label == "Bearish").sum()) / n if n else np.nan))
    return pd.DataFrame(rows, columns=["day", "n", "score"]).set_index("day")


def run():
    out = []
    for t in NAMES:
        s = pd.read_parquet(f"{OUT}/sentiment_{t}.parquet"); s["d"] = pd.to_datetime(s.date_utc)
        allpx = pd.read_parquet(f"{OUT}/prices_{t}.parquet")
        for w, (start, end) in WINDOWS.items():
            px = allpx.loc[start:end]
            sc = daily_scores(s, list(px.index))
            if (sc.n > 0).sum() < 100:  # same coverage rule as the original backtest
                out.append({"ticker": t, "window": w, "excluded": f"only {int((sc.n > 0).sum())} headline days (< 100)"})
                print(f"EXCLUDED {t} {w}: only {int((sc.n > 0).sum())} headline days")
                continue
            pos, target = 0, []
            for v in sc.score.values:
                pos = 1 if v > bt.THRESH else 0 if v < -bt.THRESH else pos
                target.append(pos)
            target = np.array(target)
            eq, o, tr = bt.simulate(px, target); sent = bt.stats(eq, o, tr)
            eq, o, tr = bt.simulate(px, np.ones(len(px), int)); bh = bt.stats(eq, o, tr)
            rnd = []
            for seed in range(bt.SEEDS):
                flips = np.zeros(len(px), int)
                flips[np.random.default_rng(seed).choice(len(px), sent["orders"], replace=False)] = 1
                eq, o, tr = bt.simulate(px, np.cumsum(flips) % 2); rnd.append(bt.stats(eq, o, tr)["total_return"])
            rnd = np.array(rnd)
            prev_ret = px.Close.shift(1) / px.Close.shift(2) - 1
            fwd_ret = px.Open.shift(-1) / px.Open - 1
            out.append({"ticker": t, "window": w, "start": start, "end": end, "trading_days": len(px),
                        "headline_days": int((sc.n > 0).sum()), "days_long": int(target.sum()), "orders": int(sent["orders"]),
                        "sentiment_return": sent["total_return"], "buy_hold_return": bh["total_return"],
                        "random_mean_return": float(rnd.mean()), "random_seeds_beaten": int((rnd < sent["total_return"]).sum()),
                        "sentiment_sharpe": sent["sharpe"], "buy_hold_sharpe": bh["sharpe"],
                        "corr_prev_session": float(sc.score.corr(prev_ret)), "corr_next_open_to_open": float(sc.score.corr(fwd_ret))})
    json.dump(out, open(os.path.expanduser("~/poc1/results/backtest_broad.json"), "w"), indent=1, default=float)
    df = pd.DataFrame([r for r in out if "excluded" not in r])
    pd.set_option("display.width", 200)
    print(df[["ticker", "window", "headline_days", "orders", "sentiment_return", "buy_hold_return", "random_mean_return",
              "random_seeds_beaten", "corr_prev_session", "corr_next_open_to_open"]].round(3).to_string(index=False))


if __name__ == "__main__":
    {"prep": prep, "classify": classify, "run": run}[sys.argv[1]]()
