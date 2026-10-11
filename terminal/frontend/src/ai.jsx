import { useEffect, useRef, useState } from "react";
import { api, bullets, Dot, fmtDay, headlinesPath, LABELS, TAG, useApi } from "./ui.jsx";

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

// Gemini (summary): up to 4 plain-English bullets from /api/briefing, read aloud through the ElevenLabs endpoint.
export function Briefing({ ticker }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [audio, setAudio] = useState({ state: "idle", msg: null });
  const player = useRef(null);

  const stop = () => { player.current?.pause(); player.current = null; setAudio({ state: "idle", msg: null }); };
  useEffect(() => {
    stop(); setErr(null); setLoading(true); setB(null);
    api(`briefing?ticker=${ticker}`).then(setB).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    return stop;
  }, [ticker]);

  const readAloud = async () => {
    if (audio.state === "playing") return stop();
    setAudio({ state: "loading", msg: null });
    try {
      const h = await api("health");
      if (!h.keys?.ELEVENLABS_API_KEY) throw new Error("n/a on this site");
      const r = await fetch(`/api/briefing/audio?id=${b.id}&ticker=${ticker}`);
      if (!r.ok) throw new Error("n/a right now");
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url);
      player.current = a;
      a.onended = () => { URL.revokeObjectURL(url); setAudio({ state: "idle", msg: null }); };
      await a.play();
      setAudio({ state: "playing", msg: null });
    } catch (e) { setAudio({ state: "idle", msg: e.message }); }
  };

  const ok = b?.status === "ok";
  const pts = ok ? bullets(b.text) : [];
  return (
    <section className="kd-box mt-6 p-5" aria-label="Briefing">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-[17px] font-medium text-ink"><span className="text-amber">✦</span>Briefing</h2>
        {ok && (
          <button onClick={readAloud} disabled={audio.state === "loading"} data-testid="speaker"
            aria-label={audio.state === "playing" ? "Stop reading" : `Read the ${ticker} briefing aloud`}
            className="flex items-center gap-1.5 border border-line px-2.5 py-1.5 text-xs text-ink hover:border-amber hover:text-amber disabled:opacity-40">
            <Speaker on={audio.state === "playing"} />{audio.state === "playing" ? "Stop" : audio.state === "loading" ? "Loading" : "Listen"}</button>
        )}
      </div>
      {loading && <div className="mt-4 text-sm text-dim">Reading the latest headlines<span className="animate-pulse">_</span></div>}
      {err && <div className="mt-4 text-sm text-dim">Summary: n/a right now.</div>}
      {b && !ok && <div className="mt-4 text-sm text-dim" data-testid="briefing-unavailable">Briefing: n/a. {b.status === "no_key" ? "No Gemini key is set on this server." : b.message}</div>}
      {ok && (
        <>
          <ul className="mt-4 space-y-2.5" data-testid="briefing-bullets">
            {pts.map((p, i) => <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-ink"><span className="text-amber">·</span><span>{p}</span></li>)}
            {pts.length === 0 && <li className="text-sm text-dim">Summary: n/a</li>}
          </ul>
          <div className="mt-3 text-xs text-dim">Written by Gemini ({b.model || "n/a"}) from {b.n} headlines, {b.window}. Tags come from Qwen.</div>
          {audio.msg && <div className="mt-1 text-xs text-dim">Listen: {audio.msg}</div>}
        </>
      )}
    </section>
  );
}
