"""Live headlines: Finnhub company news first, yfinance as fallback. Keys come from terminal/.env.

Keys are re-read from .env on every call, so adding a key does not need a server restart.
Never log or return key values.
"""
import json, os, re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
CACHE = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/scratch/poc1/terminal")))
MIN_NAMED = 8  # keep only company-named headlines if at least this many exist in the window
SUFFIX = r"\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|class [a-c]|n\.?v|s\.?a|ag|se)\b\.?"


def key(name):
    """Value from the process environment, else from terminal/.env (read fresh each time)."""
    return os.environ.get(name) or (dotenv_values(ENV_FILE).get(name) if ENV_FILE.exists() else None) or ""


def finnhub_news(t, days=7):
    tok = key("FINNHUB_API_KEY")
    if not tok:
        raise RuntimeError("FINNHUB_API_KEY not set")
    to = datetime.now(timezone.utc).date()
    r = requests.get("https://finnhub.io/api/v1/company-news",
                     params={"symbol": t, "from": str(to - timedelta(days=days)), "to": str(to)},
                     headers={"X-Finnhub-Token": tok}, timeout=15)
    if r.status_code != 200:
        raise RuntimeError(f"Finnhub HTTP {r.status_code}")
    items = []
    for n in sorted(r.json(), key=lambda n: n.get("datetime", 0), reverse=True):
        if n.get("headline"):
            items.append({"title": n["headline"].strip(), "source": n.get("source", ""), "url": n.get("url", ""),
                          "time": datetime.fromtimestamp(n["datetime"], timezone.utc).isoformat(),
                          "related": n.get("related", "")})
    seen, out = set(), []
    for i in items:  # Finnhub repeats some stories across sources
        if i["title"].lower() not in seen:
            seen.add(i["title"].lower()); out.append(i)
    return out


def short_name(name):
    """'NVIDIA Corp' -> 'NVIDIA', 'Datadog Inc (Pre-Reincorporation)' -> 'Datadog'."""
    n = re.sub(r"\(.*?\)", " ", name)
    n = re.sub(SUFFIX, " ", n, flags=re.I)
    return re.sub(r"[\s,.]+", " ", n).strip()


def company_name(t):
    """Short company name from Finnhub's profile endpoint, cached on disk; '' if unavailable."""
    f = CACHE / f"profile_{t}.json"
    if f.exists():
        return json.loads(f.read_text()).get("short", "")
    try:
        r = requests.get("https://finnhub.io/api/v1/stock/profile2", params={"symbol": t},
                         headers={"X-Finnhub-Token": key("FINNHUB_API_KEY")}, timeout=15)
        full = r.json().get("name", "") if r.status_code == 200 else ""
    except Exception:
        return ""
    short = short_name(full)
    if full:
        f.write_text(json.dumps({"full": full, "short": short}))
    return short


def name_filter(t, items):
    """Finnhub's company feed for large caps includes general market stories (only 15% of the latest NVDA
    headlines named Nvidia on 2026-10-09). Keep headlines naming the company or ticker when enough exist."""
    nm = company_name(t)
    pat = re.compile(r"\b(" + "|".join(re.escape(x) for x in [nm, t] if x) + r")\b", re.I)
    named = [i for i in items if pat.search(i["title"])]
    label = f"{nm} or {t}" if nm else t
    if len(named) >= MIN_NAMED:
        return named, f"{len(named)} of {len(items)} Finnhub headlines (7 days) name {label}; showing only those"
    return items, f"only {len(named)} of {len(items)} Finnhub headlines name {label}; showing all"


def yahoo_news(t):
    import yfinance as yf
    raw = (yf.Ticker(t).news or []) if t.isupper() else []  # a coin name ("Bitcoin") goes straight to Search
    if not raw:  # Ticker.news came back empty on Oscar (2026-10); Search still returns news
        raw = yf.Search(t, news_count=40).news or []
    items = []
    for n in raw:
        c = n.get("content", n)
        ts = c.get("pubDate") or c.get("providerPublishTime")
        if isinstance(ts, (int, float)):
            ts = datetime.fromtimestamp(ts, timezone.utc).isoformat()
        prov = c.get("provider", {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher")
        url = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
        if c.get("title"):
            items.append({"title": c["title"], "time": ts, "source": prov or "", "url": url or ""})
    return items


# Crypto rows are display only. Their news comes from Finnhub's crypto category (or a Yahoo name search), kept to
# headlines that name the coin.
COINS = {"BTC-USD": ("Bitcoin", "BTC"), "ETH-USD": ("Ethereum", "Ether", "ETH"), "SOL-USD": ("Solana", "SOL")}


def crypto_news(t):
    terms = COINS[t]
    pat = re.compile(r"\b(" + "|".join(re.escape(x) for x in terms) + r")\b", re.I)
    note = None
    try:
        tok = key("FINNHUB_API_KEY")
        if not tok:
            raise RuntimeError("FINNHUB_API_KEY not set")
        r = requests.get("https://finnhub.io/api/v1/news", params={"category": "crypto"},
                         headers={"X-Finnhub-Token": tok}, timeout=15)
        if r.status_code != 200:
            raise RuntimeError(f"Finnhub HTTP {r.status_code}")
        items = [{"title": n["headline"].strip(), "source": n.get("source", ""), "url": n.get("url", ""),
                  "time": datetime.fromtimestamp(n["datetime"], timezone.utc).isoformat()}
                 for n in sorted(r.json(), key=lambda n: n.get("datetime", 0), reverse=True) if n.get("headline")]
        named = [i for i in items if pat.search(i["title"])]
        if named:
            return "Finnhub", named, None, f"{len(named)} of {len(items)} Finnhub crypto headlines name {terms[0]}; showing only those"
        note = f"no Finnhub crypto headlines name {terms[0]} right now"
    except Exception as e:
        note = f"Finnhub unavailable ({e})"
    items = [i for i in yahoo_news(terms[0]) if pat.search(i["title"])]
    return "Yahoo Finance (fallback)", items, note, f"Showing only headlines that name {terms[0]}"


def live_news(t):
    """Returns (provider, items, note, filter_note). provider is 'Finnhub' or 'Yahoo Finance (fallback)'.
    note explains a fallback (a warning); filter_note describes the company-name filter (informational)."""
    if t in COINS:
        return crypto_news(t)
    try:
        items = finnhub_news(t)
        if items:
            items, fnote = name_filter(t, items)
            return "Finnhub", items, None, fnote
        note = "Finnhub returned no headlines for this ticker in the last 7 days"
    except Exception as e:  # missing key, HTTP error, network
        note = f"Finnhub unavailable ({e})"
    return "Yahoo Finance (fallback)", yahoo_news(t), note, None
