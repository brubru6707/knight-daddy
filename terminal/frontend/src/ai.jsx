import { useEffect, useRef, useState } from "react";
import { api, bullets, Dot, fmtDay, headlinesPath, LABELS, TAG, useAdvanced, useApi } from "./ui.jsx";

const FILL = { Bearish: "bg-down", Neutral: "bg-neutral", Bullish: "bg-up" };
const FIELD = { Bearish: "p_bearish", Neutral: "p_neutral", Bullish: "p_bullish" };

// Red / yellow / green bar sized by class probabilities d.p_bearish / d.p_neutral / d.p_bullish. n/a when missing.
export function ProbBar({ d }) {
  const p = d && LABELS.every((l) => typeof d[FIELD[l]] === "number") ? Object.fromEntries(LABELS.map((l) => [l, d[FIELD[l]]])) : null;
  const sum = p ? LABELS.reduce((a, l) => a + p[l], 0) : 0;
  if (!p || !sum) return <div className="mt-4 text-sm text-dim" data-testid="confidence-na">Confidence: n/a</div>;
  const top = LABELS.reduce((a, l) => (p[l] > p[a] ? l : a), "Neutral");
  return (
    <>
      <div className="mt-4 flex h-9 w-full overflow-hidden border border-line" data-testid="confidence-bar">
        {LABELS.map((l) => p[l] > 0 && (
          <div key={l} className={`${FILL[l]} flex min-w-0 items-center justify-center text-[11px] font-semibold text-ground`}
            style={{ width: `${(p[l] / sum) * 100}%` }} title={`${l} ${(p[l] * 100).toFixed(1)}%`} data-testid={`seg-${l}`}>
            <span className="truncate px-1">{Math.round((p[l] / sum) * 100)}%</span>
          </div>))}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        {LABELS.map((l) => (
          <span key={l} className={`flex items-center gap-1.5 ${TAG[l]}`}><Dot label={l} />{l} {(p[l] * 100).toFixed(0)}%</span>))}
      </div>
      <p className="mt-3 text-xs text-dim">Leans {top}. Average class probability over {d.confidence_n ?? "n/a"} headlines.</p>
    </>
  );
}

// Qwen (classification): one bar split by the model's softmax probabilities for this ticker, pushed by the Oscar worker
// as p_bearish / p_neutral / p_bullish on the headlines snapshot. Until those fields exist it says n/a, never a fake split.
export function ConfidenceBar({ ticker, model }) {
  const s = useApi(headlinesPath(ticker, model), [model]);
  return (
    <section className="kd-box mt-8 p-5" aria-label="Model confidence" data-testid="confidence">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] font-medium text-ink">Model confidence</h2>
        <span className="text-xs text-dim">Qwen classification{model === "specialist" ? `, ${ticker} specialist` : ", general model"}</span>
      </div>
      {s.loading ? <div className="mt-4 text-sm text-dim">Loading<span className="animate-pulse">_</span></div> : <ProbBar d={s.data} />}
      <History ticker={ticker} model={model} />
    </section>
  );
}

// Daily headline sentiment stored in Tiger Data (/api/history). Hidden on any history-store error.
function History({ ticker, model }) {
  const s = useApi(`history?ticker=${ticker}&days=30&model=${model}`, [ticker, model]);
  if (s.err || (!s.data && !s.loading)) return null;
  const days = s.data?.days || [];
  const max = Math.max(1, ...days.map((d) => d.Bullish + d.Bearish + d.Neutral));
  return (
    <div className="mt-6 border-t border-line pt-5" data-testid="history">
      <h3 className="text-sm font-semibold text-ink">Sentiment history</h3>
      {s.loading && <div className="mt-3 text-xs text-dim">Loading history<span className="animate-pulse">_</span></div>}
      {s.data && (days.length === 0 ? <div className="mt-3 text-xs text-dim">History: n/a (no stored headlines yet)</div> : (
        <div className="mt-3 flex h-14 items-end gap-[3px]" aria-label="Daily headline sentiment">
          {days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col-reverse" style={{ height: `${((d.Bullish + d.Bearish + d.Neutral) / max) * 100}%` }}
              title={`${fmtDay(d.day, { month: "short", day: "numeric" })}: ${d.Bullish} bullish, ${d.Bearish} bearish, ${d.Neutral} neutral`}>
              {["Bullish", "Bearish", "Neutral"].map((l) => d[l] > 0 && <span key={l} className={FILL[l]} style={{ flexGrow: d[l] }} />)}
            </div>
          ))}
        </div>
      ))}
      {s.data?.total_stored > 0 && (
        <div className="mt-2 text-xs text-dim">{s.data.total_stored} headlines stored in Tiger Data since {fmtDay(s.data.first.slice(0, 10), { month: "short", day: "numeric" })}.</div>
      )}
    </div>
  );
}

