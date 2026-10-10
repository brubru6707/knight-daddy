"""Build the StockTwits crypto test / held-out / training sets (pre-registered in MORNING_REPORT.md).

Input:  ~/scratch/poc1/crypto/raw/elkulako/st-data-full.parquet (ElKulako/stocktwits-crypto; 0 Bearish, 1 untagged, 2 Bullish)
Output: ~/scratch/poc1/crypto/spec/CRYPTO_{gold,heldout,train}_teacher.parquet
        Filenames match what specialist/train_specialist.py expects; the "label" column is the AUTHOR'S tag
        (human), not a teacher model. gold = test set (has id, date columns; date is unknown, set to "").
"""
import os
import pandas as pd

R = os.path.expanduser("~/scratch/poc1/crypto")
SEED, N_TEST, N_HELD = 0, 2000, 500  # per class

df = pd.read_parquet(f"{R}/raw/elkulako/st-data-full.parquet")
n0 = len(df)
df = df[df.label.isin([0, 2])].copy()                      # drop label 1 (untagged)
df["norm"] = df.text.str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
conf = df.groupby("norm").label.nunique()
df = df[~df.norm.isin(conf[conf > 1].index)]               # same text tagged both ways
df = df.drop_duplicates("norm")
df = df[df.norm.str.split().str.len() >= 3]
df["label"] = df.label.map({0: "Bearish", 2: "Bullish"})
print(f"rows {n0} -> tagged, deduped, >=3 words: {len(df)} | {df.label.value_counts().to_dict()}")

df = df.sample(frac=1, random_state=SEED)
parts = {}
for name, n in (("gold", N_TEST), ("heldout", N_HELD)):
    take = pd.concat([df[df.label == l].head(n) for l in ("Bearish", "Bullish")])
    parts[name] = take
    df = df.drop(take.index)
nb = (df.label == "Bearish").sum()
parts["train"] = pd.concat([df[df.label == "Bearish"], df[df.label == "Bullish"].head(nb)]).sample(frac=1, random_state=SEED)

sets = {k: set(v.norm) for k, v in parts.items()}
assert not (sets["gold"] & sets["heldout"]) and not (sets["gold"] & sets["train"]) and not (sets["heldout"] & sets["train"])
for k, v in parts.items():
    out = v[["text", "label"]].reset_index(drop=True)
    if k == "heldout":
        out.insert(0, "date", "")  # train_specialist.py reads a date column from the held-out pool
    if k == "gold":
        out.insert(0, "id", [f"CRYPTO-{i:04d}" for i in range(len(out))]); out.insert(1, "date", "")
    out.to_parquet(f"{R}/spec/CRYPTO_{k}_teacher.parquet")
    print(f"{k:8s} {len(out):6d} | {out.label.value_counts().to_dict()} | median chars {int(out.text.str.len().median())}")
print("overlap between splits: 0 (asserted)")
