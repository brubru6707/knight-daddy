"""Gate test (pre-registered): score the general Qwen3.5-2B adapter and FinBERT on the StockTwits crypto test set.

Primary: binary Bullish vs Bearish by comparing only P(Bullish) and P(Bearish) (labels have no Neutral class).
Secondary: normal 3-way argmax, Neutral counted as wrong. Writes ~/poc1/results/crypto_gate.json and predictions.
"""
import json, os, sys, time
import numpy as np, pandas as pd, torch
from sklearn.metrics import f1_score

sys.path.insert(0, os.path.expanduser("~/poc1/terminal/backend"))
from classifier import SentimentModel  # noqa: E402

R = os.path.expanduser("~/scratch/poc1/crypto")
gold = pd.read_parquet(f"{R}/spec/CRYPTO_gold_teacher.parquet")
y = (gold.label == "Bullish").astype(int).to_numpy()           # 1 Bullish, 0 Bearish
texts = gold.text.tolist()
rng = np.random.default_rng(0)
IDX = rng.integers(0, len(y), size=(2000, len(y)))


def summarize(name, p_bear, p_bull, p_neut):
    pred2 = (p_bull > p_bear).astype(int)
    right = pred2 == y
    boot = right[IDX].mean(1)
    f1b = [f1_score(y[i], pred2[i], average="macro") for i in IDX[:500]]
    three = np.where((p_neut > p_bull) & (p_neut > p_bear), -1, pred2)
    return {"model": name, "n": int(len(y)),
            "binary_accuracy": float(right.mean()), "binary_accuracy_ci95": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
            "binary_macro_f1": float(f1_score(y, pred2, average="macro")),
            "binary_macro_f1_ci95": [float(np.percentile(f1b, 2.5)), float(np.percentile(f1b, 97.5))],
            "f1_bearish": float(f1_score(y, pred2, pos_label=0)), "f1_bullish": float(f1_score(y, pred2, pos_label=1)),
            "three_way_accuracy_neutral_wrong": float((three == y).mean()), "neutral_rate": float((three == -1).mean())}, pred2


res, preds = {}, {}
t0 = time.time()
m = SentimentModel(os.path.expanduser("~/poc1/adapters/qwen35-2b"))
out = m.classify(texts, bs=32)
p = np.array([[o["p_bear"], o["p_bull"], o["p_neut"]] for o in out])
res["general_2b"], preds["general_2b"] = summarize("Qwen3.5-2B QLoRA (general)", p[:, 0], p[:, 1], p[:, 2])
res["general_2b"]["seconds"] = round(time.time() - t0, 1)
del m; torch.cuda.empty_cache()

from transformers import AutoTokenizer, AutoModelForSequenceClassification
t0 = time.time()
tok = AutoTokenizer.from_pretrained("ProsusAI/finbert")
fb = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert").cuda().eval()
lab = fb.config.id2label
probs = []
with torch.inference_mode():
    for i in range(0, len(texts), 64):
        enc = tok(texts[i:i + 64], padding=True, truncation=True, max_length=128, return_tensors="pt").to("cuda")
        probs.append(fb(**enc).logits.softmax(-1).cpu().numpy())
pf = np.concatenate(probs)
col = {v: k for k, v in lab.items()}
res["finbert"], preds["finbert"] = summarize("FinBERT (zero-shot)", pf[:, col["negative"]], pf[:, col["positive"]], pf[:, col["neutral"]])
res["finbert"]["seconds"] = round(time.time() - t0, 1)

gate = res["general_2b"]["binary_accuracy"] >= 0.889
res["gate"] = {"threshold_binary_accuracy": 0.889, "general_2b_binary_accuracy": res["general_2b"]["binary_accuracy"],
               "passes_gate_means_stop": bool(gate),
               "decision": "STOP: general model already strong, no specialist" if gate else "GAP: train specialist"}
res["test_set"] = {"source": "ElKulako/stocktwits-crypto", "n": int(len(y)), "balanced": True, "labels": "author tags, Bullish/Bearish only"}
json.dump(res, open(os.path.expanduser("~/poc1/results/crypto_gate.json"), "w"), indent=1)
gold.assign(general_2b=preds["general_2b"], finbert=preds["finbert"], g_p_bear=p[:, 0], g_p_bull=p[:, 1], g_p_neut=p[:, 2],
            f_p_bear=pf[:, col["negative"]], f_p_bull=pf[:, col["positive"]], f_p_neut=pf[:, col["neutral"]]).to_parquet(f"{R}/gate_preds.parquet")
for k in ("general_2b", "finbert"):
    r = res[k]
    print(f"{r['model']:30s} binary acc {r['binary_accuracy']:.4f} {[round(x, 3) for x in r['binary_accuracy_ci95']]}  macroF1 {r['binary_macro_f1']:.4f}"
          f"  F1 bear {r['f1_bearish']:.3f} bull {r['f1_bullish']:.3f} | 3-way (neutral=wrong) {r['three_way_accuracy_neutral_wrong']:.4f}, neutral rate {r['neutral_rate']:.3f} | {r['seconds']}s")
print("GATE:", res["gate"]["decision"])
