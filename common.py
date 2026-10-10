import json, os
from sklearn.metrics import accuracy_score, f1_score, classification_report
LABELS = ["Bearish", "Bullish", "Neutral"]  # dataset ids 0,1,2 (per dataset card)
DATASET = "zeroshot/twitter-financial-news-sentiment"

def metrics(y_true, y_pred, name, n, seconds, extra=None):
    per = f1_score(y_true, y_pred, labels=[0, 1, 2], average=None)
    m = {"model": name, "n": n,
         "accuracy": accuracy_score(y_true, y_pred),
         "macro_f1": f1_score(y_true, y_pred, labels=[0, 1, 2], average="macro"),
         "per_class_f1": {LABELS[i]: float(per[i]) for i in range(3)},
         "seconds": seconds, "examples_per_sec": n / seconds}
    if extra: m.update(extra)
    print(classification_report(y_true, y_pred, labels=[0, 1, 2], target_names=LABELS, digits=4))
    print(json.dumps(m, indent=2))
    out = os.path.expanduser(f"~/poc1/results/{name.replace('/', '_')}.json")
    json.dump(m, open(out, "w"), indent=2)
    return m
