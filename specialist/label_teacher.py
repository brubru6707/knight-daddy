"""Label specialist data with the Qwen3.5-9B QLoRA adapter (the teacher).

For each ticker, labels the training pool (pre-2023-07, used to train the specialist), the held-out pool
(Jul-Dec, agreement check only), and the hand-label pool (so the teacher can be scored against human labels
later; teacher labels on that pool are NEVER used for training).
Same prompt and logit scoring as the 2B (shared code in terminal/backend/classifier.py).
Output: ~/scratch/poc1/specialist/<T>_<pool>_teacher.parquet, plus a copy under ~/poc1/specialist/teacher_labels/.
"""
import os, shutil, sys, time
import pandas as pd

sys.path.insert(0, os.path.expanduser("~/poc1/terminal/backend"))
from classifier import SentimentModel  # noqa: E402

D = "/oscar/scratch/brrodrig/poc1/specialist"
KEEP = os.path.expanduser("~/poc1/specialist/teacher_labels")
os.makedirs(KEEP, exist_ok=True)
model = SentimentModel(os.path.expanduser("~/poc1/adapters/qwen35-9b"), base="Qwen/Qwen3.5-9B")
t0 = time.time(); model.load(); print(f"loaded 9B in {time.time() - t0:.0f}s", flush=True)

sanity = model.classify(["Nvidia shares plunge after guidance cut", "Nvidia beats estimates and raises outlook",
                         "Nvidia to present at investor conference on Tuesday"], bs=3)
print("sanity:", [r["label"] for r in sanity], flush=True)
assert [r["label"] for r in sanity] == ["Bearish", "Bullish", "Neutral"], "teacher sanity check failed"

for t in sys.argv[1:] or ["NVDA", "DDOG"]:
    for pool in ["train", "heldout", "gold"]:
        df = pd.read_parquet(f"{D}/{t}_{pool}_pool.parquet")
        if df.empty:
            print(f"{t} {pool}: empty, skipped", flush=True); continue
        t0 = time.time()
        res = pd.DataFrame(model.classify(df.text.tolist(), bs=16))
        out = pd.concat([df.reset_index(drop=True), res], axis=1)
        path = f"{D}/{t}_{pool}_teacher.parquet"
        out.to_parquet(path); shutil.copy(path, KEEP)
        print(f"{t} {pool}: {len(out)} headlines in {time.time() - t0:.0f}s, "
              f"labels {out.label.value_counts().to_dict()}", flush=True)
print("done")
