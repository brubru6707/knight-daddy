import { useEffect, useRef, useState } from "react";
import { api, bullets, Dot, fmtDay, TAG, toneOf, useApi } from "./ui.jsx";

// Knight-Daddy AI: tone, Gemini briefing as at most 4 short bullets, and the sentiment breakdown. All from /api/briefing.
export function AiColumn({ ticker }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [audio, setAudio] = useState({ state: "idle", msg: null });
  const player = useRef(null);

  const stop = () => { player.current?.pause(); player.current = null; setAudio({ state: "idle", msg: null }); };
  const load = (refresh = false) => {
    stop(); setErr(null); setLoading(true); setB(null);
    api(`briefing?ticker=${ticker}${refresh ? "&refresh=true" : ""}`).then(setB).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); return stop; /* eslint-disable-next-line */ }, [ticker]);

  const readAloud = async () => {
    if (audio.state === "playing") return stop();
    setAudio({ state: "loading", msg: null });
    try {
      const h = await api("health");
      if (!h.keys?.ELEVENLABS_API_KEY) throw new Error("not available here");
      const r = await fetch(`/api/briefing/audio?id=${b.id}&ticker=${ticker}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url);
      player.current = a;
      a.onended = () => { URL.revokeObjectURL(url); setAudio({ state: "idle", msg: null }); };
      await a.play();
      setAudio({ state: "playing", msg: null });
    } catch (e) { setAudio({ state: "idle", msg: e.message }); }
  };

  const ok = b?.status === "ok";
  const tone = ok ? toneOf(b.counts) : null;
  const pts = ok ? bullets(b.text) : [];
  const total = ok ? (b.counts.Bullish || 0) + (b.counts.Bearish || 0) + (b.counts.Neutral || 0) : 0;
  return (
    <aside aria-label="Knight-Daddy AI" className="kd-box p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-serif text-[19px] font-medium text-ink"><span className="text-amber">✦</span>Knight-Daddy AI</h2>
        <span className="flex gap-3 text-xs text-dim">
          {ok && <button onClick={readAloud} disabled={audio.state === "loading"} className="hover:text-amber disabled:opacity-40">
            {audio.state === "playing" ? "Stop" : audio.state === "loading" ? "Loading audio" : "Read aloud"}</button>}
          <button onClick={() => load(true)} disabled={loading} className="hover:text-amber disabled:opacity-40">Refresh</button>
        </span>
      </div>

      {loading && <div className="mt-5 text-sm text-dim">Reading the latest headlines<span className="animate-pulse">_</span></div>}
      {err && <div className="mt-5 text-sm text-dim">Briefing: n/a <span className="text-xs">({err})</span></div>}
      {b && !ok && <div className="mt-5 text-sm text-dim">Briefing: n/a. {b.status === "no_key" ? "No Gemini key is set on this server." : b.message}</div>}

      {ok && (
        <>
          <div className={`mt-5 flex items-center gap-2 text-[16px] font-semibold ${TAG[tone?.[1]] || "text-dim"}`} data-testid="tone">
            <Dot label={tone?.[1]} className="h-2 w-2" />{tone ? tone[0] : "Tone: n/a"}</div>
          <ul className="mt-4 space-y-2.5" data-testid="briefing-bullets">
            {pts.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-ink"><span className="text-amber">·</span><span>{p}</span></li>
            ))}
            {pts.length === 0 && <li className="text-sm text-dim">Summary: n/a</li>}
          </ul>
          <div className="mt-2 text-xs text-dim">Summary by {b.model || "n/a"} of {b.n} headlines, {b.window}.</div>
          {audio.msg && <div className="mt-1 text-xs text-dim">Read aloud: {audio.msg}</div>}

          <div className="mt-8 border-t border-line pt-6">
            <h3 className="text-sm font-semibold text-ink">Sentiment breakdown</h3>
            <div className="mt-3 flex h-2 w-full gap-px overflow-hidden border border-line" aria-hidden>
              {["Bullish", "Bearish", "Neutral"].map((l) => (b.counts[l] || 0) > 0 && (
                <span key={l} className={l === "Bullish" ? "bg-up" : l === "Bearish" ? "bg-down" : "bg-flat"} style={{ width: `${(b.counts[l] / total) * 100}%` }} />))}
            </div>
            <ul className="mt-3 space-y-2" data-testid="breakdown">
              {["Bullish", "Bearish", "Neutral"].map((l) => (
                <li key={l} className="flex items-center text-sm">
                  <span className={`flex items-center gap-2 ${TAG[l]}`}><Dot label={l} />{l}</span>
                  <span className="ml-auto w-12 text-right text-dim">{total ? Math.round(((b.counts[l] || 0) / total) * 100) : 0}%</span>
                  <span className="w-8 text-right text-ink">{b.counts[l] || 0}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-dim">Based on {total} recent headlines</div>
          </div>
        </>
      )}
      <History ticker={ticker} />
      <p className="mt-8 text-xs text-dim">Knight-Daddy reads how coverage is framed. News sentiment, not investment advice.</p>
    </aside>
  );
}

// Daily headline sentiment stored in Tiger Data (/api/history). Hidden when the site has no history store.
function History({ ticker }) {
  const s = useApi(`history?ticker=${ticker}&days=30`, [ticker]);
  if (s.status === 503 || s.status === 404 || (!s.data && !s.loading && !s.err)) return null; // no history store on this API
  const days = s.data?.days || [];
  const max = Math.max(1, ...days.map((d) => d.Bullish + d.Bearish + d.Neutral));
  return (
    <div className="mt-8 border-t border-line pt-6" data-testid="history">
      <h3 className="text-sm font-semibold text-ink">Sentiment history</h3>
      {s.loading && <div className="mt-3 text-xs text-dim">Loading history<span className="animate-pulse">_</span></div>}
      {s.err && <div className="mt-3 text-xs text-dim">History: n/a ({s.err})</div>}
      {s.data && (days.length === 0 ? <div className="mt-3 text-xs text-dim">History: n/a (no stored headlines yet)</div> : (
        <div className="mt-3 flex h-16 items-end gap-[3px]" aria-label="Daily headline sentiment">
          {days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col-reverse" style={{ height: `${((d.Bullish + d.Bearish + d.Neutral) / max) * 100}%` }}
              title={`${fmtDay(d.day, { month: "short", day: "numeric" })}: ${d.Bullish} bullish, ${d.Bearish} bearish, ${d.Neutral} neutral`}>
              {["Bullish", "Bearish", "Neutral"].map((l) => d[l] > 0 && (
                <span key={l} className={l === "Bullish" ? "bg-up" : l === "Bearish" ? "bg-down" : "bg-flat"} style={{ flexGrow: d[l] }} />))}
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
