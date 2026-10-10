"""Build per-ticker data for the specialist experiment (no model involved).

Outputs, per ticker:
  ~/poc1/specialist/labeling/<T>_to_label.csv       blind, shuffled rows for hand-labeling (test set)
  ~/scratch/poc1/specialist/<T>_train_pool.parquet  pre-2023-07-01 headlines for 9B teacher labels (training)
  ~/scratch/poc1/specialist/<T>_heldout_pool.parquet Jul-Dec 2023 headlines not sent for hand-labeling
                                                    (teacher-agreement check only, never trained on)
Split rules:
  - time split: train < 2023-07-01 <= test (UTC dates; FNSPID ends 2023-12-16)
  - one headline per template in the test pool; any training headline whose template appears
    anywhere in Jul-Dec 2023 is dropped, so templated headlines cannot leak into the test set
"""
import os, re
import pandas as pd

SRC = "/oscar/scratch/brrodrig/poc1/backtest/news_{}_nasdaq.parquet"
OUT = "/oscar/scratch/brrodrig/poc1/specialist"
LAB = os.path.expanduser("~/poc1/specialist/labeling")
NAMES = {"NVDA": r"\bnvidia\b|\bnvda\b", "DDOG": r"\bdatadog\b|\bddog\b"}
SPLIT, N_LABEL, SEED = "2023-07-01", 120, 0  # 120 rows so ~100 remain after Skip
os.makedirs(OUT, exist_ok=True); os.makedirs(LAB, exist_ok=True)


def template(s):
    s = s.lower()
    s = re.sub(r"[$%]?\d[\d,.]*[%kmb]?", "#", s)      # numbers, prices, percents
    s = re.sub(r"\b(mon|tues|wednes|thurs|fri|satur|sun)day\b", "<day>", s)
    s = re.sub(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", "<mon>", s)
    s = re.sub(r"[^a-z#<> ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


for t, pat in NAMES.items():
    df = pd.read_parquet(SRC.format(t))
    df = df[df.Article_title.str.contains(pat, case=False, regex=True)].copy()
    df["date"] = df.ts.dt.tz_convert("UTC").dt.date.astype(str)
    df["tmpl"] = df.Article_title.map(template)
    df = df.drop_duplicates("Article_title")
    test_period = df[df.date >= SPLIT]
    train_period = df[df.date < SPLIT]

    uniq = test_period.drop_duplicates("tmpl")                 # one per template
    sample = uniq.sample(n=min(N_LABEL, len(uniq)), random_state=SEED)
    heldout = uniq.drop(sample.index)
    lab = pd.DataFrame({"id": [f"{t}-{i:03d}" for i in range(1, len(sample) + 1)],
                        "date": sample.date.values, "headline": sample.Article_title.values, "label": ""})
    lab.to_csv(f"{LAB}/{t}_to_label.csv", index=False)

    leak = set(test_period.tmpl)
    train = train_period[~train_period.tmpl.isin(leak)].drop_duplicates("tmpl")
    cols = ["date", "Article_title", "tmpl"]
    train[cols].rename(columns={"Article_title": "text"}).to_parquet(f"{OUT}/{t}_train_pool.parquet")
    heldout[cols].rename(columns={"Article_title": "text"}).to_parquet(f"{OUT}/{t}_heldout_pool.parquet")
    sample[cols].rename(columns={"Article_title": "text"}).assign(id=lab.id.values).to_parquet(f"{OUT}/{t}_gold_pool.parquet")
    print(f"{t}: Jul-Dec {len(test_period)} headlines -> {len(uniq)} unique templates -> {len(sample)} to label, "
          f"{len(heldout)} held-out; pre-Jul {len(train_period)} -> {len(train)} for training "
          f"(dropped {len(train_period) - len(train)} as template overlap or duplicates)")
