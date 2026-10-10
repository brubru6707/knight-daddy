"""Headless test of the panel toolbar (show/hide, reset, saved layouts), the CRYPTO specialist view (no Neutral note),
the crypto benchmark rows, and QUICK DEMO training timed from click to DONE (3 runs).
Usage: python scripts/toolbar_quick_smoke_test.py [base_url] [ticker_for_quick] [out.png]"""
import json, sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
qt = sys.argv[2] if len(sys.argv) > 2 else "NVDA"
out = sys.argv[3] if len(sys.argv) > 3 else "toolbar.png"
errors, checks, times = [], [], []


def check(name, ok, detail=""):
    checks.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 1800})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(url)
    pg.evaluate("localStorage.clear()"); pg.reload()
    bar = pg.locator("[role=toolbar][aria-label=Panels]")
    bar.wait_for(timeout=30_000)
    sec = lambda code: pg.locator(f"section:has(header:has-text('{code}'))")
    check("toolbar lists 7 panel toggles", bar.locator("button[aria-pressed]").count() == 7)
    bar.locator("button:has-text('BT')").click()
    pg.wait_for_timeout(300)
    check("hide BT removes the backtest panel", sec("backtest").count() == 0)
    pg.reload(); bar.wait_for()
    check("hidden panel stays hidden after reload", sec("backtest").count() == 0)
    bar.locator("button:has-text('BT')").click()
    sec("backtest").wait_for(timeout=10_000)
    check("show BT brings the panel back", sec("backtest").count() == 1)
    bar.locator("input[aria-label='Layout name']").fill("no-bench")
    bar.locator("button:has-text('BM')").click()
    bar.locator("button:has-text('SAVE')").click()
    bar.locator("button:has-text('RESET LAYOUT')").click()
    pg.wait_for_timeout(300)
    check("reset shows every panel", sec("model benchmark").count() == 1 and sec("backtest").count() == 1)
    pg.reload(); bar.wait_for()
    bar.locator("select[aria-label='Saved layouts']").select_option("no-bench")
    bar.locator("button:has-text('LOAD')").click()
    pg.wait_for_timeout(300)
    check("saved layout survives reload and loads (BM hidden)", sec("model benchmark").count() == 0 and sec("backtest").count() == 1)
    bar.locator("button:has-text('DELETE')").click()
    bar.locator("button:has-text('RESET LAYOUT')").click()
    # drag still works: move the benchmark panel header and check the stored layout changed
    bm = sec("model benchmark"); bm.wait_for()
    before = json.loads(pg.evaluate("localStorage.getItem('kw.layouts.v3')") or "{}")
    h = bm.locator(".kw-drag").first.bounding_box()
    pg.mouse.move(h["x"] + 40, h["y"] + 8); pg.mouse.down(); pg.mouse.move(h["x"] + 40, h["y"] - 600, steps=12); pg.mouse.up()
    pg.wait_for_timeout(500)
    after = json.loads(pg.evaluate("localStorage.getItem('kw.layouts.v3')") or "{}")
    y = lambda L: next((i["y"] for i in L.get("lg", []) if i["i"] == "bm"), None)
    check("drag still moves panels (bm y changed)", y(after) is not None and y(after) != y(before), f"{y(before)} -> {y(after)}")
    bm.locator("text=NO NEUTRAL CLASS").first.wait_for(timeout=30_000)
    check("benchmark shows crypto rows with no-Neutral note", "crypto specialist" in bm.inner_text())

    spc = sec("stock-specific news analyst")
    sel = spc.locator("select[aria-label='Specialist ticker']")
    sel.wait_for(timeout=30_000)
    opts = sel.locator("option").all_text_contents()
    check("SPC lists new tickers and CRYPTO", all(t in opts for t in ["AAPL", "MSFT", "AMZN", "TSLA", "CELH", "CRYPTO"]), ",".join(opts))
    sel.select_option("CRYPTO")
    spc.locator("text=/VERDICT/").wait_for(timeout=60_000)
    txt = spc.inner_text()
    check("CRYPTO shows NO NEUTRAL CLASS note and a verdict", "NO NEUTRAL CLASS" in txt and "better" in txt)
    sel.select_option("AAPL")
    spc.locator("text=/NO HUMAN TEST SET|Press TRAIN/").wait_for(timeout=30_000)
    check("teacher-only ticker says agreement is not accuracy", "not accuracy" in spc.inner_text())

    sel.select_option(qt)
    for _ in range(120):
        if not pg.request.get(f"{url}/api/specialist/info").json()["busy"]:
            break
        time.sleep(1)
    for run in range(3):
        for _ in range(90):  # realistic demo click: the preloaded trainer has had time to load (about 15 s)
            info = pg.request.get(f"{url}/api/specialist/info").json()
            if info.get("standby") == "ready" and not info["busy"]:
                break
            time.sleep(1)
        print(f"standby before run {run + 1}: {info.get('standby')}", flush=True)
        t0 = time.time()
        spc.locator("button:has-text('QUICK DEMO')").click()
        spc.locator("button:has-text('TRAINING')").wait_for(timeout=30_000)
        spc.locator("text=/^DONE$/").wait_for(timeout=180_000)
        times.append(round(time.time() - t0, 1))
        spc.locator("text=QUICK DEMO RUN, not scored").first.wait_for(timeout=10_000)
        check(f"quick demo run {run + 1} labeled 'QUICK DEMO RUN, not scored'", spc.locator("text=QUICK DEMO RUN, not scored").count() >= 1, f"{times[-1]}s click to DONE")
    check("quick demo click to DONE under 40 s on this GPU (all 3)", max(times) < 40, str(times))
    st = pg.request.get(f"{url}/api/specialist/status?ticker={qt}").json()
    check("quick run is not the served/scored run", st.get("quick") is True and pg.request.get(f"{url}/api/specialist/eval?ticker={qt}").json().get("run", "").startswith("run-"))
    pg.screenshot(path=out, full_page=True)
    b.close()
check("no console errors", not errors, "; ".join(errors[:3]))
print(json.dumps({"quick_click_to_done_s": times}))
print(f"{sum(checks)}/{len(checks)} passed")
sys.exit(0 if all(checks) else 1)
