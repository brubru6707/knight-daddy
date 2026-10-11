"""List pool items in the recency window that have no label yet; mark exact (normalized) matches of labeled items."""
import glob, json, os, re, sys
from datetime import datetime, timezone

D = os.path.dirname(os.path.abspath(__file__))
P = [json.loads(l) for l in open(sys.argv[1])]
done = set()
for f in glob.glob(f"{D}/labels_round*.txt"):
    for l in open(f):
        if l.strip() and not l.startswith("#"):
            i = l.split()[0]; done.add(i if not i.isdigit() else f"fh-{i}")
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()
seen = {norm(p["headline"]) for p in P if p["id"] in done}
now = max(p["datetime"] for p in P)
new = [p for p in P if p["id"] not in done and p["datetime"] >= now - 7 * 86400]
print("labeled", len(done), "| unlabeled in window", len(new))
for p in new:
    print(p["id"], "|", datetime.fromtimestamp(p["datetime"], timezone.utc).strftime("%m-%d %H:%M"), "|",
          ("EXACTDUP " if norm(p["headline"]) in seen else "") + p["headline"][:170])
