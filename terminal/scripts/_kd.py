"""Shared helpers for the Knight-Daddy UI smoke tests (Playwright)."""
import re

ADVICE = re.compile(r"\b(buy|buys|buying|sell|sells|selling|hold|holds|holding)\b", re.I)
SIMULATED = re.compile(r"\b(demo data|simulated|pre-written|demo figures|demo assistant)\b", re.I)
ACCOUNT = re.compile(r"\b(balance|balances|portfolio|holdings|your position|cash balance)\b", re.I)  # we have no accounts
HOME = ["AAPL", "MSFT", "TSLA", "AMZN", "NVDA", "DDOG"]
checks, errors = [], []


def check(name, ok, detail=""):
    checks.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def watch_errors(pg):
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))


def load(pg, url, ticker):
    """Fresh home page, then open `ticker`: tap its home row, or search for it when it has no row."""
    pg.goto(url); pg.evaluate("localStorage.clear()"); pg.reload()
    row = pg.locator(f"[data-testid=home-row][data-ticker={ticker}]")
    if ticker in HOME:
        row.wait_for(timeout=60_000); row.click()
    else:
        pg.fill("input[aria-label=Ticker]", ticker); pg.press("input[aria-label=Ticker]", "Enter")
    pg.locator("[data-testid=price]").wait_for(timeout=60_000)


def ui_text(pg):
    """Visible UI copy, excluding third-party headline titles (quoted as published)."""
    return pg.evaluate("""() => { const c = document.body.cloneNode(true);
      c.querySelectorAll('[data-testid=headline] a, [data-testid=headline] span.leading-snug').forEach(e => e.remove());
      return c.innerText; }""")


def copy_rules(pg, label=""):
    t = ui_text(pg)
    check(f"no em dashes in UI text {label}", "\u2014" not in t)
    bad = ADVICE.findall(re.sub(r"buy-and-hold", "", t, flags=re.I))
    check(f"no buy/sell/hold in UI text {label}", not bad, ", ".join(bad[:5]))
    check(f"no demo or simulated labels {label}", not SIMULATED.search(t))
    check(f"no balances, holdings or portfolio wording {label}", not ACCOUNT.search(t), ", ".join(ACCOUNT.findall(t)[:3]))
    check(f"no crypto in the app {label}", not re.search(r"\bcrypto", t, re.I))


def finish():
    check("no browser console errors", not errors, "; ".join(errors[:3]))
    print("ALL PASS" if all(checks) else "SOME CHECKS FAILED")
    return 0 if all(checks) else 1
