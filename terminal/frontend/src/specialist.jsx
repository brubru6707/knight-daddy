import { useEffect, useRef, useState } from "react";
import { api, Panel } from "./ui.jsx";

const PHASES = {
  starting: "starting", "loading data": "loading data", "loading model": "loading model",
  "scoring general model": "scoring general model (before)", training: "training",
  "scoring specialist": "scoring specialist (after)", saving: "saving", done: "done", failed: "failed",
};
const C = { probe: "#ffb000", ticker: "#3987e5" }; // amber accent + categorical slot 1 (dark step)
const fmtPct = (x) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const ci = (a) => (a ? `${(a[0] * 100).toFixed(0)} to ${(a[1] * 100).toFixed(0)}` : "");

function smooth(arr, w = 5) {
  return arr.map((_, i) => {
    const win = arr.slice(Math.max(0, i - w + 1), i + 1).filter((v) => v !== null && v !== undefined);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

// Loss chart: y-axis from 0 to just above the largest value shown, so a small, honest change stays readable.
export function LossChart({ probe = [], tickerLoss = [], total = 1, probeSource }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 520, H = 190, L = 44, R = 92, T = 12, B = 26;
  const tk = smooth(tickerLoss).map((v, i) => (v === null ? null : [i + 1, v])).filter(Boolean);
  const vals = [...probe.map((p) => p[1]), ...tk.map((p) => p[1])];
  if (!vals.length) return <div className="text-[11px] text-dim">Loss appears here once training starts.</div>;
  // round tick step (1, 2, 2.5 or 5 x 10^k) giving 3 to 5 gridlines; axis always starts at 0
  const raw = Math.max(...vals) * 1.15;
  const mag = 10 ** Math.floor(Math.log10(raw / 4));
  const stepY = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => raw / st <= 5);
  const yMax = Math.ceil(raw / stepY) * stepY;
  const dec = Math.max(0, -Math.floor(Math.log10(stepY)) + (stepY / mag === 2.5 ? 1 : 0));
  const x = (s) => L + (s / Math.max(1, total)) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round(yMax / stepY) + 1 }, (_, i) => i * stepY);
  const near = (pts, s) => pts.reduce((b, p) => (Math.abs(p[0] - s) < Math.abs(b[0] - s) ? p : b), pts[0]);
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const s = Math.round(((e.clientX - r.left) / r.width * W - L) / (W - L - R) * total);
    setHover(Math.max(0, Math.min(total, s)));
  };
  const last = (pts) => pts[pts.length - 1];
  // end labels: keep at least 12px apart so they never overlap
  let yProbe = probe.length ? y(last(probe)[1]) + 3 : null, yTk = tk.length ? y(last(tk)[1]) + 3 : null;
  if (yProbe !== null && yTk !== null && Math.abs(yProbe - yTk) < 12) {
    const mid = (yProbe + yTk) / 2, up = yProbe <= yTk;
    yProbe = mid + (up ? -6 : 6); yTk = mid + (up ? 6 : -6);
  }
  return (
    <div className="relative">
      <div className="mb-1 flex flex-wrap gap-3 text-[10px] text-dim">
        <span><span className="mr-1 inline-block h-[2px] w-4 align-middle" style={{ background: C.probe }} />held-out loss ({probeSource || "never trained on"})</span>
        <span><span className="mr-1 inline-block h-[2px] w-4 align-middle" style={{ background: C.ticker }} />ticker training loss (5-step avg)</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label="Training loss by step">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#1c2229" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#8b9099">{v.toFixed(dec)}</text>
          </g>
        ))}
        {[0, Math.round(total / 2), total].map((s) => (
          <text key={s} x={x(s)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8b9099">step {s}</text>
        ))}
        {tk.length > 1 && <path d={path(tk)} fill="none" stroke={C.ticker} strokeWidth="1.5" />}
        {probe.length > 1 && <path d={path(probe)} fill="none" stroke={C.probe} strokeWidth="2" />}
        {probe.map((p) => <circle key={p[0]} cx={x(p[0])} cy={y(p[1])} r="2.5" fill={C.probe} stroke="#0e1114" strokeWidth="1" />)}
        {probe.length > 0 && <text x={x(last(probe)[0]) + 6} y={yProbe} fontSize="10" fill="#e6e3d8">held-out {last(probe)[1].toFixed(3)}</text>}
        {tk.length > 0 && <text x={x(last(tk)[0]) + 6} y={yTk} fontSize="10" fill="#e6e3d8">ticker {last(tk)[1].toFixed(3)}</text>}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#8b9099" strokeDasharray="2 3" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-6 rounded-none border border-line bg-ground px-2 py-1 text-[10px]"
          style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
          <div className="text-dim">step {hover}</div>
          {probe.length > 0 && <div>held-out {near(probe, hover)[1].toFixed(3)} <span className="text-dim">(step {near(probe, hover)[0]})</span></div>}
          {tk.length > 0 && <div>ticker {near(tk, hover)[1].toFixed(3)}</div>}
        </div>
      )}
    </div>
  );
}

