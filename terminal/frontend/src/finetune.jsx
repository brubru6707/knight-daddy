import { useEffect, useRef, useState } from "react";
import { smoothPath } from "./price.jsx";
import { api, setPw as savePw, useSavedPw, useWidth, withPw } from "./ui.jsx";

const PHASES = {
  queued: "Queued, waiting for the Oscar GPU", "waiting for GPU": "Waiting for the Oscar GPU", starting: "Starting",
  "loading data": "Loading data", "loading model": "Loading model", "scoring general model": "Scoring the general model",
  training: "Training", "scoring specialist": "Scoring the specialist", saving: "Saving", done: "Done", failed: "Failed",
};
const clock = (s) => (s === null || s === undefined ? null : s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`);

// Training loss as it happens (Advanced): each step's batch loss (faint), a smoothed line, and the held-out probe loss
// (headlines never trained on, measured every few steps, dashed). All from the trainer's progress, polled every 2 s.
function LossChart({ st }) {
  const [ref, w] = useWidth();
  const raw = st.losses || [], probe = (st.probe || []).filter((p) => Array.isArray(p) && typeof p[1] === "number");
  const total = Math.max(st.total_steps || 0, raw.length, 1);
  const ema = []; raw.forEach((v, i) => ema.push(i ? ema[i - 1] * 0.8 + v * 0.2 : v));
  const all = [...raw, ...probe.map((p) => p[1])];
  const H = 64, lo = 0, hi = Math.max(...all, 0.01) * 1.08;
  const X = (i) => (i / Math.max(1, total - 1)) * w, Y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (H - 6);
  const pts = (arr) => arr.map((v, i) => [X(i), Y(v)]);
  return (
    <div className="mt-3" data-testid="loss-chart">
      <div className="mb-1 flex justify-between text-[11px] text-dim">
        <span>Training loss{raw.length ? ` ${ema.at(-1).toFixed(3)}` : ""}{probe.length ? ` · held-out ${probe.at(-1)[1].toFixed(3)}` : ""}</span>
        <span>step {raw.length}/{st.total_steps || "n/a"}</span>
      </div>
      <div ref={ref} className="w-full border border-line bg-card">
        {w > 0 && (raw.length > 1 ? (
          <svg width={w} height={H} role="img" aria-label="Training loss by step">
            <path d={pts(raw).map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("")} fill="none" style={{ stroke: "var(--kd-dim)", opacity: 0.35 }} strokeWidth="1" />
            <path d={smoothPath(pts(ema))} fill="none" style={{ stroke: "var(--kd-chart)" }} strokeWidth="1.75" />
            {probe.length > 1 && <path d={probe.map(([s, v], i) => `${i ? "L" : "M"}${X(s)},${Y(v)}`).join("")} fill="none" style={{ stroke: "var(--kd-up)" }} strokeWidth="1.5" strokeDasharray="4 3" />}
          </svg>
        ) : <div className="flex items-center justify-center text-[11px] text-dim" style={{ height: H }}>Loss appears once training starts</div>)}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-dim">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-amber" />smoothed</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-dim opacity-50" />each step</span>
        {probe.length > 0 && <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-up" />held-out headlines</span>}
      </div>
    </div>
  );
}

// Fine-tune a ticker specialist through the password-protected train endpoint. Every run starts from a fresh copy of the
// general model on Oscar (never from an earlier specialist). Progress and elapsed time come from /api/specialist/status,
// polled every 2 s. The train password is asked once, then saved in this browser and reused; a 401 asks again.
// Advanced mode shows everything (active model, status dot, steps, elapsed time, quick run, the long explanation);
// otherwise the same button and box with plain wording, a simple progress state and a Done check.
export function FineTune({ ticker, health, info, active, adv, onActive, onTrained }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const saved = useSavedPw();
  const [pw, setPw] = useState("");
  const [ask, setAsk] = useState(null); // "train" | "quick" | "reset" while the password box is open
  const timer = useRef(null);
  const needPw = !!health?.train_password_required;
  const online = health ? (health.mode === "vercel" ? !!health.worker_online : !!(health.gpu || health.model_endpoint)) : null;
  const stocks = (info?.supported || []).filter((t) => t !== "CRYPTO");
  const supported = stocks.includes(ticker);
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
    setSt(null); setErr(null); setAsk(null);
    api(`specialist/status?ticker=${ticker}`).then((d) => { setSt(d); if (d.running) follow(); }).catch(() => {});
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const run = async (what, typed = "") => {
    setErr(null);
    const key = typed || saved;
    if (needPw && !key) { setAsk(what); return; }
    try {
      if (what === "reset") {
        const r = await withPw("specialist/reset", { ticker }, key);
        onActive?.(r.active);
      } else {
        const quick = what === "quick";
        await withPw("specialist/train", { ticker, quick }, key);
        setSt({ phase: needPw ? "queued" : "starting", step: 0, total_steps: null, quick });
        follow();
      }
      if (typed) savePw(typed); // accepted: remember it on this device
      setAsk(null); setPw("");
    } catch (e) {
      if (e.status === 401) { setPw(""); setAsk(what); setErr("Wrong train password. Enter it again."); return; }
      setErr(e.message);
    }
  };

  const frac = st?.phase === "done" ? 1 : st?.total_steps ? st.step / st.total_steps : 0;
  const elapsed = clock(st?.phase === "queued" ? st.queued_s : st?.elapsed_s);
  if (!adv) {
    const done = st?.phase === "done" && !st.quick, failed = st?.phase === "failed";
    return (
      <section className="kd-box mt-6 p-5" aria-label="Fine-tune">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => run("train")} disabled={!supported || running || online === false}
            className="border border-rule bg-ink px-4 py-2 text-sm font-semibold text-ground hover:bg-amber hover:border-amber disabled:cursor-not-allowed disabled:opacity-40">
            {running ? "Tuning…" : "Tune to this stock"}</button>
          {active === "specialist" && !running && (
            <button onClick={() => run("reset")} className="border border-rule px-4 py-2 text-sm text-ink hover:border-amber hover:text-amber">
              Undo tuning</button>
          )}
        </div>
        {ask && !running && (
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (pw) run(ask, pw); }}>
            <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Train password" aria-label="Train password"
              className="w-56 border border-line bg-ground px-3 py-1.5 text-sm text-ink outline-none focus:border-amber" />
            <button className="bg-amber px-3 py-1.5 text-sm font-semibold text-ground disabled:opacity-40" disabled={!pw}>{ask === "reset" ? "Undo" : "Start"}</button>
          </form>
        )}
        {(running || done || failed) && (
          <div className="mt-4" data-testid="train-progress">
            <div className="mb-1.5 text-xs text-dim" data-testid="simple-state">
              {running ? "Tuning…" : done ? <span className="text-up">✓ Done</span> : <span className="text-down">Didn't finish. Try again later.</span>}</div>
            <div className="h-2 w-full overflow-hidden border border-line bg-card" role="progressbar" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-up transition-all" style={{ width: `${frac * 100}%` }} />
            </div>
          </div>
        )}
        <div className="mt-3 text-xs text-dim" data-testid="tune-caption">
          {online === false ? "Tuning is offline right now." : !info || supported ? "Trains the model on this stock's news so it reads these headlines more accurately. About a minute."
            : `Tuning is available for ${stocks.join(", ")}.`}</div>
        {err && <div className="mt-1 text-xs text-down">{err}</div>}
      </section>
    );
  }
  return (
    <section className="kd-box mt-6 p-5" aria-label="Fine-tune">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink" data-testid="active-model">Active model: {active === "specialist" ? `${ticker} specialist` : "general"}</div>
        <span className="flex items-center gap-1.5 text-xs text-dim" data-testid="model-status">
          <span className={`inline-block h-2 w-2 rounded-full ${online === null ? "bg-dim" : online ? "bg-up" : "bg-down"}`} />
          Model {online === null ? "status n/a" : online ? "online" : "offline"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => run("train")} disabled={!supported || running || online === false}
          className="border border-rule bg-ink px-4 py-2 text-sm font-semibold text-ground hover:bg-amber hover:border-amber disabled:cursor-not-allowed disabled:opacity-40">
          {running ? "Fine-tuning…" : "Fine-tune to this stock"}</button>
        {active === "specialist" && !running && (
          <button onClick={() => run("reset")} className="border border-rule px-4 py-2 text-sm text-ink hover:border-amber hover:text-amber">
            Reset to general model</button>
        )}
        {supported && !running && online !== false && (
          <button onClick={() => run("quick")} className="text-xs text-dim underline-offset-2 hover:text-amber hover:underline"
            title="Short run, about 30 s. Never served or scored.">Quick run (not scored)</button>
        )}
      </div>
      {ask && !running && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (pw) run(ask, pw); }}>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Train password" aria-label="Train password"
            className="w-56 border border-line bg-ground px-3 py-1.5 text-sm text-ink outline-none focus:border-amber" />
          <button className="bg-amber px-3 py-1.5 text-sm font-semibold text-ground disabled:opacity-40" disabled={!pw}>
            {ask === "reset" ? "Reset" : "Start"}</button>
        </form>
      )}
      {(running || st?.phase === "done" || st?.phase === "failed") && (
        <div className="mt-4" data-testid="train-progress">
          <div className="mb-1.5 flex justify-between gap-3 text-xs text-dim">
            <span className={st.phase === "failed" ? "text-down" : ""}>{running ? "" : "Last fine-tune: "}{PHASES[st.phase] || st.phase}{st.quick ? " · quick run, not scored" : ""}</span>
            <span>{[st.total_steps ? `step ${st.step}/${st.total_steps}` : null, elapsed ? `${elapsed} elapsed` : null].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="h-2 w-full overflow-hidden border border-line bg-card" role="progressbar" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-up transition-all" style={{ width: `${frac * 100}%` }} />
          </div>
          {st.phase === "failed" && st.error && <div className="mt-1 text-xs text-down">{st.error}</div>}
          {st.phase === "queued" && st.note && <div className="mt-1 text-xs text-dim">{st.note}</div>}
          {st.phase !== "queued" && <LossChart st={st} />}
        </div>
      )}
      <div className="mt-3 text-xs text-dim">
        {!info ? "Specialist info: n/a"
          : !supported ? `Fine-tuning is available for ${stocks.join(", ")}.`
          : online === false ? "Model offline, showing latest data. Fine-tuning resumes when the Oscar GPU worker is back."
          : "Each fine-tune starts from a fresh copy of the general model and trains on this stock's headlines. It reads news; it is not a trading signal."}
      </div>
      {err && <div className="mt-1 text-xs text-down">{err}</div>}
    </section>
  );
}
