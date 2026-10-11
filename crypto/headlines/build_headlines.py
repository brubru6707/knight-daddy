"""Join the raw Finnhub pool with the label files into crypto/headlines/headlines_test.csv (kept rows only).

  python build_headlines.py <pool.jsonl>
Every id in the pool must have a row in some labels_round*.txt (U/D/N, or X to exclude), so nothing is skipped silently.
"""
import datetime, glob, json, os, sys
import pandas as pd

D = os.path.dirname(os.path.abspath(__file__))
pool = {(p := json.loads(l))["id"]: p for l in open(sys.argv[1])}  # unified pool (fetch_all.py), string ids
lab = {}
for f in sorted(glob.glob(f"{D}/labels_round*.txt")):
    for l in open(f):
        if l.strip() and not l.startswith("#"):
            i, L = l.split()[:2]
            i = f"fh-{i}" if i.isdigit() else i  # round 1 used bare Finnhub ids
            assert i not in lab, f"id {i} labeled twice"
            lab[i] = L
now = max(p["datetime"] for p in pool.values())
missing = {i for i, p in pool.items() if p["datetime"] >= now - 7 * 86400} - set(lab)
assert not missing, f"unlabeled ids in window: {sorted(missing)}"
assert set(lab) <= set(pool), f"labels without pool rows: {sorted(set(lab) - set(pool))}"
M = {"U": "Bullish", "D": "Bearish", "N": "Neutral"}
rows = [{"id": i, "date": datetime.datetime.fromtimestamp(pool[i]["datetime"], datetime.timezone.utc).strftime("%Y-%m-%d"),
         "source": pool[i]["source"], "text": pool[i]["headline"], "label": M[L]} for i, L in lab.items() if L != "X"]
df = pd.DataFrame(rows).sort_values("id")
df.to_csv(f"{D}/headlines_test.csv", index=False)
print(f"pool {len(pool)} | excluded {sum(L == 'X' for L in lab.values())} | kept {len(df)} | {df.label.value_counts().to_dict()}")
