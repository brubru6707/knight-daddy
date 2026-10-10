"""Build specialist pools for extra tickers (big four + niche), same split rules as prep_data.py.

Sources: ~/scratch/poc1/backtest_broad/news_<T>.parquet (AAPL MSFT AMZN TSLA) and ~/scratch/poc1/niche/news_<T>.parquet.
FNSPID dates are day-only (UTC). Rules: train < 2023-07-01 <= test; one headline per template in the test period;
training rows whose template appears in Jul-Dec 2023 are dropped. These tickers have NO hand labels: the "gold" pool is
a random Jul-Dec sample labeled by the 9B teacher, so the panel can only report agreement with the teacher.
Caps (time budget): train 1500, gold 100, held-out 300.
"""
import os, re
import pandas as pd

OUT = "/oscar/scratch/brrodrig/poc1/specialist"
SRC = {**{t: f"~/scratch/poc1/backtest_broad/news_{t}.parquet" for t in ["AAPL", "MSFT", "AMZN", "TSLA"]},
       **{t: f"~/scratch/poc1/niche/news_{t}.parquet" for t in ["CELH", "PTON", "ENPH", "SMCI", "WING"]}}
EXTRA = {"WING": r"\bwingstop\b"}  # "wing" alone matches unrelated text, so WING is re-filtered to "Wingstop" only
SPLIT, SEED, CAP_TRAIN, CAP_GOLD, CAP_HELD = "2023-07-01", 0, 1500, 100, 300


def template(s):
    s = s.lower()
    s = re.sub(r"[$%]?\d[\d,.]*[%kmb]?", "#", s)
    s = re.sub(r"\b(mon|tues|wednes|thurs|fri|satur|sun)day\b", "<day>", s)
    s = re.sub(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", "<mon>", s)
    s = re.sub(r"[^a-z#<> ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


if __name__ == "__main__":
    for t, src in SRC.items():
        df = pd.read_parquet(os.path.expanduser(src)).rename(columns={"date_utc": "date", "Article_title": "text"})
        if t in EXTRA:
            df = df[df.text.str.contains(EXTRA[t], case=False, regex=True)]
        df = df.drop_duplicates("text").copy()
        df["tmpl"] = df.text.map(template)
        test, train = df[df.date >= SPLIT], df[df.date < SPLIT]
        uniq = test.drop_duplicates("tmpl")
        gold = uniq.sample(n=min(CAP_GOLD, len(uniq) // 2), random_state=SEED)
        held = uniq.drop(gold.index)
        held = held.sample(n=min(CAP_HELD, len(held)), random_state=SEED)
        tr = train[~train.tmpl.isin(set(test.tmpl))].drop_duplicates("tmpl")
        n_tr = len(tr)
        tr = tr.sample(n=min(CAP_TRAIN, len(tr)), random_state=SEED)
        cols = ["date", "text", "tmpl"]
        tr[cols].to_parquet(f"{OUT}/{t}_train_pool.parquet")
        held[cols].to_parquet(f"{OUT}/{t}_heldout_pool.parquet")
        gold[cols].assign(id=[f"{t}-{i:03d}" for i in range(1, len(gold) + 1)]).to_parquet(f"{OUT}/{t}_gold_pool.parquet")
        print(f"{t}: {len(df)} unique named headlines; train {len(tr)} (of {n_tr} after template filter), "
              f"gold {len(gold)}, held-out {len(held)}")
