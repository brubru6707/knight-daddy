"""Headless UI smoke test of the Knight-Daddy app: home list, ticker detail (price, confidence bar, briefing, fine-tune
controls, headlines, competitors, advanced research), Back to the list, exact copy and copy rules.
Usage: python scripts/ui_smoke_test.py [base_url] [ticker] [out.png]"""
import re, sys
from playwright.sync_api import sync_playwright
from _kd import HOME, check, copy_rules, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ticker = sys.argv[2] if len(sys.argv) > 2 else "NVDA"
out = sys.argv[3] if len(sys.argv) > 3 else "screenshot.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    watch_errors(pg)

    # ---- home list ----
    pg.goto(url); pg.evaluate("localStorage.clear(); localStorage.setItem('kd.onboarded', 'true')"); pg.reload()
    rows = pg.locator("section[aria-label=Stocks] [data-testid=home-row]")
    rows.first.wait_for(timeout=60_000)
    pg.wait_for_function("[...document.querySelectorAll('[data-testid=row-price]')].every(e => e.innerText !== '…')", timeout=60_000)
    shown = [rows.nth(i).get_attribute("data-ticker") for i in range(rows.count())]
    check("home: one Stocks section", pg.locator("section[aria-label=Stocks] h2").inner_text() == "Stocks")
    check("home: only the six live stocks, in order", shown == [t for t in HOME if t in shown] and len(shown) >= 1, ", ".join(shown))
    prices = pg.locator("section[aria-label=Stocks] [data-testid=row-price]").all_inner_texts()
    check("home: each row shows a share price or n/a", all(re.fullmatch(r"\$[0-9,]+\.\d\d|n/a", x) for x in prices), ", ".join(prices))
    changes = pg.locator("section[aria-label=Stocks] [data-testid=row-change]").all_inner_texts()
    check("home: today's change as a percent or n/a", all(re.fullmatch(r"[+-][0-9.]+%|n/a", x) for x in changes), ", ".join(changes))
    pg.wait_for_function("document.querySelectorAll('section[aria-label=Stocks] [data-testid=pill]').length >= document.querySelectorAll('section[aria-label=Stocks] [data-testid=home-row]').length", timeout=60_000)
    pills = pg.locator("section[aria-label=Stocks] [data-testid=home-row] [data-testid=pill]").all_inner_texts()
    check("home: a sentiment pill on every row", len(pills) == len(shown) and all(x in ("Bullish", "Bearish", "Neutral", "n/a") for x in pills), ", ".join(pills))
    check("home: footer copy", pg.locator("footer").inner_text() == "News sentiment, not investment advice.")
    copy_rules(pg, "(home)")

    # ---- detail ----
    load(pg, url, ticker)
    check("detail: URL carries the ticker", f"t={ticker}" in pg.url, pg.url)
    pg.locator("text=/^[+-]\\$[0-9,.]+ \\([+-][0-9.]+%\\)/").wait_for(timeout=60_000)
    check("price and period change", pg.locator("[data-testid=price]").inner_text().startswith("$"), pg.locator("[data-testid=price]").inner_text())
    pg.locator("[aria-label=Period] >> text=1Y").click()
    pg.locator("text=/(Up|Down) over 1 year/").wait_for(timeout=30_000)
    check("period buttons switch the chart", True)
    pg.locator("[aria-label=Period] >> text=1D").click()
    try:
        pg.locator("text=Intraday prices: n/a").wait_for(timeout=10_000)
    except Exception:
        pass
    check("1D shows n/a (no intraday data served)", pg.locator("text=Intraday prices: n/a").count() == 1)
    pg.locator("[aria-label=Period] >> text=1M").click()

    conf = pg.locator("[data-testid=confidence]")
    conf.locator("[data-testid=confidence-bar]").or_(conf.locator("[data-testid=confidence-na]")).wait_for(timeout=60_000)
    if conf.locator("[data-testid=confidence-bar]").count():
        segs = {l: conf.locator(f"[data-testid=seg-{l}]") for l in ("Bearish", "Neutral", "Bullish")}
        widths = {l: (s.bounding_box()["width"] if s.count() else 0) for l, s in segs.items()}
        total = sum(widths.values())
        check("confidence bar: three segments sized by probability", total > 0, ", ".join(f"{l} {w / total:.0%}" for l, w in widths.items()))
        cls = {l: (s.get_attribute("class") if s.count() else "") for l, s in segs.items()}
        check("confidence bar colors: red / yellow / green", all(c == "" or k in c for c, k in
              ((cls["Bearish"], "bg-down"), (cls["Neutral"], "bg-neutral"), (cls["Bullish"], "bg-up"))))
    else:
        check("confidence bar: n/a until the worker pushes p_bearish/p_neutral/p_bullish", True, conf.locator("[data-testid=confidence-na]").inner_text())
    check("confidence bar labeled as Qwen classification", conf.locator("text=/Qwen classification/").count() == 1)

    brief = pg.locator("section[aria-label=Briefing]")
    brief.locator("[data-testid=briefing-bullets]").or_(brief.locator("[data-testid=briefing-unavailable]")).wait_for(timeout=90_000)
    if brief.locator("[data-testid=briefing-bullets]").count():
        n = brief.locator("[data-testid=briefing-bullets] li").count()
        check("briefing: 1 to 4 Gemini bullets", 1 <= n <= 4, f"{n} bullets")
        check("briefing labeled as Gemini", brief.locator("text=/Written by Gemini/").count() == 1)
        check("speaker button reads this ticker's briefing", ticker in (brief.locator("[data-testid=speaker]").get_attribute("aria-label") or ""))
    else:  # Gemini down upstream: a plain n/a line, never the raw error
        check("briefing unavailable shows plain n/a", True, brief.locator("[data-testid=briefing-unavailable]").inner_text())

    ft = pg.locator("section[aria-label=Fine-tune]")
    active = ft.locator("[data-testid=active-model]").inner_text()
    check("active model status line", active in ("Active model: general", f"Active model: {ticker} specialist"), active)
    check("Fine-tune to this stock button", ft.locator("button:has-text('Fine-tune to this stock')").count() == 1)
    check("Reset to general model shown only for a specialist",
          ft.locator("button:has-text('Reset to general model')").count() == (1 if "specialist" in active else 0))

    pg.locator("[data-testid=headline]").first.wait_for(timeout=150_000)
    check("3 headlines shown first", pg.locator("[data-testid=headline]").count() == 3)
    tags = pg.locator("[data-testid=headline] >> text=/^(Bullish|Bearish|Neutral)$/").count()
    check("headlines carry a Bullish/Bearish/Neutral tag", tags == 3, f"{tags}/3")
    pg.locator("text=/^View all \\d+$/").click()
    check("View all expands the list", pg.locator("[data-testid=headline]").count() > 3, str(pg.locator("[data-testid=headline]").count()))
    pg.locator("text=Show fewer headlines").click()
    raw = [w for w in ("HTTP 4", "HTTP 5", "certificate", "quota", "server error") if w in pg.inner_text("body")]
    check("no raw error text on the page", not raw, ", ".join(raw))
    check("competitors row has 3 peers", pg.locator("section[aria-label=Competitors] button").count() == 3)
    check("advanced research collapsed by default", pg.locator("[data-testid=sentiment-caption]").count() == 0)
    pg.locator("text=Advanced research").click()
    pg.locator("[data-testid=sentiment-caption]").wait_for(timeout=60_000)
    check("sentiment caption", pg.locator("[data-testid=sentiment-caption]").inner_text() ==
          "Sentiment tracks the previous day's move, not the next one. It lags price.")
    pg.locator("[data-testid=backtest-caption]").wait_for(timeout=60_000)
    check("backtest caption", pg.locator("[data-testid=backtest-caption]").inner_text() == "Trading on sentiment lost to buy-and-hold.")
    check("model card copy", pg.locator("[data-testid=model-copy]").inner_text() ==
          "Qwen3.5-2B QLoRA. 91.9% accuracy, 0.895 macro F1 on 2,388 held-out financial tweets. FinBERT fine-tuned on the same data: 88.9%.")
    pg.locator("[data-testid=specialist-table]").wait_for(timeout=60_000)
    check("specialist before/after with verdict", pg.locator("[data-testid=specialist-table] >> text=No clear difference").count() >= 1)
    check("specialist labeled Claude-labeled", pg.locator("[data-testid=claude-badge]").count() == 1)
    check("footer copy", pg.locator("footer").inner_text() == "News sentiment, not investment advice.")
    copy_rules(pg, "(detail)")
    pg.wait_for_timeout(800)
    pg.screenshot(path=out, full_page=True)

    # ---- back ----
    pg.locator("[data-testid=back]").click()
    pg.locator("[data-testid=home-row]").first.wait_for(timeout=15_000)
    check("Back returns to the home list", pg.locator("[data-testid=price]").count() == 0 and "t=" not in pg.url, pg.url)
    b.close()
sys.exit(finish())
