"""Quick data-audit statistics (sizes, balance, duplicates, leakage, dates) -> results/data_audit_stats.json and
audit/samples_*.csv (20 random examples per class, seed 0, for label-quality review)."""
import json, os, re, glob
import pandas as pd
from datasets import load_dataset

R, OUT = os.path.expanduser("~/poc1/results"), os.path.expanduser("~/poc1/audit")
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", str(s).lower())).strip()
tmpl = lambda s: re.sub(r"[^a-z# ]+", " ", re.sub(r"[$%]?\d[\d,.]*[%kmb]?", "#", norm(s))).strip()
res = {}
ds = load_dataset("zeroshot/twitter-financial-news-sentiment")
tr, va = ds["train"].to_pandas(), ds["validation"].to_pandas()
names = {0: "Bearish", 1: "Bullish", 2: "Neutral"}
for d in (tr, va):
    d["n"] = d.text.map(norm); d["t"] = d.text.map(tmpl); d["lab"] = d.label.map(names)
conf = pd.concat([tr, va]).groupby("n").label.nunique()
res["tweets"] = {"train": len(tr), "validation": len(va),
                 "train_balance": tr.lab.value_counts().to_dict(), "val_balance": va.lab.value_counts().to_dict(),
                 "train_exact_dup_rows": int(tr.n.duplicated().sum()), "val_exact_dup_rows": int(va.n.duplicated().sum()),
                 "val_rows_with_exact_text_in_train": int(va.n.isin(set(tr.n)).sum()),
                 "val_rows_with_template_in_train": int(va.t.isin(set(tr.t)).sum()),
                 "texts_with_conflicting_labels": int((conf > 1).sum())}
pd.concat([va[va.lab == l].sample(20, random_state=0) for l in names.values()])[["lab", "text"]].to_csv(f"{OUT}/samples_tweets_val.csv", index=False)
S = os.path.expanduser("~/scratch/poc1/specialist")
tch = {}
for f in sorted(glob.glob(f"{S}/*_teacher.parquet")):
    d = pd.read_parquet(f); k = os.path.basename(f).replace("_teacher.parquet", "")
    tch[k] = {"n": len(d), "balance": d.label.value_counts().to_dict(),
              "dates": [str(d.date.min()), str(d.date.max())] if "date" in d and len(d) else None,
              "dup_text": int(d.text.map(norm).duplicated().sum())}
res["teacher"] = tch
for t in ["NVDA", "DDOG"]:
    a, g = pd.read_parquet(f"{S}/{t}_train_teacher.parquet"), pd.read_parquet(f"{S}/{t}_gold_teacher.parquet")
    res["teacher"][f"{t}_train_vs_gold"] = {"exact_overlap": int(g.text.map(norm).isin(set(a.text.map(norm))).sum()),
                                            "template_overlap": int(g.text.map(tmpl).isin(set(a.text.map(tmpl))).sum())}
all_t = pd.concat([pd.read_parquet(f) for f in glob.glob(f"{S}/*_train_teacher.parquet")])
pd.concat([all_t[all_t.label == l].sample(20, random_state=0) for l in names.values()])[["label", "text"]].to_csv(f"{OUT}/samples_teacher.csv", index=False)
C = os.path.expanduser("~/scratch/poc1/crypto/spec")
cr = {k: pd.read_parquet(f"{C}/CRYPTO_{k}_teacher.parquet") for k in ("train", "heldout", "gold")}
res["crypto"] = {k: {"n": len(v), "balance": v.label.value_counts().to_dict()} for k, v in cr.items()}
res["crypto"]["gold_template_in_train"] = int(cr["gold"].text.map(tmpl).isin(set(cr["train"].text.map(tmpl))).sum())
pd.concat([cr["gold"][cr["gold"].label == l].sample(20, random_state=0) for l in ("Bearish", "Bullish")])[["label", "text"]].to_csv(f"{OUT}/samples_crypto.csv", index=False)
B = os.path.expanduser("~/scratch/poc1/backtest_broad")
fn = {}
for f in sorted(glob.glob(f"{B}/news_*.parquet")):
    d = pd.read_parquet(f); t = os.path.basename(f)[5:-8]
    fn[t] = {"n": len(d), "dates": [d.date_utc.min(), d.date_utc.max()],
             "in_backtest_2023": int(((d.date_utc >= "2022-12-16") & (d.date_utc <= "2023-12-15")).sum()),
             "specialist_train_period_overlapping_backtest_2023": int(((d.date_utc >= "2022-12-16") & (d.date_utc < "2023-07-01")).sum())}
res["fnspid"] = fn
json.dump(res, open(f"{R}/data_audit_stats.json", "w"), indent=1, default=str)
print(json.dumps(res, indent=0, default=str)[:3500])
