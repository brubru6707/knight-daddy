"""Headless test of Fine-tune against a local GPU backend: train NVDA from the UI, follow the progress bar to done,
then check it becomes the active model, retags headlines, and resets to general. Usage: python scripts/specialist_smoke_test.py [base_url] [out.png]"""
import sys, time
from playwright.sync_api import sync_playwright
from _kd import check, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
out = sys.argv[2] if len(sys.argv) > 2 else "specialist.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    watch_errors(pg)
    load(pg, url, "NVDA")
    ft = pg.locator("section[aria-label=Fine-tune]")
    ft.locator("text=/Model (online|offline)/").wait_for(timeout=30_000)
    t0 = time.time()
    ft.locator("button:has-text('Fine-tune to this stock')").click()
    ft.locator("button:has-text('Fine-tuning')").wait_for(timeout=15_000); check("training starts", True)
    ft.locator("text=/^step [1-9][0-9]*\\/[0-9]+/").wait_for(timeout=300_000)
    check("progress bar advances", float(ft.locator("[role=progressbar]").get_attribute("aria-valuenow")) > 0)
    ft.locator("text=Last fine-tune: Done").wait_for(timeout=900_000); check("training finishes", True, f"{time.time() - t0:.0f}s")
    ft.locator("text=Active model: NVDA specialist").wait_for(timeout=30_000); check("specialist becomes the active model", True)
    pg.locator("[data-testid=headline]").first.wait_for(timeout=120_000)
    pg.locator("text=/Tags by Qwen, NVDA specialist/").wait_for(timeout=120_000); check("headlines retagged by the specialist", True)
    ft.locator("button:has-text('Reset to general model')").click()
    ft.locator("text=Active model: general").wait_for(timeout=30_000); check("Reset to general model", True)
    pg.screenshot(path=out, full_page=True)
    b.close()
sys.exit(finish())
