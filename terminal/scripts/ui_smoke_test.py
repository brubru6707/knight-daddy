"""Headless UI smoke test of the Knight-Daddy layout: price, headlines, AI column, competitors, advanced research,
exact copy and copy rules. Usage: python scripts/ui_smoke_test.py [base_url] [ticker] [out.png]"""
import sys
from playwright.sync_api import sync_playwright
from _kd import check, copy_rules, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ticker = sys.argv[2] if len(sys.argv) > 2 else "NVDA"
out = sys.argv[3] if len(sys.argv) > 3 else "screenshot.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    watch_errors(pg)
    load(pg, url, ticker)
    pg.locator("text=/^[+-]\\$[0-9,.]+ \\([+-][0-9.]+%\\)/").wait_for(timeout=60_000)
    check("price and period change", pg.locator("[data-testid=price]").inner_text().startswith("$"), pg.locator("[data-testid=price]").inner_text())
    pg.locator("[aria-label=Period] >> text=1Y").click()
    pg.locator("text=/(Up|Down) over 1 year/").wait_for(timeout=30_000)
    check("period buttons switch the chart", True)
    pg.locator("[data-testid=headline]").first.wait_for(timeout=150_000)
    check("3 headlines shown first", pg.locator("[data-testid=headline]").count() == 3)
    tags = pg.locator("[data-testid=headline] >> text=/^(Bullish|Bearish|Neutral)$/").count()
    check("headlines carry a Bullish/Bearish/Neutral tag", tags == 3, f"{tags}/3")
    pg.locator("text=/^View all \\d+$/").click()
    check("View all expands the list", pg.locator("[data-testid=headline]").count() > 3, str(pg.locator("[data-testid=headline]").count()))
    pg.locator("text=Show fewer headlines").click()
    pg.locator("[data-testid=tone]").or_(pg.locator("[data-testid=briefing-unavailable]")).wait_for(timeout=90_000)
    if pg.locator("[data-testid=tone]").count():
        n = pg.locator("[data-testid=briefing-bullets] li").count()
        check("AI column: tone line plus 1 to 4 bullets", 1 <= n <= 4, pg.locator("[data-testid=tone]").inner_text() + f", {n} bullets")
        check("AI column: sentiment breakdown with counts", pg.locator("[data-testid=breakdown] li").count() == 3)
    else:  # Gemini down upstream: a plain n/a line, never the raw error
        check("AI column: summary unavailable shows plain n/a", True, pg.locator("[data-testid=briefing-unavailable]").inner_text())
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
    copy_rules(pg)
    pg.wait_for_timeout(800)
    pg.screenshot(path=out, full_page=True)
    b.close()
sys.exit(finish())
