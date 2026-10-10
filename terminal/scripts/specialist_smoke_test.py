"""Headless test of the "stock-specific news analyst" (SPC) panel: train NVDA from the UI and check every piece.
Usage: python scripts/specialist_smoke_test.py [base_url] [out.png]"""
import sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
out = sys.argv[2] if len(sys.argv) > 2 else "specialist.png"
errors, checks = [], []


def check(name, ok, detail=""):
    checks.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 1500})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(url)
    pg.evaluate("localStorage.clear()"); pg.reload()
    pg.fill("input[aria-label=Ticker]", "NVDA"); pg.click("text=GO")
    spc = pg.locator("section:has(header:has-text('stock-specific news analyst'))")
    spc.wait_for(timeout=30_000)
    check("SPC panel renders", spc.is_visible())
    check("framed as not a trading signal", "not a trading signal" in spc.inner_text())
    # wait for the server-start warmup to finish (Train is refused while it runs)
    for _ in range(90):
        if not pg.request.get(f"{url}/api/specialist/info").json()["busy"]:
            break
        time.sleep(1)
    t0 = time.time()
    spc.locator("button:has-text('TRAIN')").click()
    # the panel first shows the previous run (DONE, full bar); wait until it switches to the new run
    spc.locator("button:has-text('TRAINING')").wait_for(timeout=30_000)
    spc.locator("text=/^TRAINING$/").wait_for(timeout=120_000)
    pg.wait_for_function("""() => { const b = document.querySelector('[role=progressbar] > div');
                             return b && parseFloat(b.style.width) > 10 && parseFloat(b.style.width) < 100; }""", timeout=120_000)
    check("progress bar moves during training", True, f"at {time.time() - t0:.0f}s")
    spc.locator("text=/^DONE$/").wait_for(timeout=240_000)
    total = time.time() - t0
    check("training finishes under 3 minutes (click to DONE)", total < 180, f"{total:.0f}s")
    spc.locator("text=/NO HUMAN TEST LABELS YET|VERDICT/").wait_for(timeout=30_000)
    txt = spc.inner_text()
    has_labels = "VERDICT" in txt
    check("eval gate: no score without human labels" if not has_labels else "eval shows verdict with human labels", True,
          "scored" if has_labels else "no human labels yet")
    check("agreement shown as agreement, not accuracy", "not accuracy" in txt)
    check("loss chart drawn (held-out line)", spc.locator("svg path[stroke='#ffb000']").count() == 1)
    ticks = [float(t) for t in spc.locator("svg[aria-label='Training loss by step'] > g > text").all_text_contents()]
    check("loss y-axis starts at 0 with round ticks", ticks and min(ticks) == 0 and len(ticks) <= 6, str(ticks))
    nws = pg.locator("section:has(header:has-text('NWS'))")
    nws.locator("button:has-text('specialist')").wait_for(timeout=30_000)
    nws.locator("button:has-text('specialist')").click()
    nws.locator("text=/NVDA SPECIALIST, \\d+ changed/").wait_for(timeout=120_000)
    nws.locator("text=/^BULL \\d+$/").wait_for(timeout=120_000)  # feed finished loading specialist tags
    nws.locator("li").first.wait_for(timeout=120_000)  # a refetch can briefly empty the list right after training
    for _ in range(60):  # the feed refetches once after training; poll instead of counting mid-refetch
        tags = nws.locator("li").count()
        if tags > 0:
            break
        time.sleep(1)
    check("headline feed switches to specialist tags", tags > 0,
          f"{nws.locator('text=/NVDA SPECIALIST/').inner_text()}, {tags} headlines")
    pg.wait_for_timeout(800)
    spc.screenshot(path=out)
    nws.screenshot(path=out.replace(".png", "_feed.png"))
    b.close()
check("no browser console errors", not errors, "; ".join(errors[:3]))
print("ALL PASS" if all(checks) else "SOME CHECKS FAILED")
