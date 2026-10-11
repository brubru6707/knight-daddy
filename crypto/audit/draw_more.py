"""Draw 600 more test posts for blind labeling (balanced, excluding the first 200). sid continues from 200.

Appends to crypto/audit/sample_key.csv and writes crypto/audit/sample_blind_2.csv (no tags).
"""
import os
import pandas as pd

R = os.path.expanduser("~/scratch/poc1/crypto")
OUT = os.path.dirname(os.path.abspath(__file__))
gold = pd.read_parquet(f"{R}/spec/CRYPTO_gold_teacher.parquet")
key = pd.read_csv(f"{OUT}/sample_key.csv")
assert len(key) == 200, "already drawn"
rest = gold[~gold.id.isin(key.id)]
s = pd.concat([rest[rest.label == l].sample(300, random_state=7) for l in ("Bullish", "Bearish")])
s = s.sample(frac=1, random_state=7).reset_index(drop=True)
s.insert(0, "sid", range(200, 200 + len(s)))
s[["sid", "text"]].to_csv(f"{OUT}/sample_blind_2.csv", index=False)
pd.concat([key, s[["sid", "id", "label"]].rename(columns={"label": "tag"})]).to_csv(f"{OUT}/sample_key.csv", index=False)
print(len(s), "drawn; key now", len(key) + len(s))
