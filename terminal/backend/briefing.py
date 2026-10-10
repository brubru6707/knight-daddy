"""Stretch 9 and 10: Gemini news briefing grounded only in today's model-tagged headlines, and ElevenLabs audio.

Guardrails: the prompt forbids outside facts, price predictions and advice; the output is checked against
advice/prediction patterns, regenerated once if it fails, and otherwise replaced by a plain non-AI summary.
Briefings are cached by headline set and regenerated only when that set changes, at most once per
BRIEFING_MIN_MINUTES per ticker (default 60). If Gemini fails (e.g. quota), the ticker's last good briefing is served.
Audio is only generated for briefings this server produced.
"""
import hashlib, json, os, re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from news import key

CACHE = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/scratch/poc1/terminal"))) / "briefings"
CACHE.mkdir(parents=True, exist_ok=True)
ET = ZoneInfo("America/New_York")
MAX_HEADLINES = 25

SYSTEM = """You write a short news briefing for a stock research dashboard.
Rules, all mandatory:
- Use ONLY the headlines provided. Do not add facts, numbers, names or context that are not in them.
- Write ONE paragraph, at most 90 words, plain text, no bullet points, no markdown.
- Describe what the headlines are about and the mix of sentiment tags (the counts are given; use them exactly).
- Never predict prices or returns, never say what the stock will do, never give investment or trading advice,
  never tell anyone to buy, sell or hold.
- If the headlines are mostly not about the company, say so."""

# phrases that indicate a prediction or advice; checked case-insensitively on the model output
BANNED = re.compile(r"\b(you should|investors should|we recommend|recommend(ed|s)? (buying|selling)|buy now|sell now|"
                    r"good time to (buy|sell)|consider (buying|selling)|(is|are) (likely|poised|set|expected) to (rise|fall|climb|drop|gain|surge|rally)|"
                    r"will (likely )?(rise|fall|climb|drop|gain|surge|rally|outperform|underperform)|price will|"
                    r"strong buy|should (buy|sell|hold))\b", re.I)


def pick_window(items):
    """Today's headlines (US/Eastern); fall back to the last 24 h, then to the 15 most recent."""
    def ts(i):
        try:
            return datetime.fromisoformat(i["time"].replace("Z", "+00:00"))
        except Exception:
            return None
    dated = [(ts(i), i) for i in items if i.get("label") and ts(i)]
    now = datetime.now(timezone.utc)
    today = [i for t, i in dated if t.astimezone(ET).date() == now.astimezone(ET).date()]
    if len(today) >= 3:
        return today[:MAX_HEADLINES], f"today ({now.astimezone(ET):%b %d} ET)"
    day = [i for t, i in dated if now - t <= timedelta(hours=24)]
    if len(day) >= 3:
        return day[:MAX_HEADLINES], "last 24 hours (fewer than 3 headlines today)"
    recent = [i for _, i in sorted(dated, key=lambda x: x[0], reverse=True)][:15]
    return recent, "most recent headlines (fewer than 3 in the last 24 hours)"


def _gemini(prompt, strict=False):
    model = key("GEMINI_MODEL") or "gemini-3.5-flash"  # 2.5-flash is closed to new keys (2026-10)
    sys_text = SYSTEM + ("\n- Your previous answer broke a rule. Describe the headlines only; no predictions or advice." if strict else "")
    # Thinking tokens count against maxOutputTokens: a 1024 budget truncated briefings mid-sentence (2026-10-09).
    gen_config = {"temperature": 0.2, "maxOutputTokens": 4096}
    if model.startswith("gemini-3"):
        gen_config["thinkingConfig"] = {"thinkingLevel": "low"}
    r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                      headers={"x-goog-api-key": key("GEMINI_API_KEY"), "content-type": "application/json"},
                      json={"systemInstruction": {"parts": [{"text": sys_text}]},
                            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                            "generationConfig": gen_config}, timeout=60)
    if r.status_code != 200:
        msg = r.json().get("error", {}).get("message", "") if r.headers.get("content-type", "").startswith("application/json") else ""
        raise RuntimeError(f"Gemini HTTP {r.status_code}: {msg[:200]}")
    cand = r.json()["candidates"][0]
    text = " ".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []) if not p.get("thought")).strip()
    return model, text, cand.get("finishReason", "")


