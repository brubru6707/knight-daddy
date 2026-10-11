"""End-to-end test of hands-free Talk on a stock page.
Part A (browsers with speech recognition): a scripted recognizer streams words the way Chrome's does, so the real flow
runs: tap the mic, speech without "Hey KD" is ignored, "Hey KD <question>" is sent after a pause, the answer comes from
the headlines (/api/talk) with the conversation's memory and is spoken (/api/talk/audio), then it listens for the next
"Hey KD"; tapping the mic again ends it.
Part B (no speech recognition): tap to record a real spoken clip (fixtures/talk_q1.wav, macOS `say`), tap to send;
it is transcribed by /api/talk/stt and answered.
Usage: python scripts/talk_voice_smoke_test.py [base_url] [ticker] [out.png]"""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
from _kd import check, copy_rules, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ticker = sys.argv[2] if len(sys.argv) > 2 else "NVDA"
out = sys.argv[3] if len(sys.argv) > 3 else "talk_voice.png"
FIX = pathlib.Path(__file__).parent / "fixtures"
NO_CALLS, NO_AI = "I don't call prices.", "I can't reach the AI right now"
FAKE_SR = """
class FakeSR {
  start() { window.__sr = this; this.running = true; this.text = ""; window.__starts = (window.__starts || 0) + 1; }
  stop() { this._end(); } abort() { this._end(); }
  _end() { if (!this.running) return; this.running = false; setTimeout(() => this.onend && this.onend(), 10); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
window.__say = async (utter) => {
  const r = window.__sr; if (!r || !r.running) return "not listening";
  for (const w of utter.split(" ")) {
    r.text = (r.text ? r.text + " " : "") + w;
    r.onresult && r.onresult({ results: [[{ transcript: r.text }]] });
    await new Promise((ok) => setTimeout(ok, 120));
  }
  return "ok";
};"""
FAKE_MIC = """
delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await (await fetch('/__clip/talk_q1.wav')).arrayBuffer());
  const src = ctx.createBufferSource(); src.buffer = buf;
  const dst = ctx.createMediaStreamDestination(); src.connect(dst); src.start();
  return dst.stream;
};"""
WAITING = "Say “Hey KD”, then your question. Tap to stop."

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    # ---- Part A: "Hey KD" ----
    pg = b.new_page(viewport={"width": 1100, "height": 1000})
    watch_errors(pg)
    pg.add_init_script(FAKE_SR)
    load(pg, url, ticker)
    brief = pg.locator("section[aria-label=Briefing]")
    brief.locator("[data-testid=talk]").wait_for(timeout=90_000)
    brief.locator("[data-testid=talk]").click()
    mic, state = brief.locator("[data-testid=talk-hold]"), brief.locator("[data-testid=talk-state]")
    answers = brief.locator("[data-testid=talk-answer]")
    check("one mic button, no text box by default", mic.count() == 1 and brief.locator("[data-testid=talk-input]").count() == 0)
    check("idle: Tap to start talking", state.inner_text() == "Tap to start talking")
    mic.click()
    check("one tap starts listening for Hey KD", state.inner_text() == WAITING and mic.get_attribute("aria-pressed") == "true", state.inner_text())

    pg.evaluate("window.__say('so what is everyone up to today')"); pg.wait_for_timeout(3500)
    check("speech without Hey KD is ignored", answers.count() == 0 and state.inner_text() == WAITING)

    def turn(utter):
        n = answers.count()
        pg.evaluate(f"window.__say({utter!r})")
        answers.nth(n).or_(brief.locator("[data-testid=talk-error]")).first.wait_for(timeout=90_000)
        heard = brief.locator("[data-testid=talk-heard]").nth(n).inner_text()
        ans = answers.nth(n).inner_text()
        srcs = brief.locator("[data-testid=talk-turns] > li").nth(n).locator("[data-testid=talk-sources] li").count()
        return heard, ans, srcs

    heard, ans, srcs = turn("hey KD what are the headlines saying about quantum computing")
    check("Hey KD wakes it; only the question is kept", heard == "You: what are the headlines saying about quantum computing", heard)
    check("answer from Gemini, grounded in headlines (or says they don't cover it)", not ans.startswith(NO_AI) and
          (srcs >= 1 or re.search(r"(do not|don't|does not|doesn't) (say|mention|cover)|no headlines", ans, re.I)), f"{srcs} sources: {ans[:120]}")
    check("no [n] citations or match counts in the answer", not re.search(r"\[\d+\]|headlines match", ans), ans[:120])
    brief.locator("[data-testid=talk-hear] >> text=Stop").first.wait_for(timeout=60_000)
    check("answer is spoken while the mic pauses", state.inner_text().startswith("Answering"), state.inner_text())
    pg.wait_for_function(f"document.querySelector('[data-testid=talk-state]').innerText === {WAITING!r}", timeout=120_000)
    check("after speaking it listens for the next Hey KD", True)

    heard, ans, srcs = turn("hey Katie tell me more about that")
    check("misheard wake phrase (Hey Katie) still works", heard == "You: tell me more about that", heard)
    check("follow-up keeps the conversation's memory", not ans.startswith(NO_AI) and len(ans) > 30, ans[:160])
    pg.wait_for_function(f"document.querySelector('[data-testid=talk-state]').innerText === {WAITING!r}", timeout=120_000)

    heard, ans, srcs = turn("hey KD should I buy Nvidia stock right now")
    check("trading question: short no-calls line, then the news", ans.startswith(NO_CALLS) and len(ans) > 60, ans[:160])
    pg.wait_for_timeout(1500)
    mic.click()
    check("second tap ends the conversation", state.inner_text() == "Tap to talk again" and mic.get_attribute("aria-pressed") == "false", state.inner_text())
    pg.evaluate("window.__say('hey KD are you still there')"); pg.wait_for_timeout(3000)
    check("nothing is heard after it is tapped off", answers.count() == 3)
    check("no em dashes in answers", not any("—" in a for a in [x.inner_text() for x in answers.all()]))
    copy_rules(pg, "(talk)")
    brief.screenshot(path=out)
    pg.close()

    # ---- Part B: no browser speech recognition: tap to record, tap to send ----
    pg = b.new_page(viewport={"width": 1100, "height": 1000})
    pg.add_init_script(FAKE_MIC)
    pg.route("**/__clip/*", lambda r: r.fulfill(body=(FIX / r.request.url.rsplit("/", 1)[1]).read_bytes(), content_type="audio/wav"))
    load(pg, url, ticker)
    brief = pg.locator("section[aria-label=Briefing]")
    brief.locator("[data-testid=talk]").wait_for(timeout=90_000); brief.locator("[data-testid=talk]").click()
    brief.locator("[data-testid=talk-hold]").click(); pg.wait_for_timeout(600)
    check("fallback: tap starts recording", brief.locator("[data-testid=talk-state]").inner_text() == "Listening… tap to send")
    pg.wait_for_timeout(3200); brief.locator("[data-testid=talk-hold]").click()
    brief.locator("[data-testid=talk-answer]").or_(brief.locator("[data-testid=talk-error]")).first.wait_for(timeout=90_000)
    got = brief.locator("[data-testid=talk-heard]").all_inner_texts() or brief.locator("[data-testid=talk-error]").all_inner_texts()
    check("fallback: recorded speech transcribed and answered", any("quantum" in x.lower() for x in got), "; ".join(got))
    b.close()
sys.exit(finish())
