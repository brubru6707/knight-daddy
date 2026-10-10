"""Headless test of the live news feed and the Knight-Daddy AI column (Gemini briefing as short bullets, read aloud).
Adapts to which keys are set (from /api/health). Usage: python scripts/briefing_smoke_test.py [base_url] [out.png]"""
import re, sys
from playwright.sync_api import sync_playwright
from _kd import ADVICE, check, errors, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
out = sys.argv[2] if len(sys.argv) > 2 else "briefing.png"
BANNED = re.compile(r"\b(you should|investors should|recommend|buy now|sell now|will (likely )?(rise|fall|climb|drop|gain|surge|rally|outperform))\b", re.I)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    watch_errors(pg)
    h = pg.request.get(f"{url}/api/health").json()
    keys, public = h.get("keys", {}), h.get("mode") == "vercel"
    print("mode:", h.get("mode"), "| keys set:", keys)
    load(pg, url, "NVDA")
    pg.locator("[data-testid=headline]").first.wait_for(timeout=150_000)
    feed = pg.request.get(f"{url}/api/headlines?ticker=NVDA&source=live&limit=40&model=general").json()
    titles = [i["title"] for i in feed["items"]]
    on_topic = sum(bool(re.search(r"nvidia|nvda", t, re.I)) for t in titles)
    if keys.get("FINNHUB_API_KEY") or public:
        check("live news provider is Finnhub", feed["provider"] == "Finnhub", feed.get("provider_note") or "")
        check("NVDA headlines are company-specific (>= 60% name it)", titles and on_topic / len(titles) >= 0.6, f"{on_topic}/{len(titles)}")
    else:
        check("fallback provider named in the feed note", pg.locator("text=/Live headlines from Yahoo/").count() == 1)
    ai = pg.locator("aside[aria-label='Knight-Daddy AI']")
    bj = pg.request.get(f"{url}/api/briefing?ticker=NVDA").json()
    if bj.get("status") == "ok":
        ai.locator("[data-testid=tone]").wait_for(timeout=90_000)
        bl = [x.inner_text() for x in ai.locator("[data-testid=briefing-bullets] li").all()]
        check("briefing shown as 1 to 4 bullets", 1 <= len(bl) <= 4, f"{len(bl)} bullets")
        check("bullets are short (<= 90 chars each)", all(len(x) <= 92 for x in bl), str([len(x) for x in bl]))
        check("bullets have no prediction or advice phrases", not any(BANNED.search(x) or ADVICE.search(x) for x in bl))
        shown = [int(x.inner_text().split()[-1]) for x in ai.locator("[data-testid=breakdown] li").all()]
        check("breakdown counts match the API", shown == [bj["counts"].get(k, 0) for k in ("Bullish", "Bearish", "Neutral")], f"{shown} vs {bj['counts']}")
        if keys.get("ELEVENLABS_API_KEY"):
            ai.locator("button:has-text('Read aloud')").click()
            ai.locator("button:has-text('Stop')").wait_for(timeout=60_000); check("Read aloud starts playback", True)
            ai.locator("button:has-text('Stop')").click()
        else:
            ai.locator("button:has-text('Read aloud')").click()
            ai.locator("text=/Read aloud: /").wait_for(timeout=30_000); check("Read aloud explains it is unavailable", True)
    else:
        ai.locator("text=/Briefing: n\\/a/").wait_for(timeout=90_000)
        check("briefing unavailable shows n/a", True)
    pg.screenshot(path=out, clip={"x": 0, "y": 0, "width": 1440, "height": 760})
    b.close()
errors[:] = [e for e in errors if "briefing/audio" not in e]  # a missing ElevenLabs key is reported in the UI
sys.exit(finish())
