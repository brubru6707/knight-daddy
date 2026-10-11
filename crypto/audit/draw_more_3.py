"""Draw 1,200 more test posts for blind labeling (600 per author tag), excluding the 800 already drawn. sid continues at 800.

Appends to crypto/audit/sample_key.csv and writes crypto/audit/sample_blind_3.csv (no tags).
"""
import os
import pandas as pd

R = os.path.expanduser("~/scratch/poc1/crypto")
OUT = os.path.dirname(os.path.abspath(__file__))
gold = pd.read_parquet(f"{R}/spec/CRYPTO_gold_teacher.parquet")
key = pd.read_csv(f"{OUT}/sample_key.csv")
assert len(key) == 800, "already drawn"
rest = gold[~gold.id.isin(key.id)]
s = pd.concat([rest[rest.label == l].sample(600, random_state=11) for l in ("Bullish", "Bearish")])
s = s.sample(frac=1, random_state=11).reset_index(drop=True)
s.insert(0, "sid", range(800, 800 + len(s)))
s[["sid", "text"]].to_csv(f"{OUT}/sample_blind_3.csv", index=False)
pd.concat([key, s[["sid", "id", "label"]].rename(columns={"label": "tag"})]).to_csv(f"{OUT}/sample_key.csv", index=False)
print(len(s), "drawn; key now", len(key) + len(s))
