"""End-to-end test of press-to-talk on a stock page: the microphone is replaced by recorded spoken questions
(fixtures/talk_q*.wav, made with macOS `say`), so the real chain runs: hold Talk, release, transcription
(/api/talk/stt), answer from the headlines (/api/talk) with the conversation's memory, spoken answer (/api/talk/audio).
The browser's own recognizer is removed so the recorded clip path is exercised every time.
Usage: python scripts/talk_voice_smoke_test.py [base_url] [ticker] [out.png]"""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
from _kd import check, copy_rules, finish, load, watch_errors

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ticker = sys.argv[2] if len(sys.argv) > 2 else "NVDA"
out = sys.argv[3] if len(sys.argv) > 3 else "talk_voice.png"
FIX = pathlib.Path(__file__).parent / "fixtures"
FAKE_MIC = """
delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
window.__clip = null;
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await (await fetch(window.__clip)).arrayBuffer());
  const src = ctx.createBufferSource(); src.buffer = buf;
  const dst = ctx.createMediaStreamDestination(); src.connect(dst); src.start();
  return dst.stream;
};"""
DECLINE = "I only explain the news, not what to trade."

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1100, "height": 1000})
    watch_errors(pg)
    pg.add_init_script(FAKE_MIC)
    pg.route("**/__clip/*", lambda r: r.fulfill(body=(FIX / r.request.url.rsplit("/", 1)[1]).read_bytes(), content_type="audio/wav"))
    load(pg, url, ticker)
    brief = pg.locator("section[aria-label=Briefing]")
    brief.locator("[data-testid=talk]").wait_for(timeout=90_000)
    brief.locator("[data-testid=talk]").click()
    hold = brief.locator("[data-testid=talk-hold]")
    check("press-to-talk button, no text box by default", hold.count() == 1 and brief.locator("[data-testid=talk-input]").count() == 0)
    check("idle label says Hold to talk", brief.locator("[data-testid=talk-state]").inner_text() == "Hold to talk")

    def say(clip, seconds):
        n = brief.locator("[data-testid=talk-answer]").count()
        pg.evaluate(f"window.__clip = '/__clip/{clip}'")
        hold.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        box = hold.bounding_box(); pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.mouse.down(); pg.wait_for_timeout(500)
        state = brief.locator("[data-testid=talk-state]").inner_text()
        pg.wait_for_timeout(int(seconds * 1000)); pg.mouse.up()
        brief.locator("[data-testid=talk-answer]").nth(n).or_(brief.locator("[data-testid=talk-error]")).first.wait_for(timeout=90_000)
        if brief.locator("[data-testid=talk-error]").count():
            return state, brief.locator("[data-testid=talk-error]").inner_text(), "", 0
        heard = brief.locator("[data-testid=talk-heard]").nth(n).inner_text()
        ans = brief.locator("[data-testid=talk-answer]").nth(n).inner_text()
        srcs = brief.locator("[data-testid=talk-turns] > li").nth(n).locator("[data-testid=talk-sources] li").count()
        return state, heard, ans, srcs

    state, heard, ans, srcs = say("talk_q1.wav", 3.2)
    check("while held it says Listening", state.startswith("Listening"), state)
    check("speech transcribed", "quantum" in heard.lower(), heard)
    covered = srcs >= 1 and re.search(r"\[\d+\]", ans)
    check("answer grounded: cites headlines, or says they don't cover it", not ans.startswith(DECLINE) and
          (covered or re.search(r"(do not|don't|does not) (say|mention|cover)|no headlines", ans, re.I)), f"{srcs} sources: {ans[:120]}")
    pg.locator("[data-testid=talk-hear] >> text=Stop").first.wait_for(timeout=60_000)
    check("answer is spoken (ElevenLabs audio playing)", True)
    check("label invites another question", brief.locator("[data-testid=talk-state]").inner_text() == "Hold to ask again")

    state, heard, ans, srcs = say("talk_q2.wav", 2.0)
    check("follow-up transcribed", "more" in heard.lower(), heard)
    check("follow-up answered with memory of the topic", "quantum" in ans.lower() and not ans.startswith(DECLINE), ans[:160])

    state, heard, ans, srcs = say("talk_q3.wav", 2.8)
    check("advice question transcribed", "buy" in heard.lower(), heard)
    check("advice question declined with the short line", ans.startswith(DECLINE) and srcs == 0, ans)

    for x in ("What price target do analysts have?", "Is it a good investment?"):
        n = brief.locator("[data-testid=talk-answer]").count()
        if brief.locator("[data-testid=talk-type]").count(): brief.locator("[data-testid=talk-type]").click()
        brief.locator("[data-testid=talk-input]").fill(x); brief.locator("[data-testid=talk-ask]").click()
        brief.locator("[data-testid=talk-answer]").nth(n).wait_for(timeout=30_000)
        check(f"typed advice question declined: {x}", brief.locator("[data-testid=talk-answer]").nth(n).inner_text().startswith(DECLINE))
    answers = [x.inner_text() for x in brief.locator("[data-testid=talk-answer]").all()]
    check("no em dashes in answers", not any("—" in a for a in answers))
    copy_rules(pg, "(talk)")
    brief.screenshot(path=out)
    b.close()
sys.exit(finish())
