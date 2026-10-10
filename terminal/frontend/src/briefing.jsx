import { useEffect, useRef, useState } from "react";
import { api, Panel } from "./ui.jsx";

// Stretch 9 + 10: Gemini briefing of today's model-tagged headlines, with ElevenLabs read-aloud.
export function BriefingPanel({ ticker }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [audio, setAudio] = useState({ state: "idle", msg: null }); // idle | loading | playing
  const player = useRef(null);

  const stop = () => { player.current?.pause(); player.current = null; setAudio({ state: "idle", msg: null }); };
  const load = (refresh = false) => {
    stop(); setErr(null); setLoading(true); if (refresh) setB(null);
    api(`briefing?ticker=${ticker}${refresh ? "&refresh=true" : ""}`)
      .then(setB).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { setB(null); load(); return stop; /* eslint-disable-next-line */ }, [ticker]);

  const readAloud = async () => {
    if (audio.state === "playing") return stop();
    setAudio({ state: "loading", msg: null });
    try {
      // check the key first (re-read on every click) so we never fire a request that is certain to fail
      const h = await api("health");
      if (!h.keys?.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set in terminal/.env");
      const r = await fetch(`/api/briefing/audio?id=${b.id}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const a = new Audio(url);
      player.current = a;
      a.onended = () => { URL.revokeObjectURL(url); setAudio({ state: "idle", msg: null }); };
      await a.play();
      setAudio({ state: "playing", msg: null });
    } catch (e) {
      setAudio({ state: "idle", msg: e.message });
    }
  };

  const ok = b?.status === "ok";
  const right = (
    <span className="flex gap-2">
      {ok && (
        <button onClick={readAloud} disabled={audio.state === "loading"}
          className="border border-amber px-2 text-amber hover:bg-amber hover:text-ground disabled:opacity-40">
          {audio.state === "playing" ? "STOP" : audio.state === "loading" ? "LOADING AUDIO" : "READ ALOUD"}
        </button>
      )}
      <button onClick={() => load(true)} disabled={loading} className="hover:text-ink disabled:opacity-40">refresh</button>
    </span>
  );
  return (
    <Panel code="BRF" title="AI news briefing" className="h-full" right={right}>
      {loading && <div className="text-dim">writing briefing from today's tagged headlines<span className="animate-pulse">_</span></div>}
      {err && <div className="text-down">ERR {err}</div>}
      {b && b.status !== "ok" && (
        <div className="text-dim">
          {b.status === "no_key" ? "Briefing unavailable: GEMINI_API_KEY is not set in terminal/.env." : b.message}
        </div>
      )}
      {ok && (
        <div className="flex flex-col gap-1">
          <p className="max-w-[110ch] text-[12.5px] leading-relaxed text-ink">{b.text}</p>
          <div className="flex flex-wrap gap-3 text-[10px] text-dim">
            <span>{b.n} headlines, {b.window}</span>
            <span>tags: <span className="text-up">{b.counts.Bullish} bull</span> / <span className="text-down">{b.counts.Bearish} bear</span> / <span className="text-flat">{b.counts.Neutral} neut</span></span>
            <span>news: {b.provider}</span>
            <span>written by {b.model}{b.guard !== "passed" ? `, ${b.guard}` : ""}</span>
          </div>
          <div className="text-[10px] text-dim">
            AI summary of the headlines in the feed only. It describes news; it does not predict prices or give advice.
          </div>
          {audio.msg && <div className="text-[11px] text-down">Read aloud unavailable: {audio.msg}</div>}
        </div>
      )}
    </Panel>
  );
}
