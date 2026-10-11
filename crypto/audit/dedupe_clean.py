"""Leakage check for the clean test set vs the crypto training pool: exact and template (numbers masked) overlap.

Also re-scores the models on the clean set with template-overlapping posts removed. Writes dedupe_clean.json.
"""
import json, os, re
import numpy as np, pandas as pd

D = os.path.dirname(os.path.abspath(__file__))
R = os.path.expanduser("~/scratch/poc1/crypto")
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", s.lower())).strip()
tmpl = lambda s: re.sub(r"\d+([.,]\d+)*", "#", norm(s))
lab = pd.read_csv(f"{D}/blind_labels.txt", sep=" ", comment="#", names=["sid", "hand"])
lab["hand"] = lab.hand.map({"U": "Bullish", "D": "Bearish", "N": "None"})
key = pd.read_csv(f"{D}/sample_key.csv").merge(lab, on="sid")
gold = pd.read_parquet(f"{R}/spec/CRYPTO_gold_teacher.parquet").set_index("id")
clean = key[key.hand == key.tag].assign(text=lambda d: gold.loc[d.id].text.to_numpy())
tr = pd.read_parquet(f"{R}/spec/CRYPTO_train_teacher.parquet")
he = pd.read_parquet(f"{R}/spec/CRYPTO_heldout_teacher.parquet")
pool_n = set(tr.text.map(norm)) | set(he.text.map(norm)); pool_t = set(tr.text.map(tmpl)) | set(he.text.map(tmpl))
clean["exact"] = clean.text.map(norm).isin(pool_n); clean["template"] = clean.text.map(tmpl).isin(pool_t)
run = open(f"{R}/runs_latest.txt").read().strip()
g = pd.read_parquet(f"{run}/preds_gold.parquet").set_index("id")
fb = pd.read_parquet(f"{R}/gate_preds.parquet").set_index("id")
keep = clean[~clean.template]; y = (keep.tag == "Bullish").to_numpy()
acc = {k: round(float(((np.asarray(b) > np.asarray(a)) == y).mean()), 4) for k, (a, b) in {
    "general_2b": (g.loc[keep.id].general_p_bear, g.loc[keep.id].general_p_bull),
    "specialist_600": (g.loc[keep.id].specialist_p_bear, g.loc[keep.id].specialist_p_bull),
    "finbert": (fb.loc[keep.id].f_p_bear, fb.loc[keep.id].f_p_bull)}.items()}
res = {"clean_n": int(len(clean)), "exact_overlap_with_train_or_heldout": int(clean.exact.sum()),
       "template_overlap_with_train_or_heldout": int(clean.template.sum()),
       "duplicate_texts_within_clean": int(clean.text.map(norm).duplicated().sum()),
       "template_overlap_examples": clean[clean.template].text.head(10).tolist(),
       "accuracy_after_dropping_template_overlaps": {"n": int(len(keep)), **acc}}
json.dump(res, open(f"{D}/dedupe_clean.json", "w"), indent=1)
print(json.dumps(res, indent=1))