function Results({ ev }) {
  if (!ev) return null;
  if (ev.status === "no_run") return <div className="text-dim">{ev.message}</div>;
  const agree = ev.agreement_with_teacher;
  const side = (
    <div className="mt-2 space-y-1 text-[11px] text-dim">
      {agree && (
        <div>Agreement with the 9B teacher (not accuracy): general {fmtPct(agree.general)}, specialist {fmtPct(agree.specialist)},
          on {agree.n} held-out headlines.</div>
      )}
      <div>Tags changed on the {ev.n_test_rows} test headlines: {ev.changed_on_test_rows}.</div>
    </div>
  );
  if (ev.status !== "scored") {
    return (
      <div>
        <div className="border border-amber/60 px-2 py-2">
          <div className="font-bold text-amber">NO HUMAN TEST LABELS YET</div>
          <div className="text-[11px]">{ev.message} Before/after scores appear when teammates return their hand labels.</div>
        </div>
        {side}
      </div>
    );
  }
  const m = ev.models, c = ev.comparison;
  const rows = ["general", "specialist", "teacher"];
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-right text-[11px]">
          <thead className="text-dim"><tr>
            <th className="text-left font-normal">model (n={ev.n_scored} human labels)</th>
            <th className="font-normal">accuracy [95% CI]</th><th className="font-normal">macro F1 [95% CI]</th>
            <th className="font-normal">F1 bear</th><th className="font-normal">F1 bull</th><th className="font-normal">F1 neut</th>
          </tr></thead>
          <tbody>{rows.map((k) => {
            const r = m[k], pc = r.per_class_f1;
            return (
              <tr key={k} className={`border-t border-line/60 ${k === "teacher" ? "text-dim" : ""}`}>
                <td className="text-left">{r.name}</td>
                <td>{fmtPct(r.accuracy)} <span className="text-dim">[{ci(r.accuracy_ci95)}]</span></td>
                <td>{r.macro_f1.toFixed(3)} <span className="text-dim">[{ci(r.macro_f1_ci95)}]</span></td>
                {["Bearish", "Bullish", "Neutral"].map((l) => (
                  <td key={l}>{pc[l].f1.toFixed(2)} <span className="text-dim">n={pc[l].n}</span></td>))}
              </tr>);
          })}</tbody>
        </table>
      </div>
      <div className="mt-2 border-l-2 border-amber pl-2 text-[11px]">
        <span className="text-amber">VERDICT </span>
        {c.verdict === "no clear difference" ? "No clear difference between the specialist and the general model."
          : `The specialist is ${c.verdict} than the general model.`}{" "}
        Accuracy change {(c.accuracy_diff * 100).toFixed(1)} pts (95% CI {(c.accuracy_diff_ci95[0] * 100).toFixed(1)} to {(c.accuracy_diff_ci95[1] * 100).toFixed(1)}),
        McNemar p = {c.mcnemar.p.toFixed(3)} (specialist fixed {c.mcnemar.specialist_right_general_wrong}, broke {c.mcnemar.general_right_specialist_wrong}).
        <span className="text-dim"> Rule fixed in advance: better or worse only if the CI excludes 0.</span>
      </div>
      {ev.disagreements?.length > 0 && (
        <ul className="mt-2 text-[11px]">
          <li className="text-dim">Where the two models disagree (human label in amber):</li>
          {ev.disagreements.slice(0, 6).map((d) => (
            <li key={d.id} className="border-b border-line/60 py-0.5">
              <span className="text-dim">{d.general_label.slice(0, 4).toUpperCase()} to {d.specialist_label.slice(0, 4).toUpperCase()}</span>{" "}
              <span className="text-amber">[{d.human.slice(0, 4).toUpperCase()}]</span> {d.text}
            </li>))}
        </ul>
      )}
      {side}
    </div>
  );
}

