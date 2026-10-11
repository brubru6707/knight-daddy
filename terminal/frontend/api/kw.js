// KNIGHTWATCH public API (one Vercel function; vercel.json rewrites /api/* here).
//
// Reads are a mirror: the Oscar worker fetches every URL the frontend uses from the real backend and pushes the
// responses (POST /api/snapshot, secret required); GETs replay them. Training is a job queue: the browser creates a
// job (train password), the worker claims it, runs it on Oscar, and pushes progress. One job at a time.
// Secrets come only from env vars: KW_PUSH_SECRET (worker), KW_TRAIN_PASSWORD (Train button), ELEVENLABS_API_KEY
// (read-aloud), TIGER_DB_URL (headline history in Tiger Data, see _lib/tiger.js).
import crypto from "node:crypto";
import { backend, getJSON, setJSON, del, setIfAbsent } from "./_lib/store.js";
import { history, saveHeadlines, tigerOn } from "./_lib/tiger.js";

const STALE_MS = 10 * 60 * 1000;      // a job with no update for 10 min is considered dead
const WORKER_ONLINE_MS = 2 * 60 * 1000; // worker must have polled within 2 min to accept new jobs
const now = () => Date.now();

// Train password check. Both sides are trimmed: a value pasted into Vercel often carries a trailing newline or space.
function same(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// "headlines?ticker=nvda&source=live&refresh=true" -> "headlines?source=live&ticker=NVDA"
export function canonical(path, query = {}) {
  const [p, qs] = String(path).replace(/^\/+|\/+$/g, "").split("?");
  const params = new URLSearchParams(qs || "");
  for (const [k, v] of Object.entries(query)) if (k !== "path") params.set(k, Array.isArray(v) ? v[0] : v);
  params.delete("refresh");
  if (params.has("ticker")) params.set("ticker", params.get("ticker").toUpperCase());
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.length ? `${p}?${new URLSearchParams(sorted).toString()}` : p;
}

function routeOf(req) {
  let p = req.query?.path;
  if (Array.isArray(p)) p = p.join("/");
  if (!p) p = new URL(req.url, "http://x").pathname.replace(/^\/api\/?/, "");
  return String(p).replace(/^\/+|\/+$/g, "");
}

const send = (res, code, body) => res.status(code).json(body);

// ---------- Talk: a press-to-talk conversation about one stock's news and its tone ----------
// The app records while the button is held, sends the clip to talk/stt (ElevenLabs speech-to-text), then the text to
// talk with the last few turns, and plays the answer from talk/audio (ElevenLabs). Answers come only from the real
// headlines.
// Hard rule: news and sentiment only. Every question goes to Gemini with the stock's real headlines and tags; price
// direction and trading questions get "I don't call prices." and then what the news says. If Gemini fails, the answer
// says so plainly ("engine": "error"); there is no made-up fallback.
const NO_CALLS = "I don't call prices.";
const NO_AI = "I can't reach the AI right now, try again in a moment.";
const ADVICE_Q = /\b(buy|buying|sell|selling|hold|holding|short(ing)?|invest(ing|ment|or)?s?|should i|price target|target price|worth (it|buying)|undervalued|overvalued|entry point|exit point|portfolio|predict(ion)?|forecast|go(ing)? (up|down)|(rise|fall|drop|climb|rally)|up or down|bullish or bearish)\b/i;
const ADVICE_A = /\b(you should|you might want to|consider (buying|selling|holding)|(should|could) (buy|sell|hold)|good (time|investment|buy)|price target|i recommend|we recommend|recommend (buying|selling|holding)|(is|are) (likely|expected|poised|set) to (rise|fall|climb|drop|go up|go down)|will (likely )?(rise|fall|climb|drop|go up|go down))\b/i;
const TALK_DAILY_CAP = 300;

const STT_DAILY_CAP = 300;

// Speech-to-text for one press-to-talk clip: {audio: base64, mime}. The apps use the phone's or browser's own speech
// recognition first; this is the backup. ElevenLabs Scribe when the key allows speech_to_text, else Gemini.
// Gemini sometimes answers 503 "high demand" for a moment; one quick retry covers it.
async function geminiFetch(url, init) {
  const r = await fetch(url, init);
  if (r.status !== 503 && r.status !== 500) return r;
  await new Promise((ok) => setTimeout(ok, 900));
  return fetch(url, init);
}
async function sttGemini(b64, mime) {
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const r = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime.split(";")[0], data: b64 } },
      { text: "Transcribe the spoken English in this clip exactly. Output only the words, nothing else. If there is no speech, output nothing." }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024, ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } }),
  });
  if (!r.ok) return null;
  return ((await r.json()).candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || "").join("").trim();
}
async function talkStt(body) {
  if (!process.env.ELEVENLABS_API_KEY && !process.env.GEMINI_API_KEY) return [503, { detail: "Voice input is not available on this site." }];
  const b64 = String(body.audio || "");
  if (!b64) return [400, { detail: "No audio." }];
  const audio = Buffer.from(b64, "base64");
  if (audio.length < 800) return [200, { text: "" }]; // a tap, not speech
  if (audio.length > 3_000_000) return [413, { detail: "That was too long. Keep questions under a minute." }];
  const day = `kw:stt:${new Date().toISOString().slice(0, 10)}`, used = (await getJSON(day)) || 0;
  if (used >= STT_DAILY_CAP) return [429, { detail: "Voice limit for today reached." }];
  await setJSON(day, used + 1, { ex: 2 * 86400 });
  const mime = String(body.mime || "audio/m4a").replace(/[^a-z0-9/.+;=-]/gi, "");
  let text = null;
  if (process.env.ELEVENLABS_API_KEY) text = await sttEleven(audio, mime);
  if (text === null && process.env.GEMINI_API_KEY) text = await sttGemini(b64, mime);
  if (text === null) return [502, { detail: "Couldn't transcribe that. Try again." }];
  return [200, { text: text.replace(/\(.*?\)/g, "").trim() }]; // drop "(background noise)" style tags
}
async function sttEleven(audio, mime) {
  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.append("language_code", "en");
  form.append("file", new Blob([audio], { type: mime }), `question.${mime.split("/")[1]?.split(";")[0] || "m4a"}`);
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }, body: form });
  return r.ok ? String((await r.json()).text || "") : null; // e.g. a key without the speech_to_text permission
}

