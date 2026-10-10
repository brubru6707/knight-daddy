"""Headless test of the PUBLIC mode (Vercel API + Oscar worker): data from snapshots, worker status dot, and the
password-protected Fine-tune with polled progress (only when the worker is online and a password is given).
Usage: python scripts/public_smoke_test.py <base_url> [train_password] [out.png]"""
import sys, time
from playwright.sync_api import sync_playwright
from _kd import check, errors, finish, load, watch_errors

url = sys.argv[1]
pw = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "-" else None
out = sys.argv[3] if len(sys.argv) > 3 else "public.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    watch_errors(pg)
    h = pg.request.get(f"{url}/api/health").json()
    check("public mode", h.get("mode") == "vercel", h.get("mode"))
    load(pg, url, "NVDA")
    pg.locator("text=/^[+-]\\$[0-9,.]+ \\([+-][0-9.]+%\\)/").wait_for(timeout=30_000); check("price from snapshot", True)
    pg.locator("[data-testid=headline]").first.wait_for(timeout=30_000)
    check("headline feed from snapshot (Finnhub)", pg.locator("text=/Live headlines from Finnhub/").count() == 1)
    pg.locator("[data-testid=briefing-bullets]").or_(pg.locator("text=/Briefing: n\\/a/")).first.wait_for(timeout=30_000); check("briefing from snapshot", True)
    pg.locator("text=Advanced research").click(); pg.locator("[data-testid=backtest-caption]").wait_for(timeout=30_000)
    check("backtest from snapshot", True)
    status = pg.locator("[data-testid=model-status]").inner_text()
    online = bool(h.get("worker_online"))
    check("model status dot matches worker", status.endswith("online" if online else "offline"), status)
    ft = pg.locator("section[aria-label=Fine-tune]")
    if not online:
        check("Fine-tune disabled while offline", ft.locator("button:has-text('Fine-tune')").is_disabled())
        check("offline message", ft.locator("text=Model offline, showing latest data").count() == 1)
    elif pw:
        ft.locator("button:has-text('Fine-tune')").click()
        box = ft.locator("input[aria-label='Train password']"); box.wait_for(timeout=10_000)
        check("password asked on first Fine-tune", True)
        box.fill("wrong-password"); ft.locator("button:has-text('Start')").click()
        ft.locator("text=/Wrong train password/").wait_for(timeout=15_000); check("wrong password rejected", True)
        ft.locator("input[aria-label='Train password']").fill(pw); t0 = time.time()
        ft.locator("button:has-text('Start')").click()
        ft.locator("button:has-text('Fine-tuning')").wait_for(timeout=15_000)
        ft.locator("text=/^step [1-9][0-9]*\\/[0-9]+/").wait_for(timeout=180_000)
        check("progress arrives from Oscar via the public API", True, f"{time.time() - t0:.0f}s")
        ft.locator("text=Last fine-tune: Done").wait_for(timeout=300_000)
        check("job finishes", True, f"{time.time() - t0:.0f}s")
    else:
        print("      (worker online but no password given: training not exercised)")
    pg.screenshot(path=out, clip={"x": 0, "y": 0, "width": 1440, "height": 900})
    b.close()
errors[:] = [e for e in errors if "401" not in e]  # the deliberate wrong-password 401
sys.exit(finish())
