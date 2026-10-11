"""CPU: benchmark the 3-class crypto adapter vs the general 2B vs FinBERT, and apply the pre-registered decision rule.

Metrics per test set: 3-class accuracy and macro F1 with 95% bootstrap CIs (2,000 resamples, shared across models),
paired accuracy difference CIs, exact McNemar. All labels are Claude's labels (needs human spot-check).
Decision rule (fixed before training): prepare a worker change only if crypto3 beats general on the HEADLINE test set
with the accuracy-difference CI excluding 0. The rule is applied only once the headline set has >= 150 rows.
Writes crypto/results_3class/benchmark.json.
"""
import json, os
from math import comb
import numpy as np, pandas as pd
from sklearn.metrics import f1_score

C = os.path.dirname(os.path.abspath(__file__))
S = os.path.expanduser("~/scratch/poc1/crypto/spec3")
M = {"crypto3": "Qwen3.5-2B crypto 3-class (new)", "general": "Qwen3.5-2B general", "finbert": "FinBERT (zero-shot)"}
L = ["Bearish", "Bullish", "Neutral"]
MIN_HEADLINES = 150


def ci(x):
    return [round(float(np.percentile(x, 2.5)), 4), round(float(np.percentile(x, 97.5)), 4)]


def mcnemar(a, b):
    bo, ao = int(np.sum(~a & b)), int(np.sum(a & ~b)); n = ao + bo
    return {"new_right_other_wrong": bo, "other_right_new_wrong": ao,
            "p": 1.0 if n == 0 else min(1.0, 2 * sum(comb(n, i) for i in range(min(ao, bo) + 1)) / 2 ** n)}


def bench(df):
    y = df.label.to_numpy()
    IDX = np.random.default_rng(0).integers(0, len(y), size=(2000, len(y)))
    res, right = {"n": int(len(y)), "labels": df.label.value_counts().to_dict()}, {}
    for k in M:
        p = df[f"{k}_label"].to_numpy(); right[k] = p == y
        f1b = [f1_score(y[i], p[i], labels=L, average="macro", zero_division=0) for i in IDX[:1000]]
        res[k] = {"name": M[k], "accuracy": round(float(right[k].mean()), 4), "accuracy_ci95": ci(right[k][IDX].mean(1)),
                  "macro_f1": round(float(f1_score(y, p, labels=L, average="macro", zero_division=0)), 4), "macro_f1_ci95": ci(f1b),
                  "f1_per_class": dict(zip(L, [round(float(v), 4) for v in f1_score(y, p, labels=L, average=None, zero_division=0)])),
                  "predicted_neutral_rate": round(float((p == "Neutral").mean()), 4)}
    for o in ("general", "finbert"):
        d = right["crypto3"][IDX].mean(1) - right[o][IDX].mean(1); lo, hi = ci(d)
        res[f"crypto3_vs_{o}"] = {"accuracy_diff": round(float(right["crypto3"].mean() - right[o].mean()), 4),
                                  "accuracy_diff_ci95": [lo, hi], "mcnemar": mcnemar(right[o], right["crypto3"]),
                                  "verdict": "better" if lo > 0 else "worse" if hi < 0 else "no clear difference"}
    return res


out = {"label_source": "Claude-labeled, needs human spot-check", "sets": {}}
for k in ("posts", "headlines"):
    f = f"{S}/preds_{k}.parquet"
    if os.path.exists(f):
        out["sets"][k] = bench(pd.read_parquet(f))
h = out["sets"].get("headlines")
if h is None or h["n"] < MIN_HEADLINES:
    out["decision"] = {"applied": False, "reason": f"headline set has {h['n'] if h else 0} rows; rule needs >= {MIN_HEADLINES}"}
else:
    c = h["crypto3_vs_general"]
    out["decision"] = {"applied": True, "headline_diff_ci95": c["accuracy_diff_ci95"], "passes": c["accuracy_diff_ci95"][0] > 0,
                       "action": "prepare (not deploy) worker change" if c["accuracy_diff_ci95"][0] > 0 else "negative result: stop"}
os.makedirs(f"{C}/results_3class", exist_ok=True)
json.dump(out, open(f"{C}/results_3class/benchmark.json", "w"), indent=1)
for k, r in out["sets"].items():
    print(f"\n== {k} (n={r['n']}) {r['labels']}   [Claude-labeled, needs human spot-check]")
    for m in M:
        x = r[m]; print(f"  {x['name']:34s} acc {x['accuracy']:.3f} {x['accuracy_ci95']}  macroF1 {x['macro_f1']:.3f} {x['macro_f1_ci95']}  neutral rate {x['predicted_neutral_rate']:.2f}")
    for o in ("general", "finbert"):
        c = r[f"crypto3_vs_{o}"]; print(f"  crypto3 vs {o}: {c['accuracy_diff']*100:+.1f} pts {[round(v*100, 1) for v in c['accuracy_diff_ci95']]} McNemar p={c['mcnemar']['p']:.2g} -> {c['verdict']}")
print("\nDECISION:", out["decision"])
