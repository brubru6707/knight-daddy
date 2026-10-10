import { useEffect, useRef, useState } from "react";
import { api, Panel, Signal } from "./ui.jsx";

const PHASES = {
  queued: "queued, waiting for the Oscar GPU", "waiting for GPU": "waiting for the Oscar GPU", starting: "starting", "loading data": "loading data", "loading model": "loading model",
  "scoring general model": "scoring general model (before)", training: "training",
  "scoring specialist": "scoring specialist (after)", saving: "saving", done: "done", failed: "failed",
};
const C = { probe: "#ffb000", ticker: "#3987e5" }; // amber accent + categorical slot 1 (dark step)
const fmtPct = (x) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const ci = (a) => (a ? `${(a[0] * 100).toFixed(0)} to ${(a[1] * 100).toFixed(0)}` : "");
const pts = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;

// Who labeled the test set. Precomputed Claude-labeled results carry label_source; teammates' CSVs do not.
const isClaude = (ev) => /claude/i.test(ev?.label_source || "");
const sourceWord = (ev) => (isClaude(ev) ? "Claude labels" : "human labels");
export function LabelBadge({ ev }) {
  if (!isClaude(ev)) return <span className="border border-up/50 px-1 text-[10px] text-up">HUMAN-LABELED</span>;
  const sc = ev.spot_check || {};
  return (
    <span className="border border-amber/60 px-1 text-[10px] text-amber"
      title={`${ev.label_source}. Answer key written by Claude from headline text only. Human spot check: ${sc.filled || 0} of ${sc.total || 0} rows reviewed${sc.filled ? `, ${sc.agree} agree` : ""}.`}>
      CLAUDE-LABELED · not human-labeled · spot check {sc.filled || 0}/{sc.total || 0}{sc.filled ? ` (${sc.agree} agree)` : ""}
    </span>
  );
}

// Verdict rule fixed in advance: better or worse only if the 95% CI of the accuracy change excludes 0.
export const Verdict = ({ c }) => c.verdict === "no clear difference"
  ? <Signal label="Neutral" word="No clear difference (CI includes 0)." title="Rule fixed in advance: better or worse only if the 95% CI excludes 0." />
  : <Signal label={c.verdict === "better" ? "Bullish" : "Bearish"} word={`Specialist ${c.verdict} (CI excludes 0).`} />;

// Before/after for every hand-scored ticker in one glance: general 2B vs specialist, accuracy and macro F1.
function Summary({ evs }) {
  const scored = Object.entries(evs).filter(([, e]) => e?.status === "scored");
  if (!scored.length) return null;
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="text-amber">BEFORE → AFTER</span><span className="text-dim">general 2B → specialist, Jul to Dec 2023 test headlines</span>
        <LabelBadge ev={scored[0][1]} />
      </div>
      <table className="w-full text-right text-[11px]">
        <thead className="text-[10px] text-dim"><tr>
          <th className="text-left font-normal">ticker</th><th className="font-normal">n</th><th className="font-normal">accuracy</th>
          <th className="font-normal">&#916; acc [95% CI]</th><th className="font-normal">macro F1</th><th className="pl-3 text-left font-normal">verdict</th>
        </tr></thead>
        <tbody>{scored.map(([t, e]) => { const g = e.models.general, s = e.models.specialist, c = e.comparison; return (
          <tr key={t} className="border-t border-line/60">
            <td className="text-left font-bold">{t}</td><td className="text-dim">{e.n_scored}</td>
            <td>{fmtPct(g.accuracy)} <span className="text-dim">→</span> <b>{fmtPct(s.accuracy)}</b></td>
            <td className={c.accuracy_diff_ci95[0] > 0 ? "text-up" : c.accuracy_diff_ci95[1] < 0 ? "text-down" : ""}>
              {pts(c.accuracy_diff)} <span className="text-dim">[{pts(c.accuracy_diff_ci95[0])}, {pts(c.accuracy_diff_ci95[1])}]</span></td>
            <td>{g.macro_f1.toFixed(3)} <span className="text-dim">→</span> <b>{s.macro_f1.toFixed(3)}</b></td>
            <td className="pl-3 text-left"><Verdict c={c} /></td>
          </tr>); })}</tbody>
      </table>
    </div>
  );
}

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