def plain_summary(ticker, n, counts, window):
    return (f"{n} headlines about {ticker}, {window}: {counts['Bullish']} tagged bullish, "
            f"{counts['Bearish']} bearish and {counts['Neutral']} neutral by our model. "
            f"See the headline feed for the individual stories.")


def generate(ticker, items, refresh=False):
    if not key("GEMINI_API_KEY"):
        return {"status": "no_key", "message": "GEMINI_API_KEY is not set in terminal/.env"}
    chosen, window = pick_window(items)
    if not chosen:
        return {"status": "no_headlines", "message": f"No tagged headlines for {ticker} to summarize."}
    counts = {l: sum(i["label"] == l for i in chosen) for l in ("Bullish", "Bearish", "Neutral")}
    lines = "\n".join(f"- [{i['label']}] {i['title']} ({i.get('source', '')})" for i in chosen)
    prompt = (f"Ticker: {ticker}\nWindow: {window}\nTag counts from our sentiment model: {counts['Bullish']} bullish, "
              f"{counts['Bearish']} bearish, {counts['Neutral']} neutral ({len(chosen)} headlines).\nHeadlines:\n{lines}")
    # Same headlines in any order = same briefing (v3: order-independent, ignores the window wording).
    hset = sorted(f"{i['label']}|{i['title']}" for i in chosen)
    bid = hashlib.sha1(("v3" + key("GEMINI_MODEL") + ticker + "\n".join(hset)).encode()).hexdigest()[:16]
    f = CACHE / f"{bid}.json"
    last = CACHE / f"last_{ticker}.json"
    if f.exists() and not refresh:
        return {**json.loads(f.read_text()), "cached": True}
    min_age = timedelta(minutes=float(key("BRIEFING_MIN_MINUTES") or 60))
    if last.exists() and not refresh:
        prev = json.loads(last.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(prev["generated_at"]) < min_age:
            return {**prev, "cached": True}
    def bad(text, finish):  # advice/prediction, empty, or cut off before the model finished
        return BANNED.search(text) or not text or finish != "STOP"
    try:
        model, text, finish = _gemini(prompt)
    except RuntimeError:
        if last.exists():  # quota or outage: keep showing the last good briefing for this ticker
            return {**json.loads(last.read_text()), "cached": True, "stale": True}
        raise
    guard = "passed"
    if bad(text, finish):
        model, text, finish = _gemini(prompt, strict=True)
        guard = "regenerated once"
        if bad(text, finish):
            text, guard = plain_summary(ticker, len(chosen), counts, window), "AI text rejected; plain summary shown"
    res = {"status": "ok", "id": bid, "ticker": ticker, "text": text, "window": window, "n": len(chosen),
           "counts": counts, "model": model, "guard": guard,
           "generated_at": datetime.now(timezone.utc).isoformat(),
           "headlines": [{"title": i["title"], "label": i["label"], "source": i.get("source", "")} for i in chosen]}
    f.write_text(json.dumps(res))
    last.write_text(json.dumps(res))
    return {**res, "cached": False}


def speak(bid):
    """MP3 path for a briefing this server generated (ElevenLabs text-to-speech, cached)."""
    if not re.fullmatch(r"[0-9a-f]{16}", bid or ""):
        raise ValueError("bad briefing id")
    f = CACHE / f"{bid}.json"
    if not f.exists():
        raise FileNotFoundError("unknown briefing id")
    mp3 = CACHE / f"{bid}.mp3"
    if mp3.exists():
        return mp3
    if not key("ELEVENLABS_API_KEY"):
        raise PermissionError("ELEVENLABS_API_KEY is not set in terminal/.env")
    voice = key("ELEVENLABS_VOICE_ID") or "JBFqnCBsd6RMkjVDRZzb"  # premade "George"; override in .env
    r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                      params={"output_format": "mp3_44100_128"},
                      headers={"xi-api-key": key("ELEVENLABS_API_KEY"), "content-type": "application/json"},
                      json={"text": json.loads(f.read_text())["text"],
                            "model_id": key("ELEVENLABS_MODEL") or "eleven_flash_v2_5"}, timeout=60)
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("audio"):
        detail = ""
        try:
            detail = str(r.json().get("detail", ""))[:200]
        except Exception:
            pass
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code} {detail}")
    mp3.write_bytes(r.content)
    return mp3
