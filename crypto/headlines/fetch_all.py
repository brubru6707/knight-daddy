"""Fetch crypto headlines from Finnhub (crypto category) and the CoinDesk, Cointelegraph and Decrypt RSS feeds,
sequentially (site policy: single-threaded on the login node), into one pool with string ids:
  fh-<finnhub id>  or  rss-<source>-<sha1(link)[:10]>

  python -I fetch_all.py <finnhub_env_file> <finnhub_pool.jsonl> <unified_pool.jsonl>
The old Finnhub pool is folded in first so its labels (labels_round1.txt, numeric ids) keep working via the fh- prefix.
"""
import email.utils, hashlib, json, os, sys, time
import xml.etree.ElementTree as ET
import requests

env, fh_pool, out = sys.argv[1:4]
FEEDS = {"CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
         "Cointelegraph": "https://cointelegraph.com/rss",
         "Decrypt": "https://decrypt.co/feed",
         # Amendment 2
         "TheBlock": "https://www.theblock.co/rss.xml", "BitcoinMagazine": "https://bitcoinmagazine.com/feed",
         "CryptoSlate": "https://cryptoslate.com/feed/", "CryptoPotato": "https://cryptopotato.com/feed/",
         "NewsBTC": "https://www.newsbtc.com/feed/", "Bitcoinist": "https://bitcoinist.com/feed/",
         "UToday": "https://u.today/rss", "CryptoNews": "https://crypto.news/feed/"}
UA = {"User-Agent": "Mozilla/5.0 (research; headline sentiment test set)"}
pool = {}
if os.path.exists(out):
    pool = {(p := json.loads(l))["id"]: p for l in open(out)}
n0 = len(pool)


def add(i, source, headline, ts, via):
    if i not in pool:
        pool[i] = {"id": i, "source": source, "headline": " ".join(headline.split()), "datetime": int(ts), "via": via,
                   "fetched_at": int(time.time())}


for l in open(fh_pool):  # earlier Finnhub pull(s)
    p = json.loads(l); add(f"fh-{p['id']}", p["source"], p["headline"], p["datetime"], "finnhub")
tok = next(l.split("=", 1)[1].strip().strip('"') for l in open(env) if l.startswith("FINNHUB_API_KEY="))
counts = {}
try:
    r = requests.get("https://finnhub.io/api/v1/news", params={"category": "crypto"}, headers={"X-Finnhub-Token": tok}, timeout=20)
    r.raise_for_status()
    for p in r.json():
        add(f"fh-{p['id']}", p["source"], p["headline"], p["datetime"], "finnhub")
    counts["finnhub"] = len(r.json())
except Exception as e:
    counts["finnhub"] = f"error {type(e).__name__}"
for src, url in FEEDS.items():
    try:
        r = requests.get(url, headers=UA, timeout=20); r.raise_for_status()
        items = ET.fromstring(r.content).iter("item")
        k = 0
        for it in items:
            title, link, pub = (it.findtext(t) or "" for t in ("title", "link", "pubDate"))
            if not title:
                continue
            ts = email.utils.parsedate_to_datetime(pub).timestamp() if pub else time.time()
            add(f"rss-{src}-{hashlib.sha1((link or title).encode()).hexdigest()[:10]}", src, title, ts, "rss")
            k += 1
        counts[src] = k
    except Exception as e:
        counts[src] = f"error {type(e).__name__}"
with open(out, "w") as f:
    for p in sorted(pool.values(), key=lambda p: p["datetime"]):
        f.write(json.dumps(p) + "\n")
print("fetched:", counts, "| pool", n0, "->", len(pool))
