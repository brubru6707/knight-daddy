"""Stretch 9 and 10: Gemini news briefing grounded only in one ticker's model-tagged headlines, and ElevenLabs audio.
Two formats: "normal" (at most 4 short bullets) and "advanced" (a few paragraphs), cached separately.

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

SYSTEM = """You write the news briefing for ONE stock on a research dashboard. It must be about this ticker's own
headlines, not the market in general.
Rules, all mandatory:
- Use ONLY the numbered headlines provided. Do not add facts, numbers, names, dates or context that are not in them.
- Be specific: name the concrete topics the headlines are about (products, deals, events, people, lawsuits, filings,
  partners, rivals) and which outlets reported them when it helps. No generic market talk ("investors are watching",
  "the market remains volatile", "amid broader trends") unless a headline says exactly that.
- Use the sentiment tag counts exactly as given, once, and say which topics carried the bullish and the bearish tags.
- If several headlines are not really about this company, say how many and leave them out of the summary.
- If there is genuinely little to say, write less. Never pad.
- If headlines report analyst price targets or rating changes, say only that analysts updated their views and
  name the firms; never repeat a target, a rating or a dollar level for the stock.
- Never predict prices or returns, never say what the stock will do, never mention price targets, ratings upgrades
  as advice, or whether to buy, sell, hold or invest. No investment or trading advice of any kind.
- Do not use the words buy, sell, hold (or buying, selling, holding, buys, sells, holds) at all, even to describe a
  headline: write "acquire", "share sales", "stake" or "keeps" instead.
- Plain text, no markdown headings, no bold, no em dashes."""

FORMAT = {
    "normal": "Format: at most 4 bullets, one per line, each starting with \"- \" and at most 15 words. "
              "Lead with the most covered topic. One bullet may give the tag counts.",
    "advanced": "Format: 2 to 4 short paragraphs separated by a blank line, at most 260 words in total. "
                "Paragraph one: the main story or stories and who reported them. Then the other distinct topics. "
                "Last: how the tags split (exact counts) and which stories drove the bullish and bearish ones.",
}

# phrases that indicate a prediction or advice; checked case-insensitively on the model output
BANNED = re.compile(r"\b(you should|investors should|we recommend|recommend(ed|s)? (buying|selling)|buy now|sell now|"
                    r"good time to (buy|sell)|consider (buying|selling)|(is|are) (likely|poised|set|expected) to (rise|fall|climb|drop|gain|surge|rally)|"
                    r"will (likely )?(rise|fall|climb|drop|gain|surge|rally|outperform|underperform)|price will|"
                    r"strong buy|should (buy|sell|hold)|price targets?|target prices?|(raised|lowered|cut|lifted|boosted) (its|their|the) target)\b", re.I)


WORDS = re.compile(r"\b(buy|buys|buying|sell|sells|selling|hold|holds|holding)\b", re.I)  # banned from the text outright


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


def _gemini(prompt, strict=False, mode="normal", why=""):
    model = key("GEMINI_MODEL") or "gemini-3.5-flash"  # 2.5-flash is closed to new keys (2026-10)
    sys_text = SYSTEM + "\n" + FORMAT[mode] + (f"\n- Your previous answer broke a rule{f' (it said: {why!r})' if why else ''}. Describe the headlines only; "
                                               "no predictions, price targets or advice." if strict else "")
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


def plain_summary(ticker, n, counts, window, mode="normal"):
    if mode == "normal":
        return (f"- {n} {ticker} headlines, {window}\n- Tagged {counts['Bullish']} bullish, {counts['Bearish']} bearish, "
                f"{counts['Neutral']} neutral by our model\n- See the headline feed for the individual stories")
    return (f"{n} headlines about {ticker}, {window}: {counts['Bullish']} tagged bullish, "
            f"{counts['Bearish']} bearish and {counts['Neutral']} neutral by our model. "
            f"See the headline feed for the individual stories.")


def generate(ticker, items, refresh=False, mode="normal"):
    mode = mode if mode in FORMAT else "normal"
    if not key("GEMINI_API_KEY"):
        return {"status": "no_key", "message": "GEMINI_API_KEY is not set in terminal/.env"}
    chosen, window = pick_window(items)
    if not chosen:
        return {"status": "no_headlines", "message": f"No tagged headlines for {ticker} to summarize."}
    counts = {l: sum(i["label"] == l for i in chosen) for l in ("Bullish", "Bearish", "Neutral")}
    lines = "\n".join(f"{k}. [{i['label']}] {i['title']} ({i.get('source', '') or 'source n/a'}, {str(i.get('time', ''))[:10]})"
                      for k, i in enumerate(chosen, 1))
    prompt = (f"Ticker: {ticker}\nWindow: {window}\nTag counts from our sentiment model: {counts['Bullish']} bullish, "
              f"{counts['Bearish']} bearish, {counts['Neutral']} neutral ({len(chosen)} headlines).\nHeadlines:\n{lines}")
    # Same headlines in any order = same briefing (v3: order-independent, ignores the window wording).
    # v4: stock-specific prompt with two formats (normal bullets, advanced paragraphs), cached separately.
    hset = sorted(f"{i['label']}|{i['title']}" for i in chosen)
    bid = hashlib.sha1(("v4" + mode + key("GEMINI_MODEL") + ticker + "\n".join(hset)).encode()).hexdigest()[:16]
    f = CACHE / f"{bid}.json"
    last = CACHE / (f"last_{ticker}.json" if mode == "normal" else f"last_{ticker}_{mode}.json")
    if f.exists() and not refresh:
        return {**json.loads(f.read_text()), "cached": True}
    min_age = timedelta(minutes=float(key("BRIEFING_MIN_MINUTES") or 60))
    if last.exists() and not refresh:
        prev = json.loads(last.read_text())
        if datetime.now(timezone.utc) - datetime.fromisoformat(prev["generated_at"]) < min_age:
            return {**prev, "cached": True}
    def bad(text, finish):  # advice/prediction, empty, or cut off before the model finished
        return BANNED.search(text) or WORDS.search(text) or not text or finish != "STOP"
    try:
        model, text, finish = _gemini(prompt, mode=mode)
    except RuntimeError:
        if last.exists():  # quota or outage: keep showing the last good briefing for this ticker
            return {**json.loads(last.read_text()), "cached": True, "stale": True}
        raise
    text = text.replace("\u2014", ", ")
    guard = "passed"
    if bad(text, finish):
        hit = BANNED.search(text or "") or WORDS.search(text or "")
        model, text, finish = _gemini(prompt, strict=True, mode=mode, why=hit.group(0) if hit else "")
        guard = "regenerated once"
        if bad(text, finish):
            text, guard = plain_summary(ticker, len(chosen), counts, window, mode), "AI text rejected; plain summary shown"
    res = {"status": "ok", "id": bid, "ticker": ticker, "mode": mode, "text": text, "window": window, "n": len(chosen),
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
