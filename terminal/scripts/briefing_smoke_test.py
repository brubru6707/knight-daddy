"""Headless test of live news provider (Finnhub or fallback), the BRF briefing panel, and read-aloud.
Adapts to which keys are set (from /api/health). Usage: python scripts/briefing_smoke_test.py [base_url] [out.png]"""
import re, sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
out = sys.argv[2] if len(sys.argv) > 2 else "briefing.png"
BANNED = re.compile(r"\b(you should|investors should|recommend|buy now|sell now|good time to (buy|sell)|"
                    r"will (likely )?(rise|fall|climb|drop|gain|surge|rally|outperform)|should (buy|sell|hold))\b", re.I)
errors, checks = [], []


def check(name, ok, detail=""):
    checks.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1600, "height": 1800})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    keys = pg.request.get(f"{url}/api/health").json()["keys"]
    print("keys set:", keys)
    pg.goto(url); pg.evaluate("localStorage.clear()"); pg.reload()
    pg.fill("input[aria-label=Ticker]", "NVDA"); pg.click("text=GO")

    nws = pg.locator("section:has(header:has-text('NWS'))")
    nws.locator("text=/^BULL \\d+$/").wait_for(timeout=150_000)
    feed = pg.request.get(f"{url}/api/headlines?ticker=NVDA&source=live&limit=40").json()
    titles = [i["title"] for i in feed["items"]]
    on_topic = sum(bool(re.search(r"nvidia|nvda", t, re.I)) for t in titles)
    if keys["FINNHUB_API_KEY"]:
        check("live news provider is Finnhub", feed["provider"] == "Finnhub", feed.get("provider_note") or "")
        check("NVDA headlines are company-specific (name in at least 60% of titles)",
              titles and on_topic / len(titles) >= 0.6, f"{on_topic}/{len(titles)} mention Nvidia/NVDA")
    else:
        check("fallback provider shown without a Finnhub key", feed["provider"].startswith("Yahoo") and
              nws.locator("text=/Yahoo Finance \\(fallback\\)/").count() == 1, feed.get("provider_note") or "")
        print(f"      (fallback relevance for reference: {on_topic}/{len(titles)} titles mention Nvidia/NVDA)")

    brf = pg.locator("section:has(header:has-text('AI news briefing'))")
    brf.wait_for(timeout=30_000)
    if keys["GEMINI_API_KEY"]:
        brf.locator("text=/headlines, (today|last 24 hours|most recent)/").wait_for(timeout=90_000)
        text = brf.locator("p").inner_text()
        check("briefing paragraph present", len(text.split()) >= 15, f"{len(text.split())} words")
        check("briefing is one short paragraph (<= 110 words)", len(text.split()) <= 110 and "\n" not in text.strip())
        check("briefing has no prediction or advice phrases", not BANNED.search(text), text[:160])
        check("disclaimer shown", brf.locator("text=/does not predict prices or give advice/").count() == 1)
        bj = pg.request.get(f"{url}/api/briefing?ticker=NVDA").json()
        print("      guard:", bj["guard"], "| model:", bj["model"], "| window:", bj["window"], "| counts:", bj["counts"])
        if keys["ELEVENLABS_API_KEY"]:
            r = pg.request.get(f"{url}/api/briefing/audio?id={bj['id']}")
            check("audio endpoint returns MP3", r.status == 200 and r.headers["content-type"] == "audio/mpeg"
                  and len(r.body()) > 10_000, f"{r.status} {r.headers.get('content-type')} {len(r.body())} bytes")
            brf.locator("button:has-text('READ ALOUD')").click()
            brf.locator("button:has-text('STOP')").wait_for(timeout=60_000)
            check("READ ALOUD starts playback (button turns into STOP)", True)
            brf.locator("button:has-text('STOP')").click()
        else:
            brf.locator("button:has-text('READ ALOUD')").click()
            brf.locator("text=/Read aloud unavailable: ELEVENLABS_API_KEY is not set/").wait_for(timeout=30_000)
            check("read aloud explains missing ElevenLabs key", True)
    else:
        brf.locator("text=/GEMINI_API_KEY is not set/").wait_for(timeout=90_000)
        check("briefing explains missing Gemini key", True)
        check("no READ ALOUD button without a briefing", brf.locator("button:has-text('READ ALOUD')").count() == 0)
    pg.wait_for_timeout(500)
    pg.screenshot(path=out, clip={"x": 0, "y": 0, "width": 1600, "height": 560})
    b.close()
check("no browser console errors", not errors, "; ".join(errors[:3]))
print("ALL PASS" if all(checks) else "SOME CHECKS FAILED")
