"""Headless UI smoke test: load the terminal, wait for every panel, run the backtest, screenshot.
Usage: python scripts/ui_smoke_test.py [base_url] [ticker] [out.png]"""
import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ticker = sys.argv[2] if len(sys.argv) > 2 else "NVDA"
out = sys.argv[3] if len(sys.argv) > 3 else "screenshot.png"
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 1800})  # tall enough to reach every panel header
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(url)
    pg.fill("input[aria-label=Ticker]", ticker)
    pg.click("text=GO")
    pg.wait_for_selector("text=/1D [+-]/", timeout=60_000)                 # price panel
    pg.wait_for_selector("text=/^BULL [0-9]+$/", timeout=150_000)         # headline feed (model may load)
    pg.wait_for_selector("text=KEY FINDING", timeout=60_000)               # sentiment panel
    pg.click("button[aria-label='Expand model benchmark']")              # BM starts collapsed
    pg.wait_for_selector("text=FinBERT (zero-shot)", timeout=60_000)       # benchmark panel
    pg.click("button:has-text('RUN')")
    pg.wait_for_selector("text=HONEST READ", timeout=60_000)               # backtest panel
    pg.wait_for_timeout(1500)
    print("canvases:", pg.locator("canvas").count())
    print("headline tags:", pg.locator("li").count())
    print("honest read:", pg.locator("text=HONEST READ").locator("..").inner_text())
    pg.screenshot(path=out, full_page=True)
    # layout: drag the benchmark panel header to the top, reload, check the position persisted
    hdr = pg.locator("header:has-text('model benchmark')")
    y0 = hdr.bounding_box()["y"]
    box = hdr.bounding_box()
    pg.mouse.move(box["x"] + 300, box["y"] + 8); pg.mouse.down()
    for k in range(1, 21):
        pg.mouse.move(box["x"] + 300, box["y"] + 8 - k * (box["y"] - 60) / 20)
    pg.mouse.up(); pg.wait_for_timeout(800)
    y1 = hdr.bounding_box()["y"]
    pg.reload(); pg.wait_for_selector("header:has-text('model benchmark')"); pg.wait_for_timeout(800)
    y2 = pg.locator("header:has-text('model benchmark')").bounding_box()["y"]
    print(f"benchmark header y: before {y0:.0f}, after drag {y1:.0f}, after reload {y2:.0f}",
          "LAYOUT OK" if y1 < y0 - 100 and abs(y2 - y1) < 5 else "LAYOUT FAIL")
    pg.screenshot(path=out.replace(".png", "_dragged.png"))
    pg.evaluate("localStorage.removeItem('kw.layouts.v4')")
    b.close()
print("console errors:", errors or "none")