export function SpecialistPanel({ ticker, onTrained }) {
  const [info, setInfo] = useState(null);
  const [st, setSt] = useState(null);
  const [ev, setEv] = useState(null);
  const [err, setErr] = useState(null);
  const esRef = useRef(null);
  const supported = info?.supported?.includes(ticker);

  const loadEval = () => api(`specialist/eval?ticker=${ticker}`).then(setEv).catch((e) => setErr(e.message));
  const follow = () => {
    esRef.current?.close();
    const es = new EventSource(`/api/specialist/stream?ticker=${ticker}`);
    esRef.current = es;
    es.onmessage = (m) => {
      const d = JSON.parse(m.data);
      setSt(d);
      if (d.phase === "done" || d.phase === "failed") {
        es.close();
        if (d.phase === "done") { loadEval(); onTrained?.(); }
      }
    };
    es.onerror = () => { es.close(); }; // status is still refreshed when the panel reloads
  };

  useEffect(() => {
    setSt(null); setEv(null); setErr(null);
    api("specialist/info").then(setInfo).catch(() => setInfo(null));
    api(`specialist/status?ticker=${ticker}`).then((d) => {
      setSt(d);
      if (d.running) follow(); else if (d.phase === "done") loadEval();
    }).catch(() => {});
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const train = async () => {
    setErr(null); setEv(null);
    try {
      await api("specialist/train", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker }) });
      setSt({ phase: "starting", step: 0, total_steps: null, losses: [] });
      follow();
    } catch (e) { setErr(e.message); }
  };

  const running = st && !["done", "failed", "none"].includes(st.phase);
  const frac = st?.total_steps ? st.step / st.total_steps : 0;
  const right = supported
    ? <button onClick={train} disabled={running} className="border border-amber px-2 text-amber hover:bg-amber hover:text-ground disabled:opacity-40">{running ? "TRAINING" : "TRAIN"}</button>
    : null;
  return (
    <Panel code="SPC" title="stock-specific news analyst" className="h-full" right={right}>
      <div className="mb-2 text-[11px] text-dim">
        Fine-tunes our 2B model on {ticker} headlines (labeled by our 9B model), then checks it against headlines our
        teammates labeled by hand. It reads news; it is not a trading signal.
      </div>
      {info && !supported && (
        <div className="text-dim">Specialists need a hand-labeled test set; available for {info.supported.join(", ")}.</div>
      )}
      {err && <div className="text-down">ERR {err}</div>}
      {supported && (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[300px] flex-1">
            <div className="mb-1 flex flex-wrap gap-3 text-[11px]">
              <span className="text-amber">{st ? (PHASES[st.phase] || st.phase).toUpperCase() : "IDLE"}</span>
              {st?.total_steps ? <span>step {st.step}/{st.total_steps}</span> : null}
              {st?.elapsed_s !== undefined && st.phase !== "none" ? <span className="text-dim">{Math.round(st.elapsed_s)}s elapsed</span> : null}
              {running && st?.eta_s ? <span className="text-dim">about {Math.round(st.eta_s)}s left in training</span> : null}
            </div>
            <div className="mb-2 h-2 w-full border border-line bg-ground" role="progressbar" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-amber transition-all" style={{ width: `${st?.phase === "done" ? 100 : frac * 100}%` }} />
            </div>
            {st?.data && (
              <div className="mb-1 text-[10px] text-dim">
                {st.data.ticker_examples} {ticker} headlines (9B labels, before Jul 2023) + {st.data.general_examples} general examples so it keeps its general skill.
              </div>
            )}
            {st?.phase === "failed" && <div className="text-down">FAILED {st.error}</div>}
            {st && st.phase !== "none" && <LossChart probe={st.probe} tickerLoss={st.loss_ticker} total={st.total_steps || 1} probeSource={st.probe_source} />}
            {st?.probe?.length > 0 && (
              <div className="mt-1 text-[10px] text-dim">
                Loss starts low because training begins from our already-trained general model. The held-out line is the honest one.
              </div>
            )}
          </div>
          <div className="min-w-[300px] flex-1">
            <div className="mb-1 text-[11px] text-amber">BEFORE / AFTER on hand-labeled {ticker} headlines (Jul to Dec 2023)</div>
            {ev ? <Results ev={ev} /> : <div className="text-[11px] text-dim">{running ? "Scores appear when training finishes." : "Press TRAIN to build a specialist."}</div>}
          </div>
        </div>
      )}
    </Panel>
  );
}
