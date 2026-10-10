"""Count company-named FNSPID headlines for niche ticker candidates (one pass over the 21.6 GB CSV).

Output: ~/scratch/poc1/niche/news_<T>.parquet (date_utc, Article_title; name-matched, deduplicated) and
~/poc1/results/niche_candidates.json with counts per window. Name rule is the same as backtest/broaden.py.
"""
import json, os
import pandas as pd

SRC = "/oscar/scratch/brrodrig/poc1/backtest/fnspid/Stock_news/nasdaq_exteral_data.csv"
OUT = os.path.expanduser("~/scratch/poc1/niche")
NAMES = {"CELH": r"\bcelsius\b|\bcelh\b", "UPST": r"\bupstart\b|\bupst\b", "PTON": r"\bpeloton\b|\bpton\b",
         "SOFI": r"\bsofi\b", "AFRM": r"\baffirm holdings\b|\baffirm\b|\bafrm\b", "ROKU": r"\broku\b",
         "ETSY": r"\betsy\b", "ENPH": r"\benphase\b|\benph\b", "HOOD": r"\brobinhood\b", "LCID": r"\blucid\b|\blcid\b",
         "DKNG": r"\bdraftkings\b|\bdkng\b", "CHWY": r"\bchewy\b|\bchwy\b", "ZS": r"\bzscaler\b", "OKTA": r"\bokta\b",
         "PLUG": r"\bplug power\b", "FSLR": r"\bfirst solar\b|\bfslr\b", "MRNA": r"\bmoderna\b|\bmrna\b",
         "TTD": r"\btrade desk\b|\bttd\b", "DOCU": r"\bdocusign\b|\bdocu\b", "RIVN": r"\brivian\b|\brivn\b",
         "LULU": r"\blululemon\b|\blulu\b", "WING": r"\bwingstop\b|\bwing\b", "SMCI": r"\bsuper micro\b|\bsupermicro\b|\bsmci\b",
         "IRBT": r"\birobot\b|\birbt\b", "BYND": r"\bbeyond meat\b|\bbynd\b"}
os.makedirs(OUT, exist_ok=True)
parts = {t: [] for t in NAMES}
for ch in pd.read_csv(SRC, usecols=["Date", "Article_title", "Stock_symbol"], chunksize=500_000, dtype=str):
    ch = ch[ch.Stock_symbol.isin(NAMES)]
    for t in NAMES:
        parts[t].append(ch[ch.Stock_symbol == t])
res = {}
for t, pat in NAMES.items():
    df = pd.concat(parts[t]).dropna(subset=["Date", "Article_title"])
    tagged = len(df)
    df["date_utc"] = pd.to_datetime(df.Date, utc=True).dt.date.astype(str)
    df = df[df.Article_title.str.contains(pat, case=False, regex=True)].drop_duplicates(["Article_title"])
    df[["date_utc", "Article_title"]].to_parquet(f"{OUT}/news_{t}.parquet")
    res[t] = {"fnspid_rows_tagged": tagged, "name_matched_unique": len(df),
              "pre_2023_07": int((df.date_utc < "2023-07-01").sum()),
              "jul_dec_2023": int((df.date_utc >= "2023-07-01").sum()),
              "first": df.date_utc.min() if len(df) else None, "last": df.date_utc.max() if len(df) else None}
    print(t, res[t], flush=True)
json.dump(res, open(os.path.expanduser("~/poc1/results/niche_candidates.json"), "w"), indent=1)
