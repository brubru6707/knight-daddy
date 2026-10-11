"""Headless test of onboarding (first open builds "Your list"), the display-only Crypto section, and the Replay page.
Usage: python scripts/extras_smoke_test.py [base_url] [out_prefix]"""
import re, sys
from playwright.sync_api import sync_playwright
from _kd import ADVICE, check, copy_rules, errors, finish, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
out = sys.argv[2] if len(sys.argv) > 2 else "extras"
CRYPTO = ["BTC-USD", "ETH-USD", "SOL-USD"]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 1000})
    watch_errors(pg)

    # ---- onboarding ----
    pg.goto(url); pg.evaluate("localStorage.clear()"); pg.reload()
    ob = pg.locator("[data-testid=onboarding]"); ob.wait_for(timeout=30_000)
    check("onboarding shows on first open", True)
    choices = ob.locator("[data-testid=choice]").evaluate_all("els => els.map(e => e.dataset.ticker)")
    check("onboarding offers supported tickers only", set(choices) == {"AAPL", "MSFT", "TSLA", "AMZN", "NVDA", "DDOG", *CRYPTO}, ", ".join(choices))
    check("onboarding has no buy/sell/hold or recommendation wording",
          not ADVICE.search(ob.inner_text()) and not re.search(r"\b(recommend|top pick|you should)\b", ob.inner_text(), re.I))
    copy_rules(pg, "(onboarding)")
    ob.locator("[data-testid=category]", has_text="Software and cloud").click()
    ob.locator("[data-testid=choice][data-ticker=NVDA]").click()
    ob.locator("[data-testid=onboarding-done]").click()
    mine = pg.locator("section[aria-label='Your list'] [data-testid=home-row]")
    mine.first.wait_for(timeout=60_000)
    got = mine.evaluate_all("els => els.map(e => e.dataset.ticker)")
    check("Your list holds exactly what was tapped", got == ["MSFT", "DDOG", "NVDA"], ", ".join(got))
    pg.wait_for_timeout(500)
    pg.reload(); pg.locator("section[aria-label='Your list']").wait_for(timeout=30_000)
    check("Your list is saved locally (survives reload)", pg.locator("[data-testid=onboarding]").count() == 0)
    ex = pg.locator("section[aria-label='Explore more']")
    names = ex.locator("[data-testid=explore-row]").evaluate_all("els => els.map(e => e.dataset.ticker)")
    check("Explore more lists every other supported name, A to Z", set(names) == {"AAPL", "AMZN", "TSLA", *CRYPTO}
          and names == sorted(names, key=lambda t: t.replace("-USD", "")), ", ".join(names))
    check("Explore more has no ranking or advice wording", not ADVICE.search(ex.inner_text())
          and not re.search(r"\b(recommend|top|best|trending|you should)\b", ex.inner_text(), re.I))
    ex.locator("[data-testid=explore-row][data-ticker=TSLA] [data-testid=explore-add]").click()
    got = pg.locator("section[aria-label='Your list'] [data-testid=home-row]").evaluate_all("els => els.map(e => e.dataset.ticker)")
    check("Add puts the name at the end of Your list and out of Explore", got[-1:] == ["TSLA"]
          and ex.locator("[data-testid=explore-row][data-ticker=TSLA]").count() == 0, ", ".join(got))
    pg.locator("text=Edit your list").click(); pg.locator("[data-testid=onboarding-skip]").click()
    check("Skip while editing keeps the list", pg.locator("section[aria-label='Your list']").count() == 1)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.locator("[data-testid=onboarding-skip]").click()
    pg.locator("section[aria-label=Stocks]").wait_for(timeout=30_000)
    check("Skip goes straight to the full list", pg.locator("section[aria-label='Your list']").count() == 0)

    # ---- crypto ----
    sec = pg.locator("section[aria-label=Crypto]")
    sec.locator("[data-testid=home-row]").first.or_(sec.locator("[data-testid=section-na]")).wait_for(timeout=60_000)
    pg.wait_for_timeout(3000)
    rows = sec.locator("[data-testid=home-row]").evaluate_all("els => els.map(e => e.dataset.ticker)")
    if rows:
        check("crypto rows are BTC, ETH, SOL only", set(rows) <= set(CRYPTO), ", ".join(rows))
        prices = sec.locator("[data-testid=row-price]").all_inner_texts()
        check("crypto rows show a price or n/a", all(re.fullmatch(r"\$[0-9,]+\.\d\d|n/a", x) for x in prices), ", ".join(prices))
        tagged = {t: pg.request.get(f"{url}/api/crypto/news?ticker={t}").json().get("tagged", False)
                  if pg.request.get(f"{url}/api/crypto/news?ticker={t}").ok else False for t in rows}
        check("crypto pill only when the worker pushed tags (hidden, not n/a)",
              sec.locator("[data-testid=pill]").count() == sum(tagged.values()) and "n/a" not in " ".join(sec.locator("[data-testid=pill]").all_inner_texts()))
        sec.locator("[data-testid=home-row]").first.click()
        cd = pg.locator("[data-testid=crypto-detail]"); cd.wait_for(timeout=30_000)
        pg.locator("[data-testid=headline]").first.or_(pg.locator("text=No headlines found.")).or_(pg.locator("text=/Headlines: n\\/a/")).first.wait_for(timeout=60_000)
        check("crypto detail: price and headlines only (tone bar only once tagged)",
              all(pg.locator(x).count() == 0 for x in ("section[aria-label=Briefing]", "section[aria-label=Fine-tune]", "section[aria-label='Sentiment vs. price']"))
              and (pg.locator("[data-testid=confidence]").count() == 0 or pg.locator("[data-testid=crypto-caption]").count() == 1))
        tags = pg.locator("[data-testid=headline] >> text=/^(Bullish|Bearish|Neutral)$/").count()
        cap = pg.locator("[data-testid=crypto-caption]")
        check("crypto tags appear only with the 'not yet validated on crypto' caption",
              (tags == 0 and cap.count() == 0) or (tags > 0 and cap.inner_text() == "Tagged by our general news model, not yet validated on crypto."))
        pg.locator("text=/Coinbase/").first.wait_for(timeout=30_000)
        check("crypto chart from Coinbase", pg.locator("[aria-label='Price chart']").count() == 1)
        check("no confidence n/a on crypto", pg.locator("[data-testid=confidence-na]").count() == 0)
        copy_rules(pg, "(crypto)")
        pg.screenshot(path=f"{out}_crypto.png", full_page=True)
        pg.locator("[data-testid=back]").click(); pg.locator("section[aria-label=Stocks]").wait_for(timeout=15_000)
    else:
        check("crypto section shows n/a when no prices are published", True, sec.locator("[data-testid=section-na]").inner_text())

    # ---- settings ----
    pg.locator("[data-testid=settings]").click()
    panel = pg.locator("[data-testid=settings-panel]"); panel.wait_for(timeout=10_000)
    try:  # wait for the per-stock active models to arrive (they stay n/a only if the API cannot answer)
        pg.wait_for_function("[...document.querySelectorAll('[data-testid=settings-models] li')].every(li => !li.innerText.endsWith('n/a'))", timeout=15_000)
    except Exception:
        pass
    models = panel.locator("[data-testid=settings-models] li").all_inner_texts()
    check("settings: active model per stock", len(models) == 6 and all(re.search(r"(general|specialist|n/a)$", m) for m in models), "; ".join(m.replace("\n", " ") for m in models))
    check("settings: reset all stocks button", panel.locator("text=Reset all stocks to general model").count() == 1)
    check("settings: password not saved yet", panel.locator("[data-testid=pw-state]").inner_text().startswith("Not saved"))
    panel.locator("text=Re-enter train password").click()
    panel.locator("input[aria-label='Train password']").fill("placeholder-not-real"); panel.locator("button:has-text('Save')").click()
    check("settings: change train password saves it on this device", panel.locator("[data-testid=pw-state]").inner_text().startswith("Saved"))
    panel.locator("text=Forget password").click()
    check("settings: forget password clears it", panel.locator("[data-testid=pw-state]").inner_text().startswith("Not saved")
          and pg.evaluate("localStorage.getItem('kd.trainpw')") is None)
    pg.keyboard.press("Escape")

    # ---- password once (train endpoint intercepted: nothing reaches the real site, no job is created) ----
    seen = []
    def fake_train(route):
        pw = route.request.headers.get("x-train-password", "")
        seen.append(pw)
        ok = pw == "pw-test-A" and len(seen) < 3
        route.fulfill(status=200 if ok else 401, json={"ticker": "NVDA", "job": "test"} if ok else {"detail": "Wrong train password."})
    pg.route("**/api/specialist/train", fake_train)
    pg.route("**/api/specialist/status?*", lambda r: r.fulfill(json={"phase": "done", "step": 75, "total_steps": 75, "elapsed_s": 48}))
    pg.route("**/api/health", lambda r: r.fulfill(json={"mode": "vercel", "worker_online": True, "train_password_required": True, "keys": {}}))
    pg.route("**/api/specialist/info", lambda r: r.fulfill(json={"supported": ["NVDA"]}))
    pg.evaluate("localStorage.setItem('kd.advanced', 'true')")  # full fine-tune controls
    pg.goto(f"{url}/?t=NVDA"); ft = pg.locator("section[aria-label=Fine-tune]")
    ft.locator("button:has-text('Fine-tune to this stock')").click()
    ft.locator("input[aria-label='Train password']").fill("pw-test-A"); ft.locator("button:has-text('Start')").click()
    pg.wait_for_timeout(1500)
    check("password asked the first time, then saved", pg.evaluate("localStorage.getItem('kd.trainpw')") == "pw-test-A")
    pg.reload(); ft.locator("button:has-text('Fine-tune to this stock')").click(); pg.wait_for_timeout(1500)
    check("saved password reused silently", ft.locator("input[aria-label='Train password']").count() == 0 and seen[-1] == "pw-test-A", f"{len(seen)} calls")
    ft.locator("button:has-text('Fine-tune to this stock')").click(); pg.wait_for_timeout(1500)  # server now rejects it
    check("a rejected password is forgotten and asked again",
          ft.locator("input[aria-label='Train password']").count() == 1 and pg.evaluate("localStorage.getItem('kd.trainpw')") is None)
    pg.unroute("**/api/specialist/train"); pg.unroute("**/api/specialist/status?*"); pg.unroute("**/api/health"); pg.unroute("**/api/specialist/info")
    pg.goto(url)

    # ---- replay ----
    pg.locator("[data-testid=nav-replay]").click()
    pg.locator("h1:has-text('Replay')").wait_for(timeout=15_000)
    check("replay route", pg.url.rstrip("/").endswith("/replay"), pg.url)
    av = pg.request.get(f"{url}/api/replay/available")
    pairs = av.json().get("pairs", []) if av.ok else []
    if not pairs:
        pg.locator("[data-testid=replay-na]").wait_for(timeout=30_000)
        check("replay shows n/a until Oscar publishes replay days", True)
    else:
        pg.locator("[data-testid=replay-date] option[value]:not([value=''])").first.wait_for(state="attached", timeout=30_000)
        opts = pg.locator("[data-testid=replay-date] option[value]:not([value=''])").evaluate_all("els => els.map(e => e.value)")
        t0 = pairs[0]["ticker"]
        check("date picker offers only published dates", set(opts) == {x["date"] for x in pairs if x["ticker"] == t0}, f"{len(opts)} dates")
        pg.select_option("[data-testid=replay-date]", opts[0])
        banner = pg.locator("[data-testid=replay-banner]"); banner.wait_for(timeout=15_000)
        check("replay banner says Replay and the date", banner.inner_text().startswith("Replay - "), banner.inner_text())
        pg.locator("[data-testid=replay-price]").or_(pg.locator("[data-testid=replay-error]")).wait_for(timeout=60_000)
        if pg.locator("[data-testid=replay-price]").count():
            check("replay shows that day's price", pg.locator("[data-testid=replay-price]").inner_text().startswith("$"))
            check("replay shows the confidence bar or n/a",
                  pg.locator("[data-testid=confidence-bar]").count() + pg.locator("[data-testid=confidence-na]").count() == 1)
            n = pg.locator("[data-testid=replay-headline]").count()
            tags = pg.locator("[data-testid=replay-headline] >> text=/^(Bullish|Bearish|Neutral)$/").count()
            check("replay headlines are tagged", n > 0 and tags == n, f"{tags}/{n}")
        else:
            check("replay error shows plain n/a", True, pg.locator("[data-testid=replay-error]").inner_text())
    check("replay labeled historical, not live", "Historical data, not live." in pg.inner_text("body"))
    copy_rules(pg, "(replay)")
    pg.screenshot(path=f"{out}_replay.png", full_page=True)
    b.close()
# /api/replay/available 404s until Oscar publishes; the intercepted wrong-password check logs a deliberate 401
errors[:] = [e for e in errors if "401" not in e and (pairs or "404" not in e)]
sys.exit(finish())
