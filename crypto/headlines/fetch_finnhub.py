"""Fetch Finnhub general news, crypto category, and append new items to a raw JSONL pool (deduped by Finnhub id).

  python fetch_finnhub.py <env_file> <out_jsonl>
Finnhub returns only the latest ~100 crypto items per call, so this is run more than once over time to reach 150
BTC/ETH/SOL headlines. The key is read from the env file and never printed.
"""
import json, os, sys, time
import requests

env, out = sys.argv[1], sys.argv[2]
tok = next(l.split("=", 1)[1].strip().strip('"') for l in open(env) if l.startswith("FINNHUB_API_KEY="))
r = requests.get("https://finnhub.io/api/v1/news", params={"category": "crypto"}, headers={"X-Finnhub-Token": tok}, timeout=20)
r.raise_for_status()
items = r.json()
seen = set()
if os.path.exists(out):
    seen = {json.loads(l)["id"] for l in open(out)}
new = [i for i in items if i.get("id") not in seen]
with open(out, "a") as f:
    for i in new:
        i["fetched_at"] = int(time.time())
        f.write(json.dumps(i) + "\n")
print(f"got {len(items)}, new {len(new)}, pool {len(seen) + len(new)}")
