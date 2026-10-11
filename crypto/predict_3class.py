"""GPU: score both crypto test sets with the general 2B, the new 3-class crypto adapter, and FinBERT (zero-shot).

  python predict_3class.py <crypto3_adapter_dir> [posts|headlines|both]
Uses terminal/backend/classifier.SentimentModel, the same loader and scoring the app uses.
Writes ~/scratch/poc1/crypto/spec3/preds_{posts,headlines}.parquet. Re-run with "headlines" as the headline set grows.
"""
import os, sys
import numpy as np, pandas as pd, torch

C = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(C, "..", "terminal", "backend"))
from classifier import SentimentModel  # noqa: E402

S = os.path.expanduser("~/scratch/poc1/crypto/spec3")
adapter, which = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "both")
sets = {"posts": lambda: pd.read_parquet(f"{S}/CRYPTO3_gold_teacher.parquet")[["id", "text", "label"]],
        "headlines": lambda: pd.read_csv(f"{C}/headlines/headlines_test.csv")[["id", "text", "label"]]}
sets = {k: v() for k, v in sets.items() if which in (k, "both")}

for name, path in (("general", os.path.expanduser("~/poc1/adapters/qwen35-2b")), ("crypto3", adapter)):
    m = SentimentModel(path)
    for k, df in sets.items():
        out = m.classify(df.text.tolist(), bs=32)
        df[f"{name}_label"] = [o["label"] for o in out]
        for c in ("p_bear", "p_bull", "p_neut"):
            df[f"{name}_{c}"] = [o[c] for o in out]
    del m; torch.cuda.empty_cache()

from transformers import AutoModelForSequenceClassification, AutoTokenizer  # noqa: E402
tok = AutoTokenizer.from_pretrained("ProsusAI/finbert")
fb = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert").cuda().eval()
col = {v: k for k, v in fb.config.id2label.items()}
for k, df in sets.items():
    probs = []
    with torch.inference_mode():
        for i in range(0, len(df), 64):
            enc = tok(df.text.tolist()[i:i + 64], padding=True, truncation=True, max_length=128, return_tensors="pt").to("cuda")
            probs.append(fb(**enc).logits.softmax(-1).cpu().numpy())
    p = np.concatenate(probs)
    P = np.stack([p[:, col["negative"]], p[:, col["positive"]], p[:, col["neutral"]]], 1)
    df["finbert_label"] = np.array(["Bearish", "Bullish", "Neutral"])[P.argmax(1)]
    for j, c in enumerate(("p_bear", "p_bull", "p_neut")):
        df[f"finbert_{c}"] = P[:, j]
    df.to_parquet(f"{S}/preds_{k}.parquet")
    print(k, len(df), {m: round(float((df[f"{m}_label"] == df.label).mean()), 4) for m in ("general", "crypto3", "finbert")})
