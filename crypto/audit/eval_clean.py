"""Re-score saved predictions (general 2B, earlier crypto specialist, FinBERT) on the double-annotated clean test set.

Clean set = audit posts where the blind hand label equals the author's tag (two independent annotators agree).
Same metrics as crypto/eval_crypto.py: binary accuracy and macro F1 with 95% bootstrap CIs, paired bootstrap diffs,
exact McNemar. Also reports each model on the posts that have NO textual stance (where the tag is unrecoverable).
No GPU: reads ~/scratch/poc1/crypto/runs/<run>/preds_gold.parquet and gate_preds.parquet. Writes clean_eval.json.
"""
import json, os
from math import comb
import numpy as np, pandas as pd
from sklearn.metrics import f1_score

D = os.path.dirname(os.path.abspath(__file__))
R = os.path.expanduser("~/scratch/poc1/crypto")
MAP = {"U": "Bullish", "D": "Bearish", "N": "None"}
lab = pd.read_csv(f"{D}/blind_labels.txt", sep=" ", comment="#", names=["sid", "hand"]); lab["hand"] = lab.hand.map(MAP)
key = pd.read_csv(f"{D}/sample_key.csv").merge(lab, on="sid")
run = open(f"{R}/runs_latest.txt").read().strip()
g = pd.read_parquet(f"{run}/preds_gold.parquet").set_index("id")
fb = pd.read_parquet(f"{R}/gate_preds.parquet").set_index("id")
assert (g.loc[key.id].teacher_label.to_numpy() == key.tag.to_numpy()).all()


def probs(ids):
    return {"general_2b": (g.loc[ids].general_p_bear, g.loc[ids].general_p_bull),
            "specialist_600": (g.loc[ids].specialist_p_bear, g.loc[ids].specialist_p_bull),
            "finbert": (fb.loc[ids].f_p_bear, fb.loc[ids].f_p_bull)}


def ci(x):
    return [round(float(np.percentile(x, 2.5)), 4), round(float(np.percentile(x, 97.5)), 4)]


def mcnemar(a, b):
    bo, ao = int(np.sum(~a & b)), int(np.sum(a & ~b)); n = ao + bo
    return {"b_right_a_wrong": bo, "a_right_b_wrong": ao,
            "p": 1.0 if n == 0 else min(1.0, 2 * sum(comb(n, i) for i in range(min(ao, bo) + 1)) / 2 ** n)}


def score(sub, name):
    y = (sub.tag == "Bullish").astype(int).to_numpy()
    rng = np.random.default_rng(0); IDX = rng.integers(0, len(y), size=(2000, len(y)))
    out, right = {"set": name, "n": int(len(y)), "n_bullish": int(y.sum()), "n_bearish": int(len(y) - y.sum())}, {}
    for k, (a, b) in probs(sub.id).items():
        pred = (np.asarray(b) > np.asarray(a)).astype(int); right[k] = pred == y
        f1b = [f1_score(y[i], pred[i], average="macro") for i in IDX[:1000]]
        out[k] = {"binary_accuracy": round(float(right[k].mean()), 4), "binary_accuracy_ci95": ci(right[k][IDX].mean(1)),
                  "binary_macro_f1": round(float(f1_score(y, pred, average="macro")), 4), "binary_macro_f1_ci95": ci(f1b),
                  "f1_bearish": round(float(f1_score(y, pred, pos_label=0)), 4), "f1_bullish": round(float(f1_score(y, pred, pos_label=1)), 4)}
    for o in ("general_2b", "finbert"):
        d = right["specialist_600"][IDX].mean(1) - right[o][IDX].mean(1); lo, hi = ci(d)
        out[f"specialist_600_vs_{o}"] = {"accuracy_diff": round(float(right["specialist_600"].mean() - right[o].mean()), 4),
                                         "accuracy_diff_ci95": [lo, hi], "mcnemar": mcnemar(right[o], right["specialist_600"]),
                                         "verdict": "better" if lo > 0 else "worse" if hi < 0 else "no clear difference"}
    return out


clean = key[key.hand == key.tag]
res = {"run": os.path.basename(run),
       "clean": score(clean, "double-annotated: blind hand label == author tag"),
       "no_stance": score(key[key.hand == "None"], "text has no stance (tag not recoverable from text; chance = 0.5)"),
       "all_audited": score(key, "all 800 audited posts, author tags (same as the original noisy metric)")}
json.dump(res, open(f"{D}/clean_eval.json", "w"), indent=1)
for s in ("clean", "no_stance", "all_audited"):
    r = res[s]; print(f"\n== {s}: n={r['n']} (bull {r['n_bullish']}, bear {r['n_bearish']})")
    for k in ("general_2b", "specialist_600", "finbert"):
        m = r[k]; print(f"  {k:15s} acc {m['binary_accuracy']:.3f} {m['binary_accuracy_ci95']}  macroF1 {m['binary_macro_f1']:.3f} {m['binary_macro_f1_ci95']}")
    for o in ("general_2b", "finbert"):
        c = r[f"specialist_600_vs_{o}"]; print(f"  spec vs {o}: {c['accuracy_diff']*100:+.1f} pts {[round(x*100,1) for x in c['accuracy_diff_ci95']]} McNemar p={c['mcnemar']['p']:.2g} -> {c['verdict']}")