function QuickResult({ st }) {
  const agree = st.agreement_with_teacher;
  return (
    <div>
      <div className="border border-amber/60 px-2 py-2">
        <div className="font-bold text-amber">QUICK DEMO RUN, not scored</div>
        <div className="text-[11px]">A short run ({st.data?.ticker_examples} + {st.data?.general_examples} examples) to show training live.
          It is never served or scored; use TRAIN for the real run.</div>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-dim">
        {agree && <div>Agreement with {st.ticker === "CRYPTO" ? "author tags" : "the 9B teacher (not accuracy)"} on {agree.n} held-out rows:
          general {fmtPct(agree.general)}, specialist {fmtPct(agree.specialist)}.</div>}
        {st.changed_on_test_rows !== undefined && <div>Tags changed on a 64-row sample: {st.changed_on_test_rows}.</div>}
      </div>
    </div>
  );
}

function BinaryResults({ ev }) {
  const m = ev.models, c = ev.comparison;
  return (
    <div>
      <div className="mb-1 border border-amber/60 px-2 py-1 text-[11px]"><span className="text-amber">NO NEUTRAL CLASS. </span>{ev.no_neutral_note}</div>
      <table className="w-full text-right text-[11px]">
        <thead className="text-dim"><tr><th className="text-left font-normal">model (n={ev.n_scored}, {ev.label_source})</th>
          <th className="font-normal">binary accuracy [95% CI]</th></tr></thead>
        <tbody>{["general", "specialist"].map((k) => (
          <tr key={k} className="border-t border-line/60"><td className="text-left">{m[k].name}</td>
            <td>{fmtPct(m[k].binary_accuracy)} <span className="text-dim">[{ci(m[k].binary_accuracy_ci95)}]</span></td></tr>))}
        </tbody>
      </table>
      <div className="mt-2 border-l-2 border-amber pl-2 text-[11px]">
        <span className="text-amber">VERDICT </span>
        {c.verdict === "no clear difference" ? "No clear difference." : `The specialist is ${c.verdict} than the general model.`}{" "}
        Change {(c.accuracy_diff * 100).toFixed(1)} pts (95% CI {(c.accuracy_diff_ci95[0] * 100).toFixed(1)} to {(c.accuracy_diff_ci95[1] * 100).toFixed(1)}),
        McNemar p = {c.mcnemar.p.toExponential(1)}. <span className="text-dim">Rule fixed in advance: better or worse only if the CI excludes 0.</span>
      </div>
      <div className="mt-2 text-[11px] text-dim">{ev.note}</div>
    </div>
  );
}

