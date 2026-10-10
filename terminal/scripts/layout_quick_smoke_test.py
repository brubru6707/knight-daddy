"""Headless test of the layout controls (replaces the old panel-toolbar test): dark-mode toggle persists, watchlist
star and menu, "/" focuses search, competitor click loads the peer without errors, 1D shows n/a, and optionally the
Quick demo run timed from click to done. Usage: python scripts/layout_quick_smoke_test.py [base_url] [quick:0|1] [out.png]"""
import sys, time
from playwright.sync_api import sync_playwright
from _kd import check, errors, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
quick = len(sys.argv) > 2 and sys.argv[2] == "1"
out = sys.argv[3] if len(sys.argv) > 3 else "layout.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    watch_errors(pg)
    load(pg, url, "NVDA")
    pg.click("[aria-label='Switch to dark mode']")
    check("dark mode on", pg.evaluate("document.documentElement.classList.contains('dark')"))
    pg.reload(); pg.locator("[data-testid=price]").wait_for(timeout=30_000)
    check("dark mode persists after reload", pg.evaluate("document.documentElement.classList.contains('dark')"))
    pg.screenshot(path=out.replace(".png", "_dark.png"))
    pg.click("[aria-label='Switch to light mode']")
    check("light mode back", not pg.evaluate("document.documentElement.classList.contains('dark')"))
    pg.click("button[title='Add to watchlist']"); pg.click("button:has-text('Watchlist')")
    check("watchlist lists the starred ticker", pg.locator("[role=menu] >> text=NVDA").count() == 1)
    pg.click("button:has-text('Watchlist')")
    pg.keyboard.press("/")
    check("'/' focuses the search box", pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Ticker")
    pg.locator("[aria-label=Period] >> text=1D").click()
    check("1D shows n/a (no intraday data served)", pg.locator("text=Intraday prices: n/a").count() == 1)
    pg.locator("section[aria-label=Competitors] button:has-text('AMD')").click()
    pg.locator("text=Advanced Micro Devices, Inc.").first.wait_for(timeout=15_000)
    pg.locator("text=/1M|n\\/a|No price data/").first.wait_for(timeout=30_000)
    check("competitor click loads the peer", pg.locator("h1").inner_text() == "Advanced Micro Devices, Inc.")
    pg.wait_for_timeout(3000)
    check("untracked peer shows n/a, not invented data", pg.locator("[data-testid=price]").inner_text() == "n/a", pg.locator("[data-testid=price]").inner_text())
    if quick:
        times = []
        for _ in range(3):
            load(pg, url, "NVDA"); ft = pg.locator("[aria-label=Fine-tune]"); t0 = time.time()
            ft.locator("text=Quick demo (not scored)").click()
            ft.locator("text=/Last fine-tune: Done/").wait_for(timeout=300_000); times.append(time.time() - t0)
        check("quick demo runs finish", True, ", ".join(f"{t:.0f}s" for t in times))
    pg.screenshot(path=out)
    b.close()
errors[:] = [e for e in errors if "404" not in e]  # the untracked peer's API 404s are expected and shown as n/a
sys.exit(finish())
