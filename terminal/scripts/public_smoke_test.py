"""Headless test of the PUBLIC mode (Vercel API stand-in + Oscar worker): mirror banner, panels from snapshots,
password-protected Train with polled progress. Usage: python scripts/public_smoke_test.py <base_url> <train_password> [out.png]"""
import sys, time
from playwright.sync_api import sync_playwright

url, pw = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else "public.png"
errors, checks = [], []


def check(name, ok, detail=""):
    checks.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 2000})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(url); pg.evaluate("localStorage.clear()"); pg.reload()
    pg.fill("input[aria-label=Ticker]", "NVDA"); pg.click("text=GO")
    banner = pg.locator("text=PUBLIC MIRROR").locator("..")
    banner.wait_for(timeout=30_000)
    check("public mirror banner", "online" in banner.inner_text(), banner.inner_text()[:140])
    pg.locator("text=/1D [+-]/").wait_for(timeout=30_000); check("price panel from snapshot", True)
    nws = pg.locator("section:has(header:has-text('NWS'))")
    nws.locator("text=/^BULL \\d+$/").wait_for(timeout=30_000)
    check("headline feed from snapshot (Finnhub)", nws.locator("text=Finnhub").count() >= 1)
    brf = pg.locator("section:has(header:has-text('AI news briefing'))")
    brf.locator("p").wait_for(timeout=30_000)
    check("briefing from snapshot", len(brf.locator("p").inner_text().split()) > 15)
    pg.locator("button:has-text('RUN')").click(); pg.locator("text=HONEST READ").wait_for(timeout=30_000)
    check("backtest from snapshot", True)

    spc = pg.locator("section:has(header:has-text('stock-specific news analyst'))")
    pwbox = spc.locator("input[aria-label='Train password']")
    pwbox.wait_for(timeout=30_000); check("train password field shown", True)
    pwbox.fill("wrong-password"); spc.locator("button:has-text('TRAIN')").click()
    spc.locator("text=/Wrong train password/").wait_for(timeout=15_000); check("wrong password rejected", True)
    n_expected_errors = len(errors)  # the 401 from the deliberate wrong password
    pwbox.fill(pw)
    t0 = time.time()
    spc.locator("button:has-text('TRAIN')").click()
    spc.locator("button:has-text('TRAINING')").wait_for(timeout=15_000)
    step = spc.locator("text=/^step [1-9][0-9]*\\/[0-9]+$/")  # a real training step, pushed from Oscar via the API
    step.wait_for(timeout=180_000)
    check("progress arrives from Oscar via the public API", True, f"'{step.inner_text()}' at {time.time() - t0:.0f}s")
    spc.locator("text=/^DONE$/").wait_for(timeout=300_000)
    check("job finishes (click to DONE)", True, f"{time.time() - t0:.0f}s")
    spc.locator("text=/NO HUMAN TEST LABELS YET|VERDICT/").wait_for(timeout=60_000)
    check("before/after box after training", True)
    pg.wait_for_timeout(1000)
    pg.screenshot(path=out, clip={"x": 0, "y": 0, "width": 1600, "height": 620})
    b.close()
unexpected = [e for e in errors if "401" not in e]
check("no unexpected console errors (deliberate wrong-password 401 excluded)", not unexpected, "; ".join(unexpected[:3]))
print("ALL PASS" if all(checks) else "SOME CHECKS FAILED")