const Speaker = ({ on }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 9h4l5-4v14l-5-4H4z" strokeLinejoin="round" />
    {on ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
  </svg>
);

const Mic = ({ on }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" strokeLinecap="round" />
  </svg>
);

// Plays an mp3 from one of our audio endpoints; returns a stop function. Throws a short message on failure.
async function play(url, player, onEnd) {
  const h = await api("health");
  if (!h.keys?.ELEVENLABS_API_KEY) throw new Error("n/a on this site");
  const r = await fetch(url);
  if (!r.ok) throw new Error("n/a right now");
  const src = URL.createObjectURL(await r.blob());
  const a = new Audio(src);
  player.current = a;
  a.onended = () => { URL.revokeObjectURL(src); onEnd(); };
  await a.play();
}

// "Hey KD" wake phrase. Recognizers hear "KD" many ways ("Katie", "K.D.", "kay dee", "Casey"...), so accept the common
// ones. afterWake returns what was said after the last wake phrase, or null if it wasn't said.
const WAKE = /\b(?:hey|hi|hay|a|okay|ok)[\s,.!]*(?:k\.?\s?d\.?|kd|kdee|kay\s?dee|kaydee|katie|katy|kady|cady|kd's|casey)(?![a-z])[\s,.!?:]*/gi;
export function afterWake(text) {
  let last = null, m;
  WAKE.lastIndex = 0;
  while ((m = WAKE.exec(text))) last = m;
  return last ? text.slice(last.index + last[0].length).trim() : null;
}
const SILENCE_MS = 1600, WAKE_TIMEOUT_MS = 7000;

// Talk: a hands-free conversation about this stock's news and its tone. Tap the mic once to start; the browser's own
// speech recognition listens and waits for "Hey KD", takes what follows as the question and sends it when you pause.
// /api/talk answers only from the real headlines (with the last few turns as memory); the answer is spoken with
// ElevenLabs while the mic pauses, then it listens for the next "Hey KD". Tap the mic again to end. Browsers without
// speech recognition fall back to tap to record, tap to send (transcribed by /api/talk/stt). Advice questions get a
// short decline every time.
function Talk({ ticker, briefingId, mode: briefingMode }) {
  const [adv] = useAdvanced(); // Advanced shows which engine answered
  const [turns, setTurns] = useState([]);
  const [mode, setModeState] = useState("off"); // off | waiting | capturing | recording | thinking | speaking
  const [live, setLive] = useState("");
  const [err, setErr] = useState(null);
  const [typing, setTyping] = useState(false);
  const [q, setQ] = useState("");
  const [audio, setAudio] = useState({ state: "idle", which: null, msg: null });
  const player = useRef(null), rec = useRef(null), media = useRef(null);
  const modeRef = useRef("off"), turnsRef = useRef(turns), question = useRef(""), silence = useRef(null), wakeTimer = useRef(null);
  turnsRef.current = turns;
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const setMode = (m) => { modeRef.current = m; setModeState(m); };
  const clearTimers = () => { clearTimeout(silence.current); clearTimeout(wakeTimer.current); };
  const stopAudio = () => { player.current?.pause(); player.current = null; setAudio({ state: "idle", which: null, msg: null }); };
  const stopRec = () => { const r = rec.current; rec.current = null; if (r) { r.onend = null; r.onresult = null; try { r.abort(); } catch { /* already stopped */ } } };
  useEffect(() => () => { modeRef.current = "off"; clearTimers(); stopAudio(); stopRec(); media.current?.stream?.getTracks().forEach((t) => t.stop()); }, []);

  const speak = async (which, url, after) => {
    stopAudio(); setAudio({ state: "loading", which, msg: null });
    try {
      await play(url, player, () => { setAudio({ state: "idle", which: null, msg: null }); after?.(); });
      setAudio({ state: "playing", which, msg: null });
    } catch (e) { setAudio({ state: "idle", which: null, msg: e.message }); after?.(); }
  };

  // One recognition session that waits for "Hey KD". Sessions end on their own now and then; restart until tapped off.
  const listen = () => {
    stopRec(); question.current = ""; setLive(""); setMode("waiting");
    const r = new SR(); rec.current = r;
    r.lang = "en-US"; r.interimResults = true; r.continuous = true;
    r.onresult = (e) => {
      const m = modeRef.current;
      if (m !== "waiting" && m !== "capturing") return;
      const after = afterWake([...e.results].map((x) => x[0].transcript).join(" "));
      if (after === null) return; // not addressed to KD
      if (m === "waiting") { setMode("capturing"); clearTimeout(wakeTimer.current); wakeTimer.current = setTimeout(() => modeRef.current === "capturing" && !question.current && listen(), WAKE_TIMEOUT_MS); }
      question.current = after; setLive(after);
      clearTimeout(silence.current);
      if (after) silence.current = setTimeout(() => modeRef.current === "capturing" && question.current && ask(question.current, true), SILENCE_MS);
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { setMode("off"); setErr("Microphone access is off. Allow it in the browser, or type instead."); } };
    r.onend = () => {
      const m = modeRef.current;
      if (m === "capturing" && question.current) return ask(question.current, true);
      if (m === "waiting" || m === "capturing") setTimeout(() => (modeRef.current === "waiting" || modeRef.current === "capturing") && listen(), 250);
    };
    try { r.start(); } catch { setMode("off"); setErr("Couldn't start listening. Try again, or type instead."); }
  };
  const resume = () => { if (modeRef.current === "speaking" || modeRef.current === "thinking") (SR ? listen() : setMode("off")); };
  const ask = async (text, viaVoice) => {
    text = (text || "").trim();
    if (!text) { if (viaVoice) resume(); return; }
    clearTimers(); setErr(null);
    if (viaVoice) { setMode("thinking"); stopRec(); }
    const history = turnsRef.current.filter((t) => t.engine === "gemini").slice(-3).map((t) => ({ q: t.q, a: t.answer }));
    try {
      const r = await api("talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, question: text, history }) });
      setTurns((t) => [...t, { q: text, ...r }]); setLive("");
      if (r.id) { if (viaVoice) setMode("speaking"); speak(`a-${r.id}`, `/api/talk/audio?id=${r.id}`, viaVoice ? resume : undefined); }
      else if (viaVoice) resume();
    } catch { // never a made-up answer: say plainly that the AI didn't answer
      setTurns((t) => [...t, { q: text, answer: "I can't reach the AI right now, try again in a moment.", engine: "error" }]); setLive("");
      if (viaVoice) resume();
    }
  };

  // Fallback without browser speech recognition: tap to record, tap again to send the clip for transcription.
  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.done = new Promise((ok) => { mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); ok(new Blob(chunks, { type: mr.mimeType || "audio/webm" })); }; });
      mr.start(250); media.current = mr; setMode("recording");
      setTimeout(() => media.current === mr && sendRecording(), 60_000);
    } catch { setMode("off"); setErr("Microphone access is off. Allow it in the browser, or type instead."); }
  };
  const sendRecording = async () => {
    const mr = media.current; media.current = null;
    if (!mr) return;
    setMode("thinking"); mr.stop();
    const blob = await mr.done;
    try {
      const b64 = await new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1]); f.onerror = no; f.readAsDataURL(blob); });
      const { text } = await api("talk/stt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio: b64, mime: blob.type }) });
      if (!text) { setMode("off"); setErr("I didn't catch that. Tap the mic and ask again."); return; }
      ask(text, true);
    } catch (e) { setMode("off"); setErr(e.message); }
  };

  const toggle = () => {
    if (mode === "recording") return sendRecording();
    if (mode !== "off") { clearTimers(); setMode("off"); setLive(""); stopRec(); stopAudio(); return; }
    setErr(null); stopAudio();
    SR ? listen() : record();
  };
  const playing = (w) => audio.which === w && audio.state === "playing";
  const active = mode !== "off";
  const label = { off: turns.length ? "Tap to talk again" : "Tap to start talking", waiting: "Say “Hey KD”, then your question. Tap to stop.", capturing: "Listening…",
    recording: "Listening… tap to send", thinking: "Thinking…", speaking: "Answering… then say “Hey KD” again" }[mode];

  return (
    <div className="mt-5 border-t border-line pt-4" data-testid="talk-panel">
      <button onClick={() => (playing("briefing") ? stopAudio() : speak("briefing", `/api/briefing/audio?id=${briefingId}&ticker=${ticker}${briefingMode === "advanced" ? "&mode=advanced" : ""}`))}
        disabled={audio.state === "loading"} data-testid="speaker" aria-label={playing("briefing") ? "Stop reading" : `Read the ${ticker} briefing aloud`}
        className="flex items-center gap-1.5 text-xs text-ink hover:text-amber disabled:opacity-40">
        <Speaker on={playing("briefing")} />{playing("briefing") ? "Stop reading" : audio.state === "loading" && audio.which === "briefing" ? "Loading" : "Read the briefing aloud"}</button>
      <ul className="mt-4 space-y-4" data-testid="talk-turns">
        {turns.map((t, i) => (
          <li key={i} className="text-[14px] leading-snug">
            <div className="text-dim" data-testid="talk-heard">You: {t.q}</div>
            <div className={`mt-1.5 ${t.engine === "error" ? "text-dim" : "text-ink"}`} data-testid="talk-answer">{t.answer}</div>
            {adv && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-dim" data-testid="talk-engine">{t.engine === "gemini" ? "Gemini" : "error"}</div>}
            {t.id && (
              <button onClick={() => (playing(`a-${t.id}`) ? stopAudio() : speak(`a-${t.id}`, `/api/talk/audio?id=${t.id}`))} className="mt-1 flex items-center gap-1 text-xs text-dim hover:text-amber" data-testid="talk-hear">
                <Speaker on={playing(`a-${t.id}`)} />{playing(`a-${t.id}`) ? "Stop" : audio.state === "loading" && audio.which === `a-${t.id}` ? "Loading" : "Hear again"}</button>)}
            {t.sources?.length > 0 && (
              <ol className="mt-2 space-y-1 text-xs text-dim" data-testid="talk-sources">
                {t.sources.map((x) => (
                  <li key={x.n}>{x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="text-ink hover:text-amber">{x.title}</a> : x.title}
                    {x.source ? ` · ${x.source}` : ""}</li>))}
              </ol>)}
          </li>))}
      </ul>
      {(mode === "capturing" || mode === "thinking") && live && <div className="mt-3 text-[14px] text-dim" data-testid="talk-live">You: {live}</div>}
      {audio.msg && <div className="mt-2 text-xs text-dim">Read-aloud: {audio.msg}</div>}
      <div className="mt-4 flex flex-col items-center gap-2">
        <button onClick={toggle} data-testid="talk-hold" aria-pressed={active} aria-label={active ? "Stop talking" : "Start talking"}
          className={`flex h-16 w-16 select-none items-center justify-center rounded-full border-2 transition-all
            ${active ? "border-amber bg-amber text-ground" : "border-ink bg-ink text-ground hover:border-amber hover:bg-amber"} ${mode === "capturing" || mode === "recording" ? "scale-110" : ""}`}>
          <Mic on={mode === "capturing" || mode === "recording"} /></button>
        <div className="text-center text-xs text-dim" data-testid="talk-state" aria-live="polite">{label}</div>
      </div>
      {typing ? (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const x = q; setQ(""); ask(x, false); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} autoFocus placeholder={`Ask about ${ticker}'s news`} aria-label={`Ask about ${ticker}'s news`}
            data-testid="talk-input" className="min-w-0 flex-1 border border-line bg-ground px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-amber" />
          <button disabled={!q.trim()} className="bg-ink px-3 py-2 text-sm font-semibold text-ground disabled:opacity-40" data-testid="talk-ask">Ask</button>
        </form>
      ) : <button onClick={() => setTyping(true)} className="mx-auto mt-2 block text-xs text-amber hover:underline" data-testid="talk-type">Type instead</button>}
      {err && <div className="mt-2 text-center text-xs text-down" data-testid="talk-error">{err}</div>}
      <p className="mt-3 text-xs text-dim">Answers come only from {ticker}'s recent headlines and their tags, and are read aloud. No investment advice, price targets or predictions.</p>
    </div>
  );
}

