"""Build the 3-class crypto split from the 2,000 Claude blind labels, and check near-duplicates across splits.

Labels: crypto/audit/blind_labels.txt (U Bullish, D Bearish, N Neutral), text only, author tag never shown.
Split (stratified by label, seed 0): test 400 / probe 100 / train 1,500. Headline test set: crypto/headlines/headlines_test.csv.
Near-duplicates: exact (normalized), template (numbers masked), or char 3-5gram TF-IDF cosine >= 0.8.
Any train/probe post that is a near-duplicate of a test post or headline is dropped (test sets are never changed).
Output: ~/scratch/poc1/crypto/spec3/CRYPTO3_{train,heldout,gold}_teacher.parquet (names train_specialist.py expects;
"label" = Claude's label, not a teacher model), plus crypto/results_3class/split_check.json.
"""
import json, os, re
import numpy as np, pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split

C = os.path.dirname(os.path.abspath(__file__))
R = os.path.expanduser("~/scratch/poc1/crypto")
OUT = f"{R}/spec3"; RES = f"{C}/results_3class"
os.makedirs(OUT, exist_ok=True); os.makedirs(RES, exist_ok=True)
SEED, THR = 0, 0.8

lab = pd.read_csv(f"{C}/audit/blind_labels.txt", sep=" ", comment="#", names=["sid", "h"])
key = pd.read_csv(f"{C}/audit/sample_key.csv").merge(lab, on="sid")
gold4k = pd.read_parquet(f"{R}/spec/CRYPTO_gold_teacher.parquet").set_index("id")
df = key.assign(text=gold4k.loc[key.id].text.to_numpy(), label=key.h.map({"U": "Bullish", "D": "Bearish", "N": "Neutral"}))
assert len(df) == 2000 and df.label.notna().all() and df.id.is_unique
heads = pd.read_csv(f"{C}/headlines/headlines_test.csv")

rest, test = train_test_split(df, test_size=400, stratify=df.label, random_state=SEED)
train, probe = train_test_split(rest, test_size=100, stratify=rest.label, random_state=SEED)

norm = lambda s: re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", str(s).lower())).strip()
tmpl = lambda s: re.sub(r"\d+([.,]\d+)*", "#", norm(s))
vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=1).fit(pd.concat([df.text, heads.text]).map(norm))


def near(a, b):
    """Boolean per row of a: near-duplicate of any row of b; plus the pairs found."""
    sim = (vec.transform(a.text.map(norm)) @ vec.transform(b.text.map(norm)).T).toarray()
    ex = a.text.map(norm).isin(set(b.text.map(norm))).to_numpy()
    tp = a.text.map(tmpl).isin(set(b.text.map(tmpl))).to_numpy()
    hit = ex | tp | (sim.max(1) >= THR)
    pairs = [(a.text.iloc[i], b.text.iloc[int(sim[i].argmax())], round(float(sim[i].max()), 3)) for i in np.where(hit)[0]]
    return hit, pairs


check = {"threshold_cosine": THR}
tests = pd.concat([test[["text"]], heads[["text"]]])
for name, part in (("train", train), ("probe", probe)):
    hit, pairs = near(part, tests)
    check[f"{name}_near_dup_of_test_or_headlines_dropped"] = int(hit.sum())
    check[f"{name}_examples"] = pairs[:10]
    if name == "train": train = train[~hit]
    else: probe = probe[~hit]
hit, pairs = near(train, probe); check["train_near_dup_of_probe_dropped"] = int(hit.sum()); train = train[~hit]
hit, pairs = near(heads, test); check["headlines_near_dup_of_post_test"] = int(hit.sum())
sim = (vec.transform(test.text.map(norm)) @ vec.transform(test.text.map(norm)).T).toarray(); np.fill_diagonal(sim, 0)
check["post_test_internal_pairs_ge_thr"] = int((np.triu(sim) >= THR).sum())
sim = (vec.transform(heads.text.map(norm)) @ vec.transform(heads.text.map(norm)).T).toarray(); np.fill_diagonal(sim, 0)
check["headline_internal_pairs_ge_thr"] = int((np.triu(sim) >= THR).sum())

for name, part in (("train", train), ("heldout", probe), ("gold", test)):
    out = part[["text", "label"]].reset_index(drop=True)
    if name == "heldout":
        out.insert(0, "date", "")
    if name == "gold":
        out.insert(0, "id", part.id.to_numpy()); out.insert(1, "date", "")
    out.to_parquet(f"{OUT}/CRYPTO3_{name}_teacher.parquet")
    check[f"{name}_n"] = len(out); check[f"{name}_labels"] = out.label.value_counts().to_dict()
check["headlines_n"] = len(heads); check["headlines_labels"] = heads.label.value_counts().to_dict()
json.dump(check, open(f"{RES}/split_check.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(check, indent=1, ensure_ascii=False))
