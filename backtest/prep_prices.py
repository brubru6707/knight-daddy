"""Cache daily OHLC (split/dividend adjusted) from yfinance to scratch."""
import yfinance as yf
for t in ["NVDA", "DDOG", "SPY"]:
    p = yf.download(t, start="2022-11-01", end="2024-01-10", auto_adjust=True, progress=False)
    p.columns = p.columns.get_level_values(0)
    p.to_parquet(f"/oscar/scratch/brrodrig/poc1/backtest/prices_{t}.parquet")
    print(t, len(p), p.index.min().date(), p.index.max().date(), "NaNs:", int(p.isna().sum().sum()))
