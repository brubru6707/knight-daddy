"""Score general 2B vs specialist vs 9B teacher against teammates' hand labels (the only ground truth).

  python eval_specialist.py NVDA [run_dir] [labels_csv] [out_dir]
Reads <run_dir>/preds_gold.parquet (written by train_specialist.py) and
~/poc1/specialist/labeling/<T>_labeled.csv. Writes ~/poc1/results/specialist_<T>_<run>.json.
Without a labeled CSV it returns status "no_human_labels" and no scores.
The verdict rule is fixed in advance: "better" / "worse" only if the 95% paired bootstrap CI of the
accuracy difference (specialist minus general) excludes 0; otherwise "no clear difference".
"""
import json, os, sys
from math import comb
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score

LABELS = ["Bearish", "Bullish", "Neutral"]
VALID = {l.lower(): l for l in LABELS + ["Skip"]}
LAB_DIR = Path(os.path.expanduser("~/poc1/specialist/labeling"))
RESULTS = Path(os.path.expanduser("~/poc1/results"))
MODELS = {"general": "General 2B (before)", "specialist": "Specialist 2B (after)", "teacher": "9B teacher"}
B, SEED = 2000, 0


def load_labels(path, gold_ids):
    df = pd.read_csv(path, dtype=str).fillna("")
    issues = []
    if not {"id", "label"} <= set(df.columns):
        raise ValueError("labeled CSV needs columns id and label")
    unknown = set(df.id) - set(gold_ids)
    if unknown:
        issues.append(f"{len(unknown)} ids not in the test set (ignored)")
    df = df[df.id.isin(gold_ids)]
    raw = df.label.str.strip().str.lower()
    bad = df[(raw != "") & ~raw.isin(VALID)]
    if len(bad):
        issues.append(f"{len(bad)} rows with an invalid label (ignored), e.g. {bad.label.iloc[0]!r}")
    df = df.assign(human=raw.map(VALID))
    n_blank, n_skip = int((raw == "").sum()), int((df.human == "Skip").sum())
    df = df[df.human.isin(LABELS)]
    return df[["id", "human"]], {"blank": n_blank, "skip": n_skip, "issues": issues}


def mcnemar_exact(a_right, b_right):
    """Two-sided exact McNemar test on paired correctness. Returns (b_only, a_only, p)."""
    b_only = int(np.sum(~a_right & b_right)); a_only = int(np.sum(a_right & ~b_right))
    n = a_only + b_only
    if n == 0:
        return b_only, a_only, 1.0
    k = min(a_only, b_only)
    p = min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)
    return b_only, a_only, p


def score(df):
    y = df.human.map(LABELS.index).to_numpy()
    preds = {m: df[f"{m}_label"].map(LABELS.index).to_numpy() for m in MODELS}
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(y), size=(B, len(y)))  # same resamples for every model (paired)
    out = {}
    for m, p in preds.items():
        right = p == y
        boot_acc = right[idx].mean(1)
        boot_f1 = np.array([f1_score(y[i], p[i], labels=[0, 1, 2], average="macro", zero_division=0) for i in idx])
        per = f1_score(y, p, labels=[0, 1, 2], average=None, zero_division=0)
        out[m] = {"name": MODELS[m], "n": int(len(y)), "accuracy": float(right.mean()),
                  "accuracy_ci95": [float(np.percentile(boot_acc, 2.5)), float(np.percentile(boot_acc, 97.5))],
                  "macro_f1": float(f1_score(y, p, labels=[0, 1, 2], average="macro", zero_division=0)),
                  "macro_f1_ci95": [float(np.percentile(boot_f1, 2.5)), float(np.percentile(boot_f1, 97.5))],
                  "per_class_f1": {LABELS[k]: {"f1": float(per[k]), "n": int((y == k).sum())} for k in range(3)}}
    g_right, s_right, t_right = preds["general"] == y, preds["specialist"] == y, preds["teacher"] == y
    diff = s_right[idx].mean(1) - g_right[idx].mean(1)
    lo, hi = float(np.percentile(diff, 2.5)), float(np.percentile(diff, 97.5))
    s_only, g_only, p = mcnemar_exact(g_right, s_right)
    verdict = ("better" if lo > 0 else "worse" if hi < 0 else "no clear difference")
    tg_t_only, tg_g_only, tg_p = mcnemar_exact(g_right, t_right)
    return out, {
        "accuracy_diff": float(s_right.mean() - g_right.mean()), "accuracy_diff_ci95": [lo, hi],
        "mcnemar": {"specialist_right_general_wrong": s_only, "general_right_specialist_wrong": g_only, "p": p},
        "teacher_vs_general_mcnemar": {"teacher_only": tg_t_only, "general_only": tg_g_only, "p": tg_p},
        "verdict": verdict}


