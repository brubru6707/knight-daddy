"""Crypto rows and pages: general-model tone pill, confidence bar and caption; Advanced adds the crypto model's tag on
each headline; Model info has the Crypto model card. Also Talk's Gemini/error label in Advanced.
Usage: python scripts/crypto_smoke_test.py [base_url] [out_dir]"""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
from _kd import check, copy_rules, finish, set_advanced, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "."); out.mkdir(parents=True, exist_ok=True)
CAP = "Tagged by our general model (65.8% on crypto headlines)."

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 430, "height": 932}, device_scale_factor=2)
    watch_errors(pg)
    pg.goto(url); pg.evaluate("localStorage.clear(); localStorage.setItem('kd.onboarded', 'true')"); pg.reload()
    sec = pg.locator("section[aria-label=Crypto]")
    sec.locator("[data-testid=home-row]").first.wait_for(timeout=60_000)
    pg.wait_for_timeout(2500)
    check("home crypto caption", CAP in sec.inner_text())
    pills = sec.locator("[data-testid=home-row]:has-text('Bullish'), [data-testid=home-row]:has-text('Neutral'), [data-testid=home-row]:has-text('Bearish')").count()
    check("crypto rows show a tone pill", pills >= 1, f"{pills} rows with a pill")
    sec.screenshot(path=str(out / "crypto_home_rows.png"))

    sec.locator("[data-testid=home-row][data-ticker=BTC-USD]").click()
    pg.locator("[data-testid=crypto-detail]").wait_for(timeout=30_000)
    pg.locator("[data-testid=headline]").first.wait_for(timeout=60_000)
    check("BTC confidence bar from the general model", pg.locator("[data-testid=confidence]").count() == 1)
    check("bar caption", pg.locator("[data-testid=crypto-bar-caption]").inner_text() == CAP)
    check("headline caption", pg.locator("[data-testid=crypto-caption]").inner_text() == CAP)
    check("no crypto model tag when Advanced is off", pg.locator("[data-testid=crypto-model-tag]").count() == 0)
    pg.screenshot(path=str(out / "crypto_btc_normal.png"), full_page=True)

    set_advanced(pg, True); pg.wait_for_timeout(800)
    tags = pg.locator("[data-testid=crypto-model-tag]")
    check("Advanced: 'Crypto model' tag beside each general tag", tags.count() == pg.locator("[data-testid=headline]").count() and tags.count() > 0
          and all(t.inner_text().startswith("Crypto model") for t in tags.all()), f"{tags.count()} tags")
    vals = [t.inner_text().split("\n")[-1] for t in tags.all()]
    check("crypto model values are real tags or n/a", all(v in ("Bullish", "Neutral", "Bearish", "n/a") for v in vals), str(vals[:5]))
    if all(v == "n/a" for v in vals):
        check("says when the crypto model has not been pushed yet", pg.locator("[data-testid=crypto-model-pending]").count() == 1)
    pg.locator("[data-testid=headline]").first.scroll_into_view_if_needed()
    pg.screenshot(path=str(out / "crypto_btc_advanced.png"), full_page=True)
    copy_rules(pg, "(crypto)")

    pg.locator("[data-testid=nav-model]").click()
    card = pg.locator("[data-testid=crypto-model-card]"); card.wait_for(timeout=30_000)
    t = card.inner_text()
    check("Model info: Crypto model card", "Fine-tuning helped on crypto social posts (+20 pts) but tied on news headlines, so headlines use the general model." in t)
    check("card table: three models, posts and headlines", card.locator("tbody tr").count() == 3 and "72.3%" in t and "65.8%" in t and "43.2%" in t)
    check("card label", "Claude-labeled, needs human spot-check." in t)
    copy_rules(pg, "(model info)")
    card.screenshot(path=str(out / "crypto_model_card.png"))

    # Talk in Advanced: the engine label under each answer
    pg.goto(f"{url}/?t=NVDA")
    brief = pg.locator("section[aria-label=Briefing]")
    brief.locator("[data-testid=talk]").wait_for(timeout=90_000); brief.locator("[data-testid=talk]").click()
    brief.locator("[data-testid=talk-type]").click()
    brief.locator("[data-testid=talk-input]").fill("what is the most alarming Nvidia headline?"); brief.locator("[data-testid=talk-ask]").click()
    brief.locator("[data-testid=talk-engine]").first.wait_for(timeout=90_000)
    eng = brief.locator("[data-testid=talk-engine]").first.inner_text()
    ans = brief.locator("[data-testid=talk-answer]").first.inner_text()
    check("Talk (Advanced) labels the answer Gemini", eng.lower() == "gemini", eng)
    check("Talk answer has no [n] or match counts", not re.search(r"\[\d+\]|headlines match", ans), ans[:140])
    brief.locator("[data-testid=talk-panel]").scroll_into_view_if_needed()
    brief.locator("[data-testid=talk-panel]").screenshot(path=str(out / "talk_advanced_label.png"))
    b.close()
sys.exit(finish())
