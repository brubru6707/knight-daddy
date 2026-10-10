"""Daily long/cash backtest of headline sentiment vs buy-and-hold, random, and cash.

Rules (fixed before looking at any results, not tuned):
- Window: trading days 2022-12-16 .. 2023-12-15 (12 months ending at the FNSPID news cutoff).
- Headlines only have a date (no real time), so a headline dated D (UTC) is treated as
  after-close and can only affect the trade at the OPEN of the first trading day after D.
  For trading day T the signal uses headlines dated in [previous trading day, T).
- Daily score = (#Bullish - #Bearish) / #headlines. Score > +0.2 -> long, < -0.2 -> cash,
  otherwise (or no headlines) keep the current position. Start in cash.
- Trades fill at the open with 0.05% slippage on each buy and each sell. All-in / all-out,
  fractional shares. Equity marked at each close; open positions are not liquidated at the end.
- Random: same number of orders as the sentiment strategy on random days, 100 seeds.
"""
import json, os
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

C = "/oscar/scratch/brrodrig/poc1/backtest"
OUT = os.path.expanduser("~/poc1/backtest")
START, END = "2022-12-16", "2023-12-15"
CAPITAL, SLIP, THRESH, SEEDS = 10_000.0, 0.0005, 0.2, 100


def daily_scores(ticker, days):
    s = pd.read_parquet(f"{C}/sentiment_{ticker}.parquet")
    s["d"] = pd.to_datetime(s.date_utc)
    rows = []
    for i, T in enumerate(days):
        prev = days[i - 1] if i else T - pd.Timedelta(days=1)
        h = s[(s.d >= prev) & (s.d < T)]
        n = len(h)
        score = ((h.label == "Bullish").sum() - (h.label == "Bearish").sum()) / n if n else np.nan
        rows.append((T, n, score))
    return pd.DataFrame(rows, columns=["day", "n_headlines", "score"]).set_index("day")


def simulate(px, target):
    """target[i] in {0,1}: position to hold from the open of day i. Returns equity, orders, trades."""
    cash, sh, eq, orders, trades, entry = CAPITAL, 0.0, [], 0, [], None
    for i, (o, c) in enumerate(zip(px.Open.values, px.Close.values)):
        if target[i] == 1 and sh == 0:
            sh, cash, orders, entry = cash / (o * (1 + SLIP)), 0.0, orders + 1, o * (1 + SLIP)
        elif target[i] == 0 and sh > 0:
            exit_ = o * (1 - SLIP)
            cash, orders = sh * exit_, orders + 1
            trades.append(exit_ / entry - 1); sh = 0.0
        eq.append(cash + sh * c)
    if sh > 0:  # open trade at the end: mark to last close
        trades.append(px.Close.values[-1] / entry - 1)
    return np.array(eq), orders, trades


def stats(eq, orders, trades):
    r = np.diff(np.concatenate([[CAPITAL], eq])) / np.concatenate([[CAPITAL], eq[:-1]])
    dd = (eq / np.maximum.accumulate(np.maximum(eq, CAPITAL)) - 1).min()
    return {"final_value": eq[-1], "total_return": eq[-1] / CAPITAL - 1, "max_drawdown": dd,
            "orders": orders, "round_trips": len(trades),
            "win_rate": (np.mean([t > 0 for t in trades]) if trades else np.nan),
            "sharpe": (r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else np.nan)}


