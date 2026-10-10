"""Pre-registered eval: general 2B vs crypto specialist vs FinBERT on the StockTwits test set (4,000 balanced, author tags).

Primary: binary Bullish vs Bearish from P(Bullish) vs P(Bearish). Secondary: 3-way argmax with Neutral counted wrong.
95% paired bootstrap CIs (same resamples for every model), exact McNemar. Verdict rule fixed in advance:
"better"/"worse" only if the CI of the accuracy difference excludes 0. Writes ~/poc1/results/crypto_specialist.json.
"""
import json, os, sys
from math import comb
import numpy as np, pandas as pd
from sklearn.metrics import f1_score

R = os.path.expanduser("~/scratch/poc1/crypto")
run = sys.argv[1] if len(sys.argv) > 1 else open(f"{R}/runs_latest.txt").read().strip()
g = pd.read_parquet(f"{run}/preds_gold.parquet")
fb = pd.read_parquet(f"{R}/gate_preds.parquet").set_index("id").loc[g.id]
y = (g.teacher_label == "Bullish").astype(int).to_numpy()   # "teacher_label" here = author's tag (human)
P = {"general_2b": (g.general_p_bear, g.general_p_bull, g.general_p_neut),
     "specialist": (g.specialist_p_bear, g.specialist_p_bull, g.specialist_p_neut),
     "finbert": (fb.f_p_bear, fb.f_p_bull, fb.f_p_neut)}
names = {"general_2b": "Qwen3.5-2B general (before)", "specialist": "Qwen3.5-2B crypto specialist (after)", "finbert": "FinBERT (zero-shot)"}
rng = np.random.default_rng(0)
IDX = rng.integers(0, len(y), size=(2000, len(y)))
pred2 = {k: (np.asarray(b) > np.asarray(a)).astype(int) for k, (a, b, n) in P.items()}
right = {k: v == y for k, v in pred2.items()}


def ci(x):
    return [float(np.percentile(x, 2.5)), float(np.percentile(x, 97.5))]


def mcnemar(a_right, b_right):
    b_only = int(np.sum(~a_right & b_right)); a_only = int(np.sum(a_right & ~b_right)); n = a_only + b_only
    p = 1.0 if n == 0 else min(1.0, 2 * sum(comb(n, i) for i in range(min(a_only, b_only) + 1)) / 2 ** n)
    return {"b_right_a_wrong": b_only, "a_right_b_wrong": a_only, "p": p}


models = {}
for k, (a, b, n) in P.items():
    a, b, n = map(np.asarray, (a, b, n))
    three = np.where((n > a) & (n > b), -1, pred2[k])
    f1b = [f1_score(y[i], pred2[k][i], average="macro") for i in IDX[:500]]
    models[k] = {"name": names[k], "n": int(len(y)),
                 "binary_accuracy": float(right[k].mean()), "binary_accuracy_ci95": ci(right[k][IDX].mean(1)),
                 "binary_macro_f1": float(f1_score(y, pred2[k], average="macro")), "binary_macro_f1_ci95": ci(f1b),
                 "f1_bearish": float(f1_score(y, pred2[k], pos_label=0)), "f1_bullish": float(f1_score(y, pred2[k], pos_label=1)),
                 "three_way_accuracy_neutral_wrong": float((three == y).mean()), "neutral_rate": float((three == -1).mean())}
comp = {}
for other in ("general_2b", "finbert"):
    d = right["specialist"][IDX].mean(1) - right[other][IDX].mean(1)
    lo, hi = ci(d)
    comp[f"specialist_vs_{other}"] = {"accuracy_diff": float(right["specialist"].mean() - right[other].mean()),
                                      "accuracy_diff_ci95": [lo, hi], "mcnemar": mcnemar(right[other], right["specialist"]),
                                      "verdict": "better" if lo > 0 else "worse" if hi < 0 else "no clear difference"}
res = {"test_set": "ElKulako/stocktwits-crypto, 4,000 balanced author-tagged posts (random split, no dates)",
       "run": os.path.basename(run), "models": models, "comparisons": comp,
       "note": "Reads crypto posts; not a trading signal. Labels are the author's stance tag, not a text-tone rating."}
json.dump(res, open(os.path.expanduser("~/poc1/results/crypto_specialist.json"), "w"), indent=1)
for k, m in models.items():
    print(f"{m['name']:38s} binary acc {m['binary_accuracy']:.4f} [{m['binary_accuracy_ci95'][0]:.3f}, {m['binary_accuracy_ci95'][1]:.3f}]"
          f"  macroF1 {m['binary_macro_f1']:.4f}  F1 bear {m['f1_bearish']:.3f} bull {m['f1_bullish']:.3f}"
          f" | 3-way {m['three_way_accuracy_neutral_wrong']:.3f}, neutral {m['neutral_rate']:.3f}")
for k, c in comp.items():
    print(f"{k}: diff {c['accuracy_diff']*100:+.1f} pts, CI [{c['accuracy_diff_ci95'][0]*100:+.1f}, {c['accuracy_diff_ci95'][1]*100:+.1f}],"
          f" McNemar p={c['mcnemar']['p']:.2e} ({c['mcnemar']['b_right_a_wrong']} fixed / {c['mcnemar']['a_right_b_wrong']} broken) -> {c['verdict'].upper()}")