function Results({ ev, testSet }) {
  if (!ev) return null;
  if (ev.status === "no_run") return <div className="text-dim">{ev.message}</div>;
  if (ev.status === "scored_binary") return <BinaryResults ev={ev} />;
  const agree = ev.agreement_with_teacher;
  const side = (
    <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-dim">
      {agree && (
        <span title={`Agreement with the 9B teacher on ${agree.n} held-out headlines. Agreement is not accuracy.`}>
          9B agreement {fmtPct(agree.general)} → {fmtPct(agree.specialist)}</span>
      )}
      <span>{ev.changed_on_test_rows}/{ev.n_test_rows} test tags changed</span>
    </div>
  );
  if (ev.status !== "scored") {
    return (
      <div>
        <div className="border border-amber/60 px-2 py-2">
          <div className="font-bold text-amber">{testSet === "teacher" ? "NO HUMAN TEST SET FOR THIS TICKER" : "NO HUMAN TEST LABELS YET"}</div>
          <div className="text-[11px]">{testSet === "teacher"
            ? "Only agreement with our 9B model is shown below. Agreement is not accuracy."
            : `${ev.message} Before/after scores appear when teammates return their hand labels.`}</div>
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
          <thead className="text-[10px] text-dim"><tr>
            <th className="text-left font-normal">model (n={ev.n_scored} {sourceWord(ev)})</th>
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
      <div className="mt-1 flex flex-wrap items-center gap-x-3 border-l-2 border-amber pl-2 text-[11px]">
        <span className="text-amber">VERDICT</span><Verdict c={c} />
        <span>&#916; acc {pts(c.accuracy_diff)} pts <span className="text-dim">[{pts(c.accuracy_diff_ci95[0])}, {pts(c.accuracy_diff_ci95[1])}]</span></span>
        <span className="text-dim" title="Exact McNemar test on paired correctness">McNemar p={c.mcnemar.p.toFixed(3)} · fixed {c.mcnemar.specialist_right_general_wrong} / broke {c.mcnemar.general_right_specialist_wrong}</span>
      </div>
      {ev.disagreements?.length > 0 && (
        <details className="mt-1 text-[11px]">
          <summary className="cursor-pointer text-[10px] text-dim hover:text-amber">{ev.disagreements.length} headlines where the models disagree ({sourceWord(ev).replace(" labels", "")} label in amber)</summary>
          <ul>{ev.disagreements.map((d) => (
            <li key={d.id} className="border-b border-line/60 py-0.5">
              <span className="text-dim">{d.general_label.slice(0, 4).toUpperCase()} → {d.specialist_label.slice(0, 4).toUpperCase()}</span>{" "}
              <span className="text-amber">[{d.human.slice(0, 4).toUpperCase()}]</span> {d.text}
            </li>))}</ul>
        </details>
      )}
      {side}
    </div>
  );
}

export function SpecialistPanel({ ticker: dashTicker, onTrained, fold }) {
  const [info, setInfo] = useState(null);
  const [evs, setEvs] = useState({}); // results for every hand-scored ticker, for the summary table
  const [evsVersion, setEvsVersion] = useState(0);
  useEffect(() => {
    const hand = Object.entries(info?.tickers || {}).filter(([, m]) => m.test_set === "hand").map(([t]) => t);
    Promise.all(hand.map((t) => api(`specialist/eval?ticker=${t}`).then((e) => [t, e]).catch(() => [t, null])))
      .then((r) => setEvs(Object.fromEntries(r)));
  }, [info, evsVersion]);
  const [pick, setPick] = useState(null); // SPC has its own ticker (CRYPTO is not a dashboard ticker)
  const ticker = pick || dashTicker;
  useEffect(() => { setPick(null); }, [dashTicker]);
  const [st, setSt] = useState(null);
  const [ev, setEv] = useState(null);
  const [err, setErr] = useState(null);
  const [health, setHealth] = useState(null);
  const [pw, setPw] = useState("");
  const esRef = useRef(null);
  const needPw = !!health?.train_password_required;
  const supported = info?.supported?.includes(ticker);
  const meta = info?.tickers?.[ticker] || {};
  const testSet = meta.test_set;

  const loadEval = () => api(`specialist/eval?ticker=${ticker}`).then(setEv).catch((e) => setErr(e.message));
  // Poll status every 2 s (works locally and on the public site, where Oscar pushes progress to Vercel).
  const follow = () => {
    clearInterval(esRef.current);
    const tick = async () => {
      try {
        const d = await api(`specialist/status?ticker=${ticker}`);
        setSt(d);
        if (d.phase === "done" || d.phase === "failed") {
          clearInterval(esRef.current);
          if (d.phase === "done") { if (!d.quick) { loadEval(); setEvsVersion((v) => v + 1); onTrained?.(); } }
        }
      } catch { /* transient network error: keep polling */ }
    };
    esRef.current = setInterval(tick, 2000);
    tick();
  };

  useEffect(() => {
    setSt(null); setEv(null); setErr(null);
    api("specialist/info").then(setInfo).catch(() => setInfo(null));
    api(`specialist/status?ticker=${ticker}`).then((d) => {
      setSt(d);
      if (d.running) follow(); else if (d.phase === "done" && !d.quick) loadEval();
    }).catch(() => {});
    api("health").then(setHealth).catch(() => setHealth(null));
    return () => clearInterval(esRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const train = async (quick = false) => {
    setErr(null); setEv(null);
    try {
      if (needPw && !pw) throw new Error("Enter the train password first.");
      await api("specialist/train", { method: "POST", body: JSON.stringify({ ticker, quick }),
        headers: { "content-type": "application/json", ...(needPw ? { "x-train-password": pw } : {}) } });
      setSt({ phase: needPw ? "queued" : "starting", step: 0, total_steps: null, losses: [], quick });
      follow();
    } catch (e) { setErr(e.message); }
  };

  const running = st && !["done", "failed", "none"].includes(st.phase);
  const frac = st?.total_steps ? st.step / st.total_steps : 0;
  const right = (
    <span className="flex items-center gap-2">
      {info?.supported && (
        <select value={ticker} onChange={(e) => setPick(e.target.value)} disabled={running} aria-label="Specialist ticker"
          className="border border-line bg-ground px-1 text-[11px] text-ink outline-none focus:border-amber">
          {!info.supported.includes(dashTicker) && <option value={dashTicker}>{dashTicker}</option>}
          {info.supported.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      {supported && <>
      {needPw && !running && (
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="train password"
          aria-label="Train password" onKeyDown={(e) => e.key === "Enter" && train()}
          className="w-32 border border-line bg-ground px-1 text-[11px] normal-case text-ink outline-none focus:border-amber" />
      )}
      <button onClick={() => train(true)} disabled={running} title="QUICK DEMO RUN, not scored: about 30 s"
        className="border border-line px-2 text-dim hover:border-amber hover:text-amber disabled:opacity-40">QUICK DEMO</button>
      <button onClick={() => train(false)} disabled={running} className="border border-amber px-2 text-amber hover:bg-amber hover:text-ground disabled:opacity-40">{running ? "TRAINING" : "TRAIN"}</button>
      </>}
    </span>
  );
  const scored = Object.entries(evs).filter(([, e]) => e?.status === "scored");
  const glance = scored.map(([t, e]) => (
    <span key={t} className="inline-flex items-center gap-1"><b>{t}</b>
      <span className="text-dim">{fmtPct(e.models.general.accuracy)}→{fmtPct(e.models.specialist.accuracy)}</span><Verdict c={e.comparison} /></span>));
  return (
    <Panel code="SPC" title="stock-specific news analyst" className="h-full" right={right} {...fold} summary={glance}>
      <Summary evs={evs} />
      <div className="mb-1 text-[10px] text-dim"
        title={testSet === "author_tags"
          ? "Fine-tunes our 2B model on crypto StockTwits posts (author-tagged Bullish or Bearish), then scores it on 4,000 held-out tagged posts. It reads posts; it is not a trading signal."
          : testSet === "teacher"
            ? `Fine-tunes our 2B model on ${ticker} headlines (labeled by our 9B model). No hand-labeled test set exists for ${ticker}, so the panel shows agreement with the 9B model, not accuracy. It reads news; it is not a trading signal.`
            : `Fine-tunes our 2B model on ${ticker} headlines (labeled by our 9B model), then scores it on a held-out labeled test set${isClaude(ev) ? " (Claude-labeled, not human-labeled)" : ""}. It reads news; it is not a trading signal.`}>
        {ticker} · train: {testSet === "author_tags" ? "author-tagged crypto posts" : "9B-labeled headlines"} · test: {testSet === "author_tags" ? "4,000 author tags" : testSet === "teacher" ? "9B agreement only" : ev ? sourceWord(ev) : "labeled headlines"} · not a trading signal
      </div>
      {info && !supported && (
        <div className="text-dim">No specialist data for {ticker}. Pick one of {info.supported.join(", ")} above.</div>
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
              <div className="mb-1 text-[10px] text-dim" title="General examples are mixed in so the specialist keeps its general skill.">
                {st.data.ticker_examples} {ticker === "CRYPTO" ? "crypto posts (author tags)" : `${ticker} (9B labels, pre-Jul 2023)`} + {st.data.general_examples} general
              </div>
            )}
            {st?.quick && <div className="mb-1 font-bold text-amber">QUICK DEMO RUN, not scored</div>}
            {st?.phase === "failed" && <div className="text-down">FAILED {st.error}</div>}
            {st && st.phase !== "none" && (
              <details open={!!running}>
                <summary className="cursor-pointer text-[10px] text-dim hover:text-amber"
                  title="Loss starts low because training begins from our already-trained general model. The held-out line is the honest one.">training curve</summary>
                <LossChart probe={st.probe} tickerLoss={st.loss_ticker} total={st.total_steps || 1} probeSource={st.probe_source} />
              </details>
            )}
          </div>
          <div className="min-w-[300px] flex-1">
            <div className="mb-0.5 text-[10px] text-amber">{testSet === "author_tags" ? "CRYPTO DETAIL · 4,000 author-tagged posts (bull vs bear)"
              : testSet === "teacher" ? `${ticker} DETAIL · 9B labels, not accuracy`
                : `${ticker} DETAIL · ${ev ? sourceWord(ev) : "labeled headlines"}, Jul to Dec 2023`}</div>
            {st?.quick && st.phase === "done" ? <QuickResult st={st} />
              : ev ? <Results ev={ev} testSet={testSet} /> : <div className="text-[11px] text-dim">{running ? "Scores appear when training finishes." : "Press TRAIN to build a specialist."}</div>}
          </div>
        </div>
      )}
    </Panel>
  );
}