async function talk(body) {
  const t = String(body.ticker || "").toUpperCase(), q = String(body.question || "").trim().slice(0, 300);
  // short memory: the last few turns of this conversation, sent back by the app (never stored server side)
  const history = (Array.isArray(body.history) ? body.history : []).slice(-3)
    .map((h) => ({ q: String(h?.q || "").slice(0, 300), a: String(h?.a || "").slice(0, 600) })).filter((h) => h.q && h.a);
  if (!q) return [400, { detail: "Ask a question about the news." }];
  const fail = (answer = NO_AI) => [200, { ticker: t, answer, engine: "error", refused: false, sources: [] }];
  if (!process.env.GEMINI_API_KEY) return fail();
  const coin = !!COINS[t];
  const feed = coin ? await cryptoNews(t)
    : (await getJSON(`kw:get:${canonical("headlines", { ticker: t, source: "live", limit: "40", model: "general" })}`))?.body
      || (SYM.test(t) ? { items: await yahooNews(t).catch(() => []) } : null);
  const items = (feed?.items || []).slice(0, 40);
  if (!items.length) return fail(`I don't have any headlines for ${t} right now, so I can't answer that.`);
  const day = `kw:talkq:${new Date().toISOString().slice(0, 10)}`, used = (await getJSON(day)) || 0;
  if (used >= TALK_DAILY_CAP) return fail("I've hit today's question limit. Try again tomorrow.");
  await setJSON(day, used + 1, { ex: 2 * 86400 });
  const calls = ADVICE_Q.test(q);
  const list = items.map((h, i) => `${i + 1}. ${h.title} (${h.source || "unknown source"}, ${String(h.time || "").slice(0, 16).replace("T", " ")}${h.label ? `, tagged ${h.label}${h.prob ? ` ${Math.round(h.prob * 100)}%` : ""}` : ""})`).join("\n");
  const system = `You are Knight-Daddy's voice assistant. You talk about the news coverage of ${t} and how it is framed, using ONLY the headlines below. Tags come from our sentiment model${coin ? " (not yet validated on crypto)" : ""}.
Your answer is read aloud. Write 2 to 4 natural, conversational sentences (under 80 words) that weave in specific real headlines by their content (company names, events, sources). No lists, no numbers in brackets, no counts of how many headlines match, no markdown, no dashes as punctuation.
Never predict prices or say whether to buy, sell or hold. If the question asks about price direction, trading or investing, begin with exactly "${NO_CALLS}" and then summarize what the news actually says about the company, good and bad.
If asked for the most alarming, worrying, negative or risky headline, pick the single headline that is genuinely the most negative or risky for the company, say what it is and explain why it matters.
If the headlines truly do not cover the question, say so in one sentence and mention what they do cover. Never invent facts, numbers or quotes.
Return JSON: {"answer": string, "used": [the numbers of the headlines you drew on]}.

Headlines for ${t}, newest first:
${list}`;
  const contents = [...history.flatMap((h) => [{ role: "user", parts: [{ text: h.q }] }, { role: "model", parts: [{ text: JSON.stringify({ answer: h.a, used: [] }) }] }]),
    { role: "user", parts: [{ text: calls ? `${q}\n(This asks about price direction or trading: start with "${NO_CALLS}" then summarize the news.)` : q }] }];
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  let out = null;
  try {
    const r = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      // thinking tokens count against maxOutputTokens on gemini-3 models, so keep thinking low and the budget roomy
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { answer: { type: "STRING" }, used: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["answer"] },
          ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } }),
    });
    if (!r.ok) { console.error("talk: gemini HTTP", r.status, (await r.text()).slice(0, 300)); return fail(); }
    const text = ((await r.json()).candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || "").join("");
    out = JSON.parse(text);
  } catch (e) { console.error("talk: gemini failed", e.message); return fail(); }
  let answer = String(out?.answer || "").replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (!answer) return fail();
  // safety net: drop any sentence that slips into advice or a price call; keep the rest of the summary
  const sentences = answer.split(/(?<=[.!?]["')]*)\s+/);
  answer = sentences.filter((x) => !ADVICE_A.test(x)).join(" ").replace(/\s+/g, " ").trim();
  if (calls && !answer.startsWith(NO_CALLS)) answer = `${NO_CALLS} ${answer}`.trim();
  if (!answer || answer === NO_CALLS) return fail();
  const picked = [...new Set((out.used || []).map(Number))].filter((n) => n >= 1 && n <= items.length).slice(0, 4);
  const id = hashId(t + q + answer);
  await setJSON(`kw:talk:${id}`, answer, { ex: 86400 }).catch(() => {});
  return [200, { ticker: t, id, answer, engine: "gemini", model, refused: false,
    sources: picked.map((n) => ({ n, title: items[n - 1].title, source: items[n - 1].source, url: items[n - 1].url, time: items[n - 1].time })) }];
}
const hashId = (x) => crypto.createHash("sha1").update(x).digest("hex").slice(0, 16);

// ---------- crypto (display rows): Coinbase Exchange public API, no key ----------
const COINS = { "BTC-USD": ["Bitcoin", "BTC"], "ETH-USD": ["Ethereum", "Ether", "ETH"], "SOL-USD": ["Solana", "SOL"] };
const CB = "https://api.exchange.coinbase.com/products";
async function cb(path) {
  const r = await fetch(`${CB}/${path}`, { headers: { "user-agent": "knight-daddy" } });
  if (!r.ok) throw new Error(`Coinbase HTTP ${r.status}`);
  return r.json();
}
const cache = (res, s) => res.setHeader("cache-control", `public, s-maxage=${s}, stale-while-revalidate=${s * 4}`);

// Price and 24h change (last vs the price 24 hours ago).
async function cryptoQuote(t) {
  const st = await cb(`${t}/stats`);
  const last = Number(st.last), open = Number(st.open);
  return { ticker: t, source: "Coinbase", last, open_24h: open, change_24h: open ? last / open - 1 : null, high_24h: Number(st.high), low_24h: Number(st.low) };
}

// Daily candles, oldest first, in the same {time, open, high, low, close, volume} shape as /api/prices.
// Coinbase returns at most 300 candles per call, so longer spans are fetched in pieces.
async function cryptoCandles(t, days) {
  const end = Math.floor(Date.now() / 1000), out = new Map();
  for (let to = end; to > end - days * 86400; to -= 300 * 86400) {
    const from = Math.max(end - days * 86400, to - 300 * 86400);
    const rows = await cb(`${t}/candles?granularity=86400&start=${new Date(from * 1000).toISOString()}&end=${new Date(to * 1000).toISOString()}`);
    for (const [ts, low, high, open, close, volume] of rows) out.set(ts, { time: new Date(ts * 1000).toISOString().slice(0, 10), open, high, low, close, volume });
  }
  const bars = [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  if (!bars.length) throw new Error("no candles");
  return { ticker: t, source: "Coinbase", days, bars, last: bars.at(-1).close, change_period: bars.at(-1).close / bars[0].close - 1 };
}

// Crypto headlines: the worker's model-tagged snapshot when Oscar pushes one, else Finnhub's crypto news (only if
// FINNHUB_API_KEY is set here), else the worker's untagged snapshot, else Yahoo Finance's public news search (no key).
// Always filtered to headlines naming the coin.
async function cryptoNews(t) {
  const snap = async (model) => (await getJSON(`kw:get:${canonical("headlines", { ticker: t, source: "live", limit: "40", model })}`))?.body;
  const tagged = await snap("general");
  if (tagged?.items?.length) {
    // the 3-class crypto adapter's tag rides along (Advanced mode shows it beside the general tag) once Oscar pushes it
    const cm = new Map(((await snap("crypto"))?.items || []).filter((i) => i.label).map((i) => [i.title, i.label]));
    const items = tagged.items.map((i) => (cm.has(i.title) ? { ...i, crypto_label: cm.get(i.title) } : i));
    return { ...tagged, items, tagged: items.some((i) => i.label), crypto_model: cm.size > 0 };
  }
  if (process.env.FINNHUB_API_KEY) {
    const r = await fetch("https://finnhub.io/api/v1/news?category=crypto", { headers: { "X-Finnhub-Token": process.env.FINNHUB_API_KEY } });
    if (r.ok) {
      const pat = new RegExp(`\\b(${COINS[t].join("|")})\\b`, "i");
      const all = await r.json();
      const items = all.filter((n) => n.headline && pat.test(n.headline)).sort((a, b) => b.datetime - a.datetime)
        .map((n) => ({ title: n.headline.trim(), source: n.source || "", url: n.url || "", time: new Date(n.datetime * 1000).toISOString() }));
      return { ticker: t, provider: "Finnhub", filter_note: `${items.length} of ${all.length} Finnhub crypto headlines name ${COINS[t][0]}; showing only those`, items, tagged: false };
    }
  }
  const plain = await snap("none");
  if (plain?.items?.length) return { ...plain, tagged: false };
  const q = new URLSearchParams({ q: COINS[t][0], newsCount: "40", quotesCount: "0", enableFuzzyQuery: "false", newsQueryId: "news_cie_vespa" });
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?${q}`, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const pat = new RegExp(`\\b(${COINS[t].join("|")})\\b`, "i");
  const items = ((await r.json()).news || []).filter((n) => n.title && pat.test(n.title))
    .map((n) => ({ title: n.title, source: n.publisher || "", url: n.link || "", time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null }));
  return { ticker: t, provider: "Yahoo Finance", filter_note: `Showing only headlines that name ${COINS[t][0]}`, items, tagged: false };
}
// ---------- any ticker: live fallback until Oscar covers it ----------
// The site only mirrors what the Oscar worker pushes. For a ticker it has never pushed, prices and headlines come live
// from Yahoo Finance (no key, headlines untagged), and the ticker is queued in kw:wanted; the worker picks the queue up
// with its next job check, pushes tags, briefing and confidence for it, and keeps it fresh in later rounds.
const SYM = /^[A-Z][A-Z0-9.-]{0,9}$/;
const YH = { "user-agent": "Mozilla/5.0" };
const WANTED_MAX = 20, WANTED_DAYS = 7;
async function want(t) {
  const w = (await getJSON("kw:wanted")) || {};
  w[t] = now();
  const keep = Object.entries(w).filter(([, at]) => now() - at < WANTED_DAYS * 86400e3).sort((a, b) => b[1] - a[1]).slice(0, WANTED_MAX);
  await setJSON("kw:wanted", Object.fromEntries(keep), { ex: WANTED_DAYS * 86400 });
}
async function yahooPrices(t, period) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=${period}&interval=1d`, { headers: YH });
  if (!r.ok) return null;
  const c = (await r.json()).chart?.result?.[0], q = c?.indicators?.quote?.[0];
  if (!c?.timestamp || !q) return null;
  const bars = c.timestamp.map((ts, i) => ({ time: new Date(ts * 1000).toISOString().slice(0, 10), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 }))
    .filter((b) => b.close != null);
  if (!bars.length) return null;
  const last = bars.at(-1).close, prev = bars.length > 1 ? bars.at(-2).close : last;
  return { ticker: t, period, bars, last, change_1d: last / prev - 1, change_period: last / bars[0].close - 1,
    high: Math.max(...bars.map((b) => b.high ?? b.close)), low: Math.min(...bars.map((b) => b.low ?? b.close)),
    name: c.meta?.longName || c.meta?.shortName || null, exchange: c.meta?.fullExchangeName || null, provider: "Yahoo Finance", pending: true };
}
async function yahooNews(t) {
  const q = new URLSearchParams({ q: t, newsCount: "40", quotesCount: "0", enableFuzzyQuery: "false", newsQueryId: "news_cie_vespa" });
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?${q}`, { headers: YH });
  if (!r.ok) return [];
  const all = ((await r.json()).news || []).filter((n) => n.title);
  const about = all.filter((n) => (n.relatedTickers || []).includes(t)); // stories Yahoo links to this ticker
  return (about.length ? about : all).map((n) => ({ title: n.title, source: n.publisher || "", url: n.link || "",
    time: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null }));
}
async function liveFallback(key) {
  const [path, qs] = key.split("?"), q = new URLSearchParams(qs || ""), t = q.get("ticker") || "";
  if (!SYM.test(t) || COINS[t]) return null;
  if (path === "prices") {
    const p = await yahooPrices(t, q.get("period") || "1y").catch(() => null);
    if (!p) return null;
    await want(t);
    return [200, p];
  }
  if (path === "headlines" && q.get("source") === "live" && q.get("model") !== "specialist") {
    const items = (await yahooNews(t).catch(() => [])).slice(0, Number(q.get("limit")) || 40);
    if (!items.length) return null;
    await want(t);
    return [200, { ticker: t, source: "live", provider: "Yahoo Finance", provider_note: null, model: q.get("model") || "general", items, labeled: false, pending: true,
      filter_note: "Tags appear after Oscar's next update", p_bearish: null, p_neutral: null, p_bullish: null, confidence_n: 0 }];
  }
  if (path === "specialist/status") return [200, { ticker: t, phase: "none" }]; // never fine-tuned: same as the backend says
  if (path === "briefing") return siteBriefing(t, q.get("mode") === "advanced" ? "advanced" : "normal", key);
  return null;
}

// Briefing written here (Gemini) for a ticker Oscar hasn't covered: same rules as terminal/backend/briefing.py, from
// the live Yahoo headlines, which are not tagged yet, so no tag counts. Stored like a pushed snapshot for 3 hours
// (read-aloud works on it); Oscar's own briefing replaces it once the worker covers the ticker.
const BRIEF_SYSTEM = `You write the news briefing for ONE stock on a research dashboard. It must be about this ticker's own
headlines, not the market in general.
Rules, all mandatory:
- Use ONLY the numbered headlines provided. Do not add facts, numbers, names, dates or context that are not in them.
- Be specific: name the concrete topics the headlines are about (products, deals, events, people, lawsuits, filings,
  partners, rivals) and which outlets reported them when it helps. No generic market talk.
- The headlines have not been tagged by our sentiment model yet: do not give tag counts or call the coverage bullish or bearish.
- If several headlines are not really about this company, say how many and leave them out of the summary.
- If there is genuinely little to say, write less. Never pad.
- If headlines report analyst price targets or rating changes, say only that analysts updated their views and name the firms;
  never repeat a target, a rating or a dollar level for the stock.
- Never predict prices or returns, never say what the stock will do, no investment or trading advice of any kind.
- Do not use the words buy, sell, hold, holdings or portfolio (or buying, selling, holding, buys, sells, holds) at all.
- Plain text, no markdown headings, no bold, no em dashes.`;
const BRIEF_FORMAT = {
  normal: 'Format: at most 4 bullets, one per line, each starting with "- " and at most 15 words. Lead with the most covered topic.',
  advanced: "Format: 2 to 4 short paragraphs separated by a blank line, at most 260 words in total. Paragraph one: the main story or stories and who reported them. Then the other distinct topics.",
};
const BRIEF_BANNED = /\b(you should|investors should|we recommend|recommend(ed|s)? (buying|selling)|good time to|consider (buying|selling)|(is|are) (likely|poised|set|expected) to (rise|fall|climb|drop|gain|surge|rally)|will (likely )?(rise|fall|climb|drop|gain|surge|rally|outperform|underperform)|price will|price targets?|target prices?|buy|buys|buying|sell|sells|selling|hold|holds|holding|holdings|portfolios?|bullish|bearish)\b/i;
const BRIEF_DAILY_CAP = 200;
async function siteBriefing(t, mode, key) {
  const none = (message) => [200, { status: "unavailable", ticker: t, mode, message }];
  if (!process.env.GEMINI_API_KEY) return none(`The ${t} summary appears after Oscar's next update.`);
  const items = (await yahooNews(t).catch(() => [])).slice(0, 25);
  if (!items.length) return null;
  const day = `kw:briefq:${new Date().toISOString().slice(0, 10)}`, used = (await getJSON(day)) || 0;
  if (used >= BRIEF_DAILY_CAP) return none("AI summary limit for today reached.");
  await setJSON(day, used + 1, { ex: 2 * 86400 });
  const lines = items.map((h, i) => `${i + 1}. ${h.title} (${h.source || "source n/a"}, ${String(h.time || "").slice(0, 10)})`).join("\n");
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const ask = async (extra = "") => {
    const r = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: `${BRIEF_SYSTEM}\n${BRIEF_FORMAT[mode]}${extra}` }] },
        contents: [{ role: "user", parts: [{ text: `Ticker: ${t}\nHeadlines:\n${lines}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } }),
    });
    if (!r.ok) return null;
    const c = (await r.json()).candidates?.[0];
    const text = (c?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || "").join("").trim().replace(/\s*[\u2014\u2013]\s*/g, ", ");
    return text && c.finishReason === "STOP" ? text : null;
  };
  let text = await ask().catch(() => null), guard = "passed";
  if (text && BRIEF_BANNED.test(text)) {
    text = await ask(`\nYour previous draft used a forbidden phrase ("${text.match(BRIEF_BANNED)[0]}"). Rewrite without it.`).catch(() => null);
    guard = "regenerated once";
  }
  if (!text || BRIEF_BANNED.test(text)) return none("AI summary temporarily unavailable.");
  const body = { status: "ok", id: hashId(`site${mode}${t}${lines}`), ticker: t, mode, text, window: "latest headlines", n: items.length,
    counts: null, model, guard, generated_at: new Date().toISOString(), provider: "Yahoo Finance", untagged: true,
    headlines: items.map((h) => ({ title: h.title, label: null, source: h.source })) };
  await setJSON(`kw:get:${key}`, { status: 200, body, pushed_at: body.generated_at, site: true }, { ex: 3 * 3600 });
  return [200, body];
}

// Sentiment vs. price for any stock: the general model's daily tags as stored in Tiger (every pushed live snapshot)
// against the daily close. Headlines from a weekend or holiday count toward the next trading day. Grows a day at a time;
// correlations only once there are LIVE_MIN_DAYS days with tagged headlines. DDOG and NVDA keep the FNSPID version.
const LIVE_MIN_DAYS = 20;
async function liveSentiment(t) {
  if (!tigerOn || !SYM.test(t)) return null;
  const h = await history(t, 365, "general").catch(() => null);
  const days = (h?.days || []).filter((d) => d.Bullish + d.Bearish + d.Neutral > 0);
  if (!days.length) return [404, { detail: `No tagged ${t} headlines stored yet; the chart starts once Oscar tags them.` }];
  const snap = (await getJSON(`kw:get:${canonical("prices", { ticker: t, period: "1y" })}`))?.body;
  const px = snap?.bars?.length ? snap : await yahooPrices(t, "1y");
  if (!px?.bars?.length) return null;
  const first = days[0].day, bars = px.bars.filter((b) => b.time >= first);
  if (!bars.length) return [404, { detail: `No ${t} trading days since the first tagged headline (${first}) yet.` }];
  const acc = new Map(bars.map((b) => [b.time, { b: 0, r: 0, n: 0 }]));
  let k = 0;
  for (const d of days) {
    while (k < bars.length && bars[k].time < d.day) k++;
    if (k >= bars.length) break; // after the last close: counts once the next session closes
    const a = acc.get(bars[k].time); a.b += d.Bullish; a.r += d.Bearish; a.n += d.Bullish + d.Bearish + d.Neutral;
  }
  const rows = bars.map((b) => { const a = acc.get(b.time); return { time: b.time, close: b.close, score: a.n ? (a.b - a.r) / a.n : null, n: a.n }; });
  const tagged = rows.filter((r) => r.n).length;
  let corr_by_lag = null;
  if (tagged >= LIVE_MIN_DAYS) {
    const ret = rows.map((r, i) => (i ? r.close / rows[i - 1].close - 1 : null));
    const corr = (xs, ys) => {
      const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x !== null && y !== null && isFinite(y));
      if (p.length < 5) return null;
      const mx = p.reduce((s, [x]) => s + x, 0) / p.length, my = p.reduce((s, [, y]) => s + y, 0) / p.length;
      const c = p.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), vx = p.reduce((s, [x]) => s + (x - mx) ** 2, 0), vy = p.reduce((s, [, y]) => s + (y - my) ** 2, 0);
      return vx && vy ? c / Math.sqrt(vx * vy) : null;
    };
    corr_by_lag = Object.fromEntries([-3, -2, -1, 0, 1, 2, 3].map((lag) => [lag, corr(rows.map((r) => r.score), rows.map((_, i) => ret[i + lag] ?? null))]));
  }
  return [200, { ticker: t, source: "live", start: rows[0].time, end: rows.at(-1).time, rows, tagged_days: tagged, min_days: LIVE_MIN_DAYS,
    corr_by_lag, corr_prev_session: corr_by_lag?.["-1"] ?? null, corr_next_open_to_open: corr_by_lag?.["1"] ?? null }];
}
const jobKey = (id) => `kw:job:${id}`;

async function activeJob() {
  const id = await getJSON("kw:job:active");
  if (!id) return null;
  const job = await getJSON(jobKey(id));
  if (!job) { await del("kw:job:active"); return null; }
  if (["done", "failed"].includes(job.status) || now() - (job.updated_at || job.created_at) > STALE_MS) {
    if (!["done", "failed"].includes(job.status)) {   // dead worker: release the lock
      job.status = "failed"; job.error = "no progress for 10 minutes (Oscar worker stopped?)";
      await setJSON(jobKey(id), job, { ex: 86400 });
    }
    await del("kw:job:active");
    return null;
  }
  return job;
}

// Job progress in the same shape as the backend's /api/specialist/status, so the frontend code is unchanged.
function statusFromJob(job, workerSeen) {
  const p = job.progress || {};
  if (job.status === "queued") {
    const ago = workerSeen ? Math.round((now() - workerSeen) / 1000) : null;
    return { ticker: job.ticker, quick: !!job.quick, phase: "queued", running: true, step: 0, total_steps: null, losses: [],
             note: `waiting for the Oscar worker${ago !== null ? ` (last seen ${ago}s ago)` : ""}`,
             queued_s: Math.round((now() - job.created_at) / 1000) };
  }
  if (job.status === "failed") return { ...p, ticker: job.ticker, phase: "failed", running: false, error: job.error || p.error };
  return { ...p, ticker: job.ticker, running: job.status === "running" && !["done", "failed"].includes(p.phase) };
}

// Copy a live headlines snapshot into Tiger once per pushed version. Never fails the request.
async function syncToTiger(key, snap) {
  if (!tigerOn || !key.startsWith("headlines?") || snap.body?.source !== "live") return;
  const mark = `kw:tiger:${key}`, version = snap.pushed_at || "unversioned";
  try {
    if ((await getJSON(mark)) === version || ((await getJSON("kw:tiger:down")) || 0) > now()) return;
    await saveHeadlines(snap.body);
    await setJSON(mark, version, { ex: 7 * 86400 });
  } catch (e) {
    console.error("tiger sync failed:", e.message);
    // back off 5 min so reads stay fast; an explicit until-time because the modal store ignores TTLs
    await setJSON("kw:tiger:down", now() + 5 * 60 * 1000, { ex: 300 }).catch(() => {});
  }
}

// ElevenLabs text-to-speech for a pushed briefing. Cached per briefing id; capped per day to protect the quota.
const TTS_DAILY_CAP = 60;
// ElevenLabs text to speech, cached per id, capped per day. Returns [code, body] or [200, Buffer].
async function tts(cacheKey, text) {
  const key = process.env.ELEVENLABS_API_KEY;
  let mp3 = await getJSON(cacheKey);
  if (!mp3) {
    const day = `kw:tts:${new Date().toISOString().slice(0, 10)}`;
    const used = (await getJSON(day)) || 0;
    if (used >= TTS_DAILY_CAP) return [429, { detail: "Read-aloud limit for today reached." }];
    await setJSON(day, used + 1, { ex: 2 * 86400 });
    const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // premade "George"
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: String(text).slice(0, 2500), model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" }),
    });
    if (!r.ok) return [502, { detail: `ElevenLabs HTTP ${r.status}` }];
    mp3 = Buffer.from(await r.arrayBuffer()).toString("base64");
    await setJSON(cacheKey, mp3, { ex: 2 * 86400 }).catch(() => {}); // cache is best effort
  }
  return [200, Buffer.from(mp3, "base64")];
}

// Reads a Talk answer aloud. Only answers this site produced (stored by id) can be spoken.
async function talkAudio(req, res) {
  if (!process.env.ELEVENLABS_API_KEY) return send(res, 503, { detail: "Read-aloud is not available on the public site." });
  const id = String(req.query.id || "").replace(/[^a-f0-9]/g, "").slice(0, 16);
  const text = id ? await getJSON(`kw:talk:${id}`) : null;
  if (!text) return send(res, 404, { detail: "No answer with that id." });
  const [code, out] = await tts(`kw:audio:talk:${id}`, text.replace(/\s*\[\d+\](?:\s*,?\s*\[\d+\])*/g, ""));
  if (code !== 200) return send(res, code, out);
  res.setHeader("content-type", "audio/mpeg");
  return res.status(200).send(out);
}

async function briefingAudio(req, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return send(res, 503, { detail: "Read-aloud is not available on the public site." });
  const id = String(req.query.id || "");
  const meta = await getJSON("kw:meta");
  const tickers = req.query.ticker ? [String(req.query.ticker).toUpperCase()] : meta?.tickers || [];
  let b = null;
  for (const t of tickers) {
    for (const q of [{ ticker: t }, { ticker: t, mode: "advanced" }]) {
      const snap = await getJSON(`kw:get:${canonical("briefing", q)}`);
      if (snap?.body?.status === "ok" && (!id || snap.body.id === id)) { b = snap.body; break; }
    }
    if (b) break;
  }
  if (!b) return send(res, 404, { detail: "No briefing with that id on the public site." });
  const [code, out] = await tts(`kw:audio:${b.id}`, b.text);
  if (code !== 200) return send(res, code, out);
  res.setHeader("content-type", "audio/mpeg");
  return res.status(200).send(out);
}

async function mirror(res, key, extra) {
  const snap = await getJSON(`kw:get:${key}`);
  if (snap) await syncToTiger(key, snap);
  if (snap && key.startsWith("briefing?") && (snap.status >= 400 || !snap.body?.status)) // upstream (Gemini) failure
    return send(res, 200, { status: "unavailable", ticker: new URLSearchParams(key.split("?")[1]).get("ticker"),
                            message: "AI summary temporarily unavailable." });
  if (!snap) {
    const fb = await liveFallback(key);
    if (fb) return send(res, fb[0], fb[1]);
  }
  if (!snap && key.startsWith("briefing?mode=advanced")) // the longer briefing appears once the worker pushes it
    return send(res, 200, { status: "not_published", mode: "advanced", message: "Longer briefing not published yet." });
  if (!snap) {
    const meta = await getJSON("kw:meta");
    return send(res, 404, { detail: `Not available on the public site yet (${key}). Tracked tickers: ${(meta?.tickers || []).join(", ") || "none pushed yet"}.` });
  }
  return send(res, snap.status || 200, extra ? { ...snap.body, ...extra(snap) } : snap.body);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.VERCEL && backend === "memory") // per-instance memory would silently lose data on Vercel
    return send(res, 503, { detail: "Database not connected: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on the Vercel project, then redeploy." });
  const route = routeOf(req);
  const method = req.method;
  const secretOk = same(req.headers["x-kw-secret"], process.env.KW_PUSH_SECRET);
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    // ---------- worker endpoints (shared secret) ----------
    if (route === "snapshot" && method === "POST") {
      if (!secretOk) return send(res, 401, { detail: "bad or missing x-kw-secret" });
      const items = Array.isArray(body.items) ? body.items : [];
      for (const it of items) {
        const key = canonical(it.path), snap = { status: it.status || 200, body: it.body, pushed_at: body.pushed_at };
        if (key.startsWith("briefing?") && (snap.status >= 400 || snap.body?.status !== "ok")) {
          // Gemini failed (e.g. quota). Keep serving the last good briefing instead of replacing it with the error.
          const prev = await getJSON(`kw:get:${key}`);
          if (prev?.body?.status === "ok") { await setJSON(`kw:err:${key}`, snap, { ex: 86400 }); continue; }
        }
        await setJSON(`kw:get:${key}`, snap);
        await syncToTiger(key, snap);
      }
      if (body.tickers) await setJSON("kw:meta", { tickers: body.tickers, pushed_at: body.pushed_at });
      return send(res, 200, { stored: items.length, store: backend });
    }
    if (route.startsWith("jobs/")) {
      if (!secretOk) return send(res, 401, { detail: "bad or missing x-kw-secret" });
      await setJSON("kw:worker:last_seen", now(), { ex: 3600 });
      if (route === "jobs/heartbeat" && method === "POST") return send(res, 200, { ok: true }); // worker alive, GPU busy
      const job = await activeJob();
      if (route === "jobs/claim" && method === "POST") {
        const wanted = Object.keys((await getJSON("kw:wanted")) || {});
        if (!job || job.status !== "queued") return send(res, 200, { job: null, wanted });
        Object.assign(job, { status: "running", claimed_at: now(), updated_at: now() });
        await setJSON(jobKey(job.id), job, { ex: 86400 });
        return send(res, 200, { job, wanted });
      }
      if (!job || job.id !== body.id) return send(res, 409, { detail: "no such active job" });
      if (route === "jobs/progress" && method === "POST") {
        Object.assign(job, { progress: body.progress || {}, updated_at: now() });
        await setJSON(jobKey(job.id), job, { ex: 86400 });
        return send(res, 200, { ok: true });
      }
      if (route === "jobs/finish" && method === "POST") {
        Object.assign(job, { status: body.status === "done" ? "done" : "failed", error: body.error || null,
                             progress: body.progress || job.progress, updated_at: now(), finished_at: now() });
        await setJSON(jobKey(job.id), job, { ex: 86400 });
        await del("kw:job:active");
        // a finished full fine-tune becomes the ticker's active model (quick demos are never served)
        if (job.status === "done" && !job.quick) await setJSON(`kw:active:${job.ticker}`, "specialist");
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { detail: "unknown jobs route" });
    }

    // ---------- public endpoints ----------
    if (route === "specialist/train" && method === "POST") {
      if (!process.env.KW_TRAIN_PASSWORD) return send(res, 503, { detail: "Training is disabled on this site (no KW_TRAIN_PASSWORD set)." });
      if (!same(String(req.headers["x-train-password"] || "").trim(), process.env.KW_TRAIN_PASSWORD.trim())) return send(res, 401, { detail: "Wrong train password." });
      const ticker = String(body.ticker || "").toUpperCase();
      if (ticker === "CRYPTO") return send(res, 400, { detail: "Specialists are available for stocks only." });
      const info = (await getJSON("kw:get:specialist/info"))?.body;
      if (!info?.supported?.includes(ticker)) return send(res, 400, { detail: `Specialists are available for ${(info?.supported || []).join(", ") || "no tickers yet"}.` });
      const seen = await getJSON("kw:worker:last_seen");
      if (!seen || now() - seen > WORKER_ONLINE_MS) return send(res, 503, { detail: "The Oscar GPU worker is offline right now, so training is unavailable." });
      const busy = await activeJob();
      if (busy) return send(res, 409, { detail: `GPU busy with a ${busy.ticker} run; try again when it finishes.` });
      const job = { id: crypto.randomUUID(), ticker, quick: !!body.quick, status: "queued", created_at: now(), updated_at: now(), progress: {} };
      if (!(await setIfAbsent("kw:job:active", job.id, 3600))) return send(res, 409, { detail: "Another training job just started." });
      await setJSON(jobKey(job.id), job, { ex: 86400 });
      await setJSON(`kw:job:last:${ticker}`, job.id, { ex: 86400 });
      return send(res, 200, { ticker, job: job.id });
    }
    if (route === "specialist/status" && method === "GET") {
      const ticker = String(req.query.ticker || "").toUpperCase();
      const id = await getJSON(`kw:job:last:${ticker}`);
      const job = id ? await getJSON(jobKey(id)) : null;
      const snap = await getJSON(`kw:get:${canonical("specialist/status", { ticker })}`);
      const snapTime = snap?.pushed_at ? Date.parse(snap.pushed_at) : 0;
      if (job && (job.status === "queued" || job.status === "running" || (job.updated_at || 0) > snapTime)) {
        await activeJob(); // releases a stale lock if needed
        const fresh = await getJSON(jobKey(id));
        return send(res, 200, statusFromJob(fresh, await getJSON("kw:worker:last_seen")));
      }
      return mirror(res, canonical("specialist/status", { ticker }));
    }
    // Active model per ticker: "general" until a full fine-tune finishes here, then "specialist" until reset.
    if (route === "specialist/active" && method === "GET") {
      const ticker = String(req.query.ticker || "").toUpperCase();
      return send(res, 200, { ticker, active: (await getJSON(`kw:active:${ticker}`)) === "specialist" ? "specialist" : "general" });
    }
    if (route === "specialist/reset" && method === "POST") {
      if (!process.env.KW_TRAIN_PASSWORD) return send(res, 503, { detail: "Model switching is disabled on this site (no KW_TRAIN_PASSWORD set)." });
      if (!same(String(req.headers["x-train-password"] || "").trim(), process.env.KW_TRAIN_PASSWORD.trim())) return send(res, 401, { detail: "Wrong train password." });
      const ticker = String(body.ticker || "").toUpperCase();
      await setJSON(`kw:active:${ticker}`, "general");
      return send(res, 200, { ticker, active: "general" });
    }
    if (route === "specialist/info" && method === "GET") {
      const job = await activeJob();
      return mirror(res, "specialist/info", () => ({ busy: !!job, busy_with: job ? "train" : null }));
    }
    if (route === "specialist/stream") return send(res, 410, { detail: "Use /api/specialist/status (polling) on the public site." });
    if (route.startsWith("crypto/") && method === "GET") {
      const t = String(req.query.ticker || "").toUpperCase();
      if (!COINS[t]) return send(res, 400, { detail: `Crypto rows: ${Object.keys(COINS).join(", ")}.` });
      try {
        if (route === "crypto/quote") { cache(res, 30); return send(res, 200, await cryptoQuote(t)); }
        if (route === "crypto/candles") {
          const days = Math.min(730, Math.max(7, parseInt(req.query.days, 10) || 90));
          cache(res, 300); return send(res, 200, await cryptoCandles(t, days));
        }
        if (route === "crypto/news") {
          const n = await cryptoNews(t);
          return n ? (cache(res, 120), send(res, 200, n)) : send(res, 404, { detail: "No crypto headlines published yet." });
        }
      } catch (e) {
        return send(res, 502, { detail: "Crypto data source unavailable right now." });
      }
      return send(res, 404, { detail: "unknown crypto route" });
    }
    if (route === "briefing/audio" && method === "GET") return briefingAudio(req, res);
    if (route === "talk/stt" && method === "POST") { const [code, out] = await talkStt(body); return send(res, code, out); }
    if (route === "talk" && method === "POST") { const [code, out] = await talk(body); return send(res, code, out); }
    if (route === "talk/audio" && method === "GET") return talkAudio(req, res);
    if (route === "history" && method === "GET") {
      if (!tigerOn) return send(res, 503, { detail: "History store not connected (no TIGER_DB_URL)." });
      const ticker = String(req.query.ticker || "").toUpperCase();
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
      return send(res, 200, await history(ticker, days, req.query.model === "specialist" ? "specialist" : "general"));
    }
    if (route === "classify") return send(res, 503, { detail: "The model runs on Oscar; live classification is not available on the public site." });
    if (route === "health" && method === "GET") {
      const meta = await getJSON("kw:meta");
      const seen = await getJSON("kw:worker:last_seen");
      return mirror(res, "health", () => ({
        mode: "vercel", store: backend, snapshot_pushed_at: meta?.pushed_at || null, tracked_tickers: meta?.tickers || [],
        worker_online: !!seen && now() - seen < WORKER_ONLINE_MS, train_password_required: true,
        keys: { FINNHUB_API_KEY: !!process.env.FINNHUB_API_KEY, GEMINI_API_KEY: !!process.env.GEMINI_API_KEY, ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY },
        history_store: tigerOn ? "tiger" : null,
      }));
    }
    if (route === "sentiment" && method === "GET") {
      const key = canonical(route, req.query), snap = await getJSON(`kw:get:${key}`);
      if (!(snap && (snap.status || 200) < 400)) {
        const live = await liveSentiment(String(req.query.ticker || "").toUpperCase());
        if (live) return send(res, live[0], live[1]);
      }
      return mirror(res, key);
    }
    if (method === "GET") return mirror(res, canonical(route, req.query));
    return send(res, 405, { detail: "method not allowed" });
  } catch (e) {
    return send(res, 500, { detail: `server error: ${e.message}` });
  }
}
