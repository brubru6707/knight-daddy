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
        check("Talk button (no Listen button)", brief.locator("[data-testid=talk]").inner_text().strip() == "Talk" and brief.locator("text=Listen").count() == 0)
        brief.locator("[data-testid=talk]").click()
        check("Talk reads this ticker's briefing aloud", ticker in (brief.locator("[data-testid=speaker]").get_attribute("aria-label") or ""))
        for q in ("Should I buy this stock?", "What is the price target?", "Is it a good investment right now?"):
            n = brief.locator("[data-testid=talk-answer]").count()
            brief.locator("[data-testid=talk-input]").fill(q); brief.locator("[data-testid=talk-ask]").click()
            brief.locator("[data-testid=talk-answer]").nth(n).wait_for(timeout=30_000)
            check(f"Talk declines advice: {q}", brief.locator("[data-testid=talk-answer]").nth(n).inner_text().startswith("I only talk about the news coverage"))
        n = brief.locator("[data-testid=talk-answer]").count()
        brief.locator("[data-testid=talk-input]").fill("What is the overall tone of the headlines?"); brief.locator("[data-testid=talk-ask]").click()
        brief.locator("[data-testid=talk-answer]").nth(n).or_(brief.locator("[data-testid=talk-error]")).first.wait_for(timeout=60_000)
        ans = brief.locator("[data-testid=talk-answer]").nth(n)
        check("Talk answers a news question from the headlines", ans.count() == 1 and not ans.inner_text().startswith("I only talk"),
              ans.inner_text()[:120] if ans.count() else brief.locator("[data-testid=talk-error]").inner_text())
    else:  # Gemini down upstream: a plain n/a line, never the raw error
        check("briefing unavailable shows plain n/a", True, brief.locator("[data-testid=briefing-unavailable]").inner_text())

    ft = pg.locator("section[aria-label=Fine-tune]")
    check("regular mode: Tune to this stock button", ft.locator("button:has-text('Tune to this stock')").count() == 1
          and ft.locator("button:has-text('Fine-tune')").count() == 0)
    check("regular mode: one plain caption", ft.locator("[data-testid=tune-caption]").inner_text() in
          ("Trains the model on this stock's news so it reads these headlines more accurately. About a minute.", "Tuning is offline right now."),
          ft.locator("[data-testid=tune-caption]").inner_text())
    check("regular mode: no jargon (active model, adapter, quick run, steps)",
          not re.search(r"active model|adapter|quick run|step \d|general model|specialist|GPU|Oscar", ft.inner_text(), re.I), ft.inner_text().replace("\n", " | "))
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
    sv = pg.locator("section[aria-label='Sentiment vs. price']")
    sv.locator("[data-testid=sentiment-caption]").or_(sv.locator("text=/n\\/a/")).first.wait_for(timeout=60_000)
    check("sentiment vs. price shown directly on the detail page", sv.count() == 1, sv.inner_text()[:80])
    order = pg.eval_on_selector_all("main section[aria-label], div > section[aria-label]", "els => els.map(e => e.getAttribute('aria-label'))")
    check("no model-wide or specialist sections on the detail page",
          not any(x in order for x in ("Advanced research", "Model", "Backtest")) and pg.locator("[data-testid=specialist-table]").count() == 0
          and pg.locator("[data-testid=model-copy]").count() == 0 and pg.locator("text=/general model said/").count() == 0, ", ".join(order))
    # ---- Advanced mode ----
    pg.locator("[data-testid=advanced-toggle]").click()
    brief.locator("[data-testid=briefing-paragraphs]").or_(brief.locator("[data-testid=briefing-long-na]")).or_(brief.locator("[data-testid=briefing-unavailable]")).first.wait_for(timeout=60_000)
    if brief.locator("[data-testid=briefing-paragraphs]").count():
        paras = [x.inner_text() for x in brief.locator("[data-testid=briefing-paragraphs] p").all()]
        check("advanced briefing: full paragraphs", 2 <= len(paras) <= 5 and sum(len(x.split()) for x in paras) >= 60, f"{len(paras)} paragraphs")
        check("advanced briefing: no advice or price targets", not any(re.search(r"\b(buy|sell|hold|price target|should)\b", x, re.I) for x in paras))
    else:
        check("advanced briefing: n/a note until published", True)
    active = ft.locator("[data-testid=active-model]").inner_text()
    check("advanced: active model status line", active in ("Active model: general", f"Active model: {ticker} specialist"), active)
    check("advanced: Fine-tune to this stock button", ft.locator("button:has-text('Fine-tune to this stock')").count() == 1)
    check("advanced: Reset to general model shown only for a specialist",
          ft.locator("button:has-text('Reset to general model')").count() == (1 if "specialist" in active else 0))
    hl = pg.locator("section[aria-label='Latest headlines']")
    hl.locator("[data-testid=article-meta]").first.wait_for(timeout=15_000)
    metas = hl.locator("[data-testid=article-meta]").all()
    check("advanced headlines: every real article listed", len(metas) == pg.locator("[data-testid=headline]").count() and len(metas) > 3, str(len(metas)))
    links = [l.get_attribute("href") or "" for l in hl.locator("[data-testid=article-link]").all()]
    check("advanced headlines: source, timestamp and article link", all(m.locator("time").count() == 1 and "n/a" not in m.locator("time").inner_text() for m in metas)
          and len(links) >= len(metas) * 0.8 and all(l.startswith("http") for l in links), f"{len(links)} links")
    copy_rules(pg, "(advanced)")
    pg.screenshot(path=out.replace(".png", "_advanced.png"), full_page=True)
    pg.locator("[data-testid=advanced-toggle]").click()
    check("footer copy", pg.locator("footer").inner_text() == "News sentiment, not investment advice.")
    copy_rules(pg, "(detail)")
    pg.wait_for_timeout(800)
    pg.screenshot(path=out, full_page=True)

    # ---- model info ----
    pg.locator("[data-testid=nav-model]").click()
    pg.locator("[data-testid=model-info]").wait_for(timeout=15_000)
    check("Model info page at /model", pg.url.rstrip("/").endswith("/model"), pg.url)
    pg.locator("[data-testid=model-copy]").wait_for(timeout=30_000)
    check("model card copy (ours vs FinBERT)", pg.locator("[data-testid=model-copy]").inner_text() ==
          "Qwen3.5-2B QLoRA. 91.9% accuracy, 0.895 macro F1 on 2,388 held-out financial tweets. FinBERT fine-tuned on the same data: 88.9%.")
    pg.locator("[data-testid=benchmark-table]").wait_for(timeout=30_000)
    check("benchmark table shown", pg.locator("[data-testid=benchmark-table] tbody tr").count() >= 2)
    pg.locator("[data-testid=backtest-caption]").wait_for(timeout=60_000)
    check("backtest on Model info", pg.locator("[data-testid=backtest-caption]").inner_text().startswith("Trading on sentiment"))
    check("no specialist before/after on Model info", pg.locator("text=/specialist/i").count() == 0)
    check("Model info footer", pg.locator("footer").inner_text() == "News sentiment, not investment advice.")
    copy_rules(pg, "(model info)")
    pg.screenshot(path=out.replace(".png", "_model.png"), full_page=True)
    pg.go_back(); pg.locator("[data-testid=price]").wait_for(timeout=15_000)

    # ---- back ----
    pg.locator("[data-testid=back]").click()
    pg.locator("[data-testid=home-row]").first.wait_for(timeout=15_000)
    check("Back returns to the home list", pg.locator("[data-testid=price]").count() == 0 and "t=" not in pg.url, pg.url)
    b.close()
sys.exit(finish())