def score_crypto(gold):
    """CRYPTO test set = StockTwits author tags (human), Bullish/Bearish only: binary P(Bullish) vs P(Bearish),
    same rule as crypto/eval_crypto.py. Paired bootstrap CI and exact McNemar, verdict rule fixed in advance."""
    y = (gold.teacher_label == "Bullish").to_numpy()
    right = {m: (gold[f"{m}_p_bull"] > gold[f"{m}_p_bear"]).to_numpy() == y for m in ("general", "specialist")}
    idx = np.random.default_rng(SEED).integers(0, len(y), size=(B, len(y)))
    models = {m: {"name": MODELS[m], "n": int(len(y)), "binary_accuracy": float(r.mean()),
                  "binary_accuracy_ci95": [float(np.percentile(r[idx].mean(1), 2.5)), float(np.percentile(r[idx].mean(1), 97.5))]}
              for m, r in right.items()}
    d = right["specialist"][idx].mean(1) - right["general"][idx].mean(1)
    lo, hi = float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))
    s_only, g_only, p = mcnemar_exact(right["general"], right["specialist"])
    return {"status": "scored_binary", "n_scored": int(len(y)), "models": models,
            "label_source": "StockTwits author tags (human), balanced Bullish/Bearish",
            "no_neutral_note": "No Neutral class in this test set: scored as Bullish vs Bearish only.",
            "comparison": {"accuracy_diff": float(right["specialist"].mean() - right["general"].mean()),
                           "accuracy_diff_ci95": [lo, hi], "verdict": "better" if lo > 0 else "worse" if hi < 0 else "no clear difference",
                           "mcnemar": {"specialist_right_general_wrong": s_only, "general_right_specialist_wrong": g_only, "p": p}}}


def evaluate(ticker, run_dir, labels_csv=None, out_dir=RESULTS):
    run_dir = Path(run_dir)
    gold = pd.read_parquet(run_dir / "preds_gold.parquet").rename(columns={"teacher_label": "teacher_label"})
    prog = json.loads((run_dir / "progress.json").read_text())
    base = {"ticker": ticker, "run": run_dir.name, "n_test_rows": int(len(gold)),
            "changed_on_test_rows": int((gold.general_label != gold.specialist_label).sum()),
            "agreement_with_teacher": prog.get("agreement_with_teacher"),
            "note": "Stock-specific news analyst: reads headlines. Not a trading signal."}
    if ticker == "CRYPTO":
        return {**base, **score_crypto(gold)}
    labels_csv = Path(labels_csv) if labels_csv else LAB_DIR / f"{ticker}_labeled.csv"
    if not labels_csv.exists():
        return {**base, "status": "no_human_labels",
                "message": f"No human test labels yet ({labels_csv.name} not found). No score shown."}
    lab, info = load_labels(labels_csv, set(gold.id))
    df = gold.merge(lab, on="id")
    if len(df) < 20:
        return {**base, "status": "too_few_labels", "labels_file": str(labels_csv), "label_info": info,
                "n_scored": len(df), "message": f"Only {len(df)} usable human labels; need at least 20 to score."}
    models, comparison = score(df)
    res = {**base, "status": "scored", "labels_file": str(labels_csv), "label_info": info,
           "n_scored": int(len(df)), "human_class_counts": df.human.value_counts().to_dict(),
           "models": models, "comparison": comparison,
           "disagreements": df[df.general_label != df.specialist_label][
               ["id", "text", "human", "general_label", "specialist_label", "teacher_label"]].to_dict("records")}
    if out_dir:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        (Path(out_dir) / f"specialist_{ticker}_{run_dir.name}.json").write_text(json.dumps(res, indent=1))
    return res


if __name__ == "__main__":
    t = sys.argv[1].upper()
    run = sys.argv[2] if len(sys.argv) > 2 else max(
        (p for p in Path(os.path.expanduser(f"~/scratch/poc1/terminal/specialists/{t}")).glob("run-*")
         if (p / "preds_gold.parquet").exists()), key=lambda p: p.stat().st_mtime)
    r = evaluate(t, run, sys.argv[3] if len(sys.argv) > 3 else None, sys.argv[4] if len(sys.argv) > 4 else RESULTS)
    print(json.dumps({k: v for k, v in r.items() if k != "disagreements"}, indent=1))
