"""Filter FNSPID All_external.csv to a few tickers; save parquet + coverage per year."""
import sys, pandas as pd
SRC = sys.argv[1] if sys.argv[1:] and sys.argv[1].endswith(".csv") else "/oscar/scratch/brrodrig/poc1/backtest/fnspid/Stock_news/All_external.csv"
OUT = "/oscar/scratch/brrodrig/poc1/backtest/news_{}" + ("_nasdaq" if "nasdaq" in SRC else "") + ".parquet"
tickers = [a for a in sys.argv[1:] if not a.endswith(".csv")] or ["NVDA", "DDOG"]
parts = {t: [] for t in tickers}
for ch in pd.read_csv(SRC, usecols=["Date", "Article_title", "Stock_symbol", "Publisher"], chunksize=500_000, dtype=str):
    ch = ch[ch["Stock_symbol"].isin(tickers)]
    for t in tickers: parts[t].append(ch[ch["Stock_symbol"] == t])
for t in tickers:
    df = pd.concat(parts[t]).dropna(subset=["Date", "Article_title"])
    df["ts"] = pd.to_datetime(df["Date"], utc=True).dt.tz_convert("America/New_York")
    df = df.drop_duplicates(subset=["ts", "Article_title"]).sort_values("ts")
    df[["ts", "Article_title", "Publisher"]].to_parquet(OUT.format(t))
    cov = df.groupby(df["ts"].dt.year).agg(headlines=("Article_title", "size"),
                                          days=("ts", lambda s: s.dt.date.nunique()))
    print(f"== {t}: {len(df)} headlines, {df.ts.min()} -> {df.ts.max()}\n{cov.tail(8).to_string()}")
