"""Draw the blind audit sample: 100 Bullish + 100 Bearish author-tagged posts from the crypto test set, shuffled.

Writes crypto/audit/sample_blind.csv (sid, text; no tags) and crypto/audit/sample_key.csv (sid, id, tag).
"""
import os
import pandas as pd

R = os.path.expanduser("~/scratch/poc1/crypto")
OUT = os.path.dirname(os.path.abspath(__file__))
gold = pd.read_parquet(f"{R}/spec/CRYPTO_gold_teacher.parquet")
s = pd.concat([gold[gold.label == l].sample(100, random_state=2026) for l in ("Bullish", "Bearish")])
s = s.sample(frac=1, random_state=2026).reset_index(drop=True)
s.insert(0, "sid", range(len(s)))
s[["sid", "text"]].to_csv(f"{OUT}/sample_blind.csv", index=False)
s[["sid", "id", "label"]].rename(columns={"label": "tag"}).to_csv(f"{OUT}/sample_key.csv", index=False)
print(len(s), s.label.value_counts().to_dict(), "median chars", int(s.text.str.len().median()))