// Bullet lines ("- ...") as the model wrote them, after dropping any line with advice words; older one-paragraph
// briefings fall back to bullets(). Advanced briefings are paragraphs separated by blank lines.
const ADVICE_LINE = /\b(buy|buys|buying|sell|sells|selling|hold|holds|holding|holdings|portfolios?|price targets?)\b/i;
const toBullets = (text = "") => {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => /^[-*•]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+/, ""));
  return lines.length ? lines.filter((l) => !ADVICE_LINE.test(l)).slice(0, 4) : bullets(text);
};
const toParas = (text = "") => text.split(/\n\s*\n/)
  .map((p) => p.replace(/^[-*•]\s+/gm, "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z"])/).filter((x) => !ADVICE_LINE.test(x)).join(" "))
  .filter(Boolean);

// Gemini briefing from this stock's own tagged headlines (/api/briefing): up to 4 bullets, or paragraphs in Advanced
// mode. Talk opens read-aloud (ElevenLabs) and questions.
export function Briefing({ ticker, adv }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [talk, setTalk] = useState(false);
  const [fallback, setFallback] = useState(false); // advanced asked, only the short one is published

  useEffect(() => {
    let live = true;
    setErr(null); setLoading(true); setB(null); setFallback(false);
    const short = () => api(`briefing?ticker=${ticker}`);
    (adv ? api(`briefing?ticker=${ticker}&mode=advanced`).then((r) => (r.status === "ok" ? r : Promise.reject(r))).catch(() => { if (live) setFallback(true); return short(); }) : short())
      .then((r) => live && setB(r)).catch((e) => live && setErr(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [ticker, adv]);
  useEffect(() => setTalk(false), [ticker]);

  const ok = b?.status === "ok";
  const long = ok && b.mode === "advanced";
  const pts = ok && !long ? toBullets(b.text) : [];
  const paras = long ? toParas(b.text) : [];
  return (
    <section className="kd-box mt-6 p-5" aria-label="Briefing">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-[17px] font-medium text-ink"><span className="text-amber">✦</span>Briefing</h2>
        {ok && (
          <button onClick={() => setTalk(!talk)} aria-expanded={talk} data-testid="talk"
            className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs hover:border-amber hover:text-amber ${talk ? "border-amber text-amber" : "border-line text-ink"}`}>
            <Mic />Talk</button>
        )}
      </div>
      {loading && <div className="mt-4 text-sm text-dim">Reading the latest headlines<span className="animate-pulse">_</span></div>}
      {err && <div className="mt-4 text-sm text-dim">Summary: n/a right now.</div>}
      {b && !ok && <div className="mt-4 text-sm text-dim" data-testid="briefing-unavailable">Briefing: n/a. {b.status === "no_key" ? "No Gemini key is set on this server." : b.message}</div>}
      {ok && (
        <>
          {long ? (
            <div className="mt-4 space-y-3" data-testid="briefing-paragraphs">
              {paras.map((p, i) => <p key={i} className="text-[14px] leading-relaxed text-ink">{p}</p>)}
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5" data-testid="briefing-bullets">
              {pts.map((p, i) => <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-ink"><span className="text-amber">·</span><span>{p}</span></li>)}
              {pts.length === 0 && <li className="text-sm text-dim">Summary: n/a</li>}
            </ul>
          )}
          <div className="mt-3 text-xs text-dim">Written by Gemini ({b.model || "n/a"}) from {b.n} {ticker} headlines, {b.window}. Tags come from Qwen.</div>
          {fallback && <div className="mt-1 text-xs text-dim" data-testid="briefing-long-na">Longer briefing: n/a until the next update. Showing the short one.</div>}
          {talk && <Talk ticker={ticker} briefingId={b.id} mode={b.mode} />}
        </>
      )}
    </section>
  );
}
