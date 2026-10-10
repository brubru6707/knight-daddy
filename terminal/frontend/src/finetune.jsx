import { useEffect, useRef, useState } from "react";
import { api } from "./ui.jsx";

const PHASES = {
  queued: "Queued, waiting for the Oscar GPU", "waiting for GPU": "Waiting for the Oscar GPU", starting: "Starting",
  "loading data": "Loading data", "loading model": "Loading model", "scoring general model": "Scoring the general model",
  training: "Training", "scoring specialist": "Scoring the specialist", saving: "Saving", done: "Done", failed: "Failed",
};

// Fine-tune the ticker specialist through the same train endpoint as before. The train password lives in React state
// only (never stored). Progress is polled from /api/specialist/status every 2 s.
export function FineTune({ ticker, health, info, onTrained }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const [pw, setPw] = useState("");
  const [askPw, setAskPw] = useState(false);
  const timer = useRef(null);
  const needPw = !!health?.train_password_required;
  const online = health ? (health.mode === "vercel" ? !!health.worker_online : !!(health.gpu || health.model_endpoint)) : null;
  const supported = info?.supported?.includes(ticker);
  const running = st && !["done", "failed", "none"].includes(st.phase);

  const follow = () => {
    clearInterval(timer.current);
    const tick = async () => {
      try {
        const d = await api(`specialist/status?ticker=${ticker}`);
        setSt(d);
        if (d.phase === "done" || d.phase === "failed") {
          clearInterval(timer.current);
          if (d.phase === "done" && !d.quick) onTrained?.();
        }
      } catch { /* transient: keep polling */ }
    };
    timer.current = setInterval(tick, 2000);
    tick();
  };
  useEffect(() => {
    setSt(null); setErr(null); setAskPw(false);
    api(`specialist/status?ticker=${ticker}`).then((d) => { setSt(d); if (d.running) follow(); }).catch(() => {});
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const train = async (quick = false) => {
    setErr(null);
    if (needPw && !pw) { setAskPw(true); return; }
    try {
      await api("specialist/train", { method: "POST", body: JSON.stringify({ ticker, quick }),
        headers: { "content-type": "application/json", ...(needPw ? { "x-train-password": pw } : {}) } });
      setAskPw(false);
      setSt({ phase: needPw ? "queued" : "starting", step: 0, total_steps: null, quick });
      follow();
    } catch (e) {
      if (e.status === 401) { setPw(""); setAskPw(true); }
      setErr(e.message);
    }
  };

  const frac = st?.phase === "done" ? 1 : st?.total_steps ? st.step / st.total_steps : 0;
  const pushed = health?.snapshot_pushed_at ? new Date(health.snapshot_pushed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="mt-6 rounded-lg border border-line p-4" aria-label="Fine-tune">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => train(false)} disabled={!supported || running || online === false}
          className="rounded-md border border-amber px-4 py-2 text-sm font-semibold text-amber hover:bg-amber hover:text-ground disabled:cursor-not-allowed disabled:opacity-40">
          {running ? "Fine-tuning…" : "Fine-tune"}</button>
        {supported && !running && online !== false && (
          <button onClick={() => train(true)} className="text-xs text-dim underline-offset-2 hover:text-amber hover:underline"
            title="Short demo run, about 30 s. Never served or scored.">Quick demo (not scored)</button>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-dim" data-testid="model-status"
          title={pushed ? `Latest data pushed from the Oscar worker ${pushed}` : undefined}>
          <span className={`inline-block h-2 w-2 rounded-full ${online === null ? "bg-dim" : online ? "bg-up" : "bg-down"}`} />
          Model {online === null ? "status n/a" : online ? "online" : "offline"}
        </span>
      </div>
      {askPw && !running && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (pw) train(false); }}>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Train password" aria-label="Train password"
            className="w-56 rounded-md border border-line bg-ground px-3 py-1.5 text-sm text-ink outline-none focus:border-amber" />
          <button className="rounded-md bg-amber px-3 py-1.5 text-sm font-semibold text-ground disabled:opacity-40" disabled={!pw}>Start</button>
        </form>
      )}
      {(running || st?.phase === "done" || st?.phase === "failed") && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-dim">
            <span className={st.phase === "failed" ? "text-down" : ""}>{running ? "" : "Last fine-tune: "}{PHASES[st.phase] || st.phase}{st.quick ? " · quick demo, not scored" : ""}</span>
            {st.total_steps ? <span>step {st.step}/{st.total_steps}</span> : null}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-card" role="progressbar" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-amber transition-all" style={{ width: `${frac * 100}%` }} />
          </div>
          {st.phase === "failed" && st.error && <div className="mt-1 text-xs text-down">{st.error}</div>}
          {st.phase === "queued" && st.note && <div className="mt-1 text-xs text-dim">{st.note}</div>}
        </div>
      )}
      <div className="mt-2 text-xs text-dim">
        {!info ? "Specialist info: n/a"
          : !supported ? `Fine-tuning is available for ${info.supported.join(", ")}.`
          : online === false ? "Model offline, showing latest data. Fine-tuning resumes when the Oscar GPU worker is back."
          : "Fine-tunes our 2B model on this ticker's headlines. It reads news; it is not a trading signal."}
      </div>
      {err && <div className="mt-1 text-xs text-down">{err}</div>}
    </div>
  );
}
