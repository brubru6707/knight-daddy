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
    pg.reload(); pg.locator("section[aria-label='Your list']").wait_for(timeout=30_000)
    check("Your list is saved locally (survives reload)", pg.locator("[data-testid=onboarding]").count() == 0)
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
        check("crypto rows carry no sentiment pill", sec.locator("[data-testid=pill]").count() == 0)
        sec.locator("[data-testid=home-row]").first.click()
        cd = pg.locator("[data-testid=crypto-detail]"); cd.wait_for(timeout=30_000)
        pg.locator("[data-testid=headline]").first.or_(pg.locator("text=No headlines found.")).or_(pg.locator("text=/Headlines: n\\/a/")).first.wait_for(timeout=60_000)
        check("crypto detail: price and headlines only",
              all(pg.locator(x).count() == 0 for x in ("[data-testid=confidence]", "section[aria-label=Briefing]", "section[aria-label=Fine-tune]", "section[aria-label='Advanced research']")))
        check("crypto headlines carry no model tags",
              pg.locator("[data-testid=headline] >> text=/^(Bullish|Bearish|Neutral)$/").count() == 0)
        copy_rules(pg, "(crypto)")
        pg.screenshot(path=f"{out}_crypto.png", full_page=True)
        pg.locator("[data-testid=back]").click(); pg.locator("section[aria-label=Stocks]").wait_for(timeout=15_000)
    else:
        check("crypto section shows n/a when no prices are published", True, sec.locator("[data-testid=section-na]").inner_text())

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
errors[:] = [e for e in errors if "404" not in e] if not pairs else errors  # /api/replay/available 404s until Oscar publishes
sys.exit(finish())