def run(ticker):
    px = pd.read_parquet(f"{C}/prices_{ticker}.parquet").loc[START:END]
    days = list(px.index)
    sc = daily_scores(ticker, days)
    pos, target = 0, []
    for v in sc.score.values:
        if v > THRESH: pos = 1
        elif v < -THRESH: pos = 0
        target.append(pos)
    target = np.array(target)

    res, curves = {}, {}
    eq, o, t = simulate(px, target); res["Sentiment"] = stats(eq, o, t); curves["Sentiment"] = eq
    eq, o, t = simulate(px, np.ones(len(px), int)); res["Buy and hold"] = stats(eq, o, t); curves["Buy and hold"] = eq
    n_orders = res["Sentiment"]["orders"]
    rand_eq, rand_stats = [], []
    for seed in range(SEEDS):  # toggle position on n_orders random days, starting in cash
        rng = np.random.default_rng(seed)
        flips = np.zeros(len(px), int); flips[rng.choice(len(px), n_orders, replace=False)] = 1
        eq, o, t = simulate(px, np.cumsum(flips) % 2)
        rand_eq.append(eq); rand_stats.append(stats(eq, o, t))
    rs = pd.DataFrame(rand_stats)
    res["Random (mean of 100)"] = rs.mean(numeric_only=True).to_dict()
    curves["Random (mean of 100)"] = np.mean(rand_eq, 0)
    res["Cash"] = stats(np.full(len(px), CAPITAL), 0, [])
    res["Cash"]["sharpe"] = np.nan

    # diagnostics: is the signal predictive, or does it describe moves that already happened?
    oo_next = px.Open.shift(-1) / px.Open - 1          # return earned by a position opened at T's open
    prev_day = px.Close.shift(1) / px.Close.shift(2) - 1  # day before the signal's headlines are dated
    same_day = px.Close.shift(1) / px.Open.shift(1) - 1   # previous session's open->close (headline day)
    diag = {"headline_days_used": int((sc.n_headlines > 0).sum()),
            "days_long": int(target.sum()), "trading_days": len(px),
            "corr_score_vs_forward_open_to_open": sc.score.corr(oo_next),
            "corr_score_vs_prev_session_open_to_close": sc.score.corr(same_day),
            "corr_score_vs_prev_session_close_to_close": sc.score.corr(prev_day),
            "random_seeds_beaten_by_sentiment": int((rs.total_return < res["Sentiment"]["total_return"]).sum()),
            "random_return_p5_p95": [rs.total_return.quantile(0.05), rs.total_return.quantile(0.95)]}
    return px, res, curves, np.array(rand_eq), diag


def main():
    COLORS = {"Sentiment": "#2a78d6", "Buy and hold": "#eb6834", "Random (mean of 100)": "#1baf7a", "Cash": "#8a8a85"}
    fig, axes = plt.subplots(2, 1, figsize=(10, 9), sharex=False)
    fig.patch.set_facecolor("#fcfcfb")
    summary = {}
    for ax, ticker in zip(axes, ["NVDA", "DDOG"]):
        px, res, curves, rand_eq, diag = run(ticker)
        summary[ticker] = {"strategies": res, "diagnostics": diag}
        print(f"\n=== {ticker} ===\n" + pd.DataFrame(res).T.to_string(float_format=lambda v: f"{v:,.4f}"))
        print(json.dumps(diag, indent=1, default=float))
        ax.set_facecolor("#fcfcfb")
        lo, hi = np.percentile(rand_eq, 5, 0), np.percentile(rand_eq, 95, 0)
        ax.fill_between(px.index, lo, hi, color=COLORS["Random (mean of 100)"], alpha=0.12, lw=0,
                        label="Random 5th to 95th pct")
        for name, eq in curves.items():
            ax.plot(px.index, eq, color=COLORS[name], lw=2, label=name)
            ax.annotate(f"{name.split(' (')[0]}  ${eq[-1]:,.0f}", (px.index[-1], eq[-1]), xytext=(6, 0),
                        textcoords="offset points", va="center", fontsize=8.5, color="#3d3d3a")
        ax.axhline(CAPITAL, color=COLORS["Cash"], lw=1.5, ls="--", label="Cash")
        ax.set_title(f"{ticker}: $10,000 from {START} to {END}", loc="left", fontsize=11, color="#1f1f1d")
        ax.yaxis.set_major_formatter(matplotlib.ticker.StrMethodFormatter("${x:,.0f}"))
        ax.grid(axis="y", color="#e6e6e3", lw=0.8); ax.set_axisbelow(True)
        for s in ["top", "right"]: ax.spines[s].set_visible(False)
        for s in ["left", "bottom"]: ax.spines[s].set_color("#b5b5b0")
        ax.tick_params(colors="#5c5c58", labelsize=9)
        ax.legend(loc="upper left", fontsize=8.5, frameon=False)
        ax.margins(x=0); ax.set_xlim(px.index[0], px.index[-1] + pd.Timedelta(days=55))
    fig.suptitle("Headline sentiment strategy (Qwen3.5-2B QLoRA) vs baselines", x=0.01, ha="left",
                 fontsize=13, color="#1f1f1d")
    fig.text(0.01, 0.005, "Long when daily (bullish - bearish) headline share > 0.2, cash when < -0.2. "
             "Trades at next open, 0.05% slippage. Shaded: middle 90% of 100 random-timing runs.",
             fontsize=8, color="#5c5c58")
    fig.tight_layout(rect=(0, 0.02, 1, 0.97))
    fig.savefig(f"{OUT}/equity_curves.png", dpi=150, facecolor=fig.get_facecolor())
    json.dump(summary, open(f"{OUT}/results.json", "w"), indent=1, default=float)
    print("\nwrote", f"{OUT}/equity_curves.png", f"{OUT}/results.json")


if __name__ == "__main__":
    main()
