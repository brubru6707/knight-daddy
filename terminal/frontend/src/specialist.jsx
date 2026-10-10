import { useEffect, useState } from "react";
import { api } from "./ui.jsx";
import SAVED from "./data/specialist_claude_labeled.json";

const fmtPct = (x) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const pts = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;
const isClaude = (ev) => /claude/i.test(ev?.label_source || "");

// Before/after for each ticker with a scored test set. Uses /api/specialist/eval; when the public snapshot predates the
// scoring, falls back to the scored results file (results/claude_labeled), and says so.
export function SpecialistResults({ ticker, specVersion }) {
  const [rows, setRows] = useState(null);
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    api("specialist/info").catch(() => null).then(async (info) => {
      const tickers = [...new Set([...(info?.supported || []), ...Object.keys(SAVED.tickers)])];
      const out = await Promise.all(tickers.map(async (t) => {
        const ev = await api(`specialist/eval?ticker=${t}`).catch(() => null);
        if (ev?.status === "scored") return { t, ev, from: "api" };
        if (SAVED.tickers[t]) return { t, ev: SAVED.tickers[t], from: "file", api: ev };
        return { t, ev, from: "api" };
      }));
      if (live) setRows(out);
    });
    return () => { live = false; };
  }, [specVersion]);
  useEffect(() => {
    setSt(null);
    api(`specialist/status?ticker=${ticker}`).then(setSt).catch(() => setSt(null));
  }, [ticker, specVersion]);

  const scored = (rows || []).filter((r) => r.ev?.status === "scored");
  const claude = scored.some((r) => isClaude(r.ev));
  const fromFile = scored.filter((r) => r.from === "file");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">Specialist before / after</h3>
        {claude && <span className="border border-amber/60 px-1.5 py-0.5 text-[11px] text-amber" data-testid="claude-badge">Claude-labeled, not human-labeled</span>}
      </div>
      <p className="mt-2 text-sm text-dim">General 2B (before) vs the ticker specialist (after), scored on held-out Jul to Dec 2023 headlines. Better or worse only if the 95% CI of the accuracy change excludes 0 (rule fixed in advance).</p>
      {!rows && <div className="mt-3 text-sm text-dim">Loading specialist results<span className="animate-pulse">_</span></div>}
      {rows && !scored.length && <div className="mt-3 text-sm text-dim">Specialist scores: n/a</div>}
      {scored.length > 0 && (
        <table className="mt-4 w-full text-sm" data-testid="specialist-table">
          <thead className="text-xs text-dim"><tr>
            <th className="pb-2 text-left font-normal">Ticker</th><th className="pb-2 text-right font-normal">n</th>
            <th className="pb-2 text-right font-normal">Before</th><th className="pb-2 text-right font-normal">After</th>
            <th className="pb-2 text-right font-normal">Change [95% CI]</th><th className="pb-2 pl-4 text-left font-normal">Verdict</th>
          </tr></thead>
          <tbody>{scored.map(({ t, ev }) => {
            const c = ev.comparison, g = ev.models.general, s = ev.models.specialist;
            const verdict = c.verdict === "no clear difference" ? "No clear difference" : `Specialist ${c.verdict}`;
            return (
              <tr key={t} className={`border-t border-line ${t === ticker ? "text-ink" : "text-dim"}`}>
                <td className="py-2 font-semibold">{t}</td><td className="py-2 text-right">{ev.n_scored}</td>
                <td className="py-2 text-right">{fmtPct(g.accuracy)}</td><td className="py-2 text-right">{fmtPct(s.accuracy)}</td>
                <td className="py-2 text-right">{pts(c.accuracy_diff)} <span className="text-dim">[{pts(c.accuracy_diff_ci95[0])}, {pts(c.accuracy_diff_ci95[1])}]</span></td>
                <td className={`py-2 pl-4 ${c.verdict === "better" ? "text-up" : c.verdict === "worse" ? "text-down" : "text-flat"}`}>{verdict}</td>
              </tr>);
          })}</tbody>
        </table>
      )}
      {fromFile.length > 0 && (
        <p className="mt-2 text-xs text-dim">{fromFile.map((r) => r.t).join(", ")}: from {SAVED.source}, because the public API snapshot predates these scores.</p>
      )}
      {st?.losses?.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-dim hover:text-amber">{ticker} training curve ({st.phase}, {st.step}/{st.total_steps} steps)</summary>
          <LossChart probe={st.probe} tickerLoss={st.loss_ticker} total={st.total_steps || 1} probeSource={st.probe_source} />
        </details>
      )}
    </div>
  );
}

function smooth(arr, w = 5) {
  return arr.map((_, i) => {
    const win = arr.slice(Math.max(0, i - w + 1), i + 1).filter((v) => v !== null && v !== undefined);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

// Training loss by step. y-axis from 0 so a small change stays honest.
export function LossChart({ probe = [], tickerLoss = [], total = 1, probeSource }) {
  const W = 520, H = 170, L = 40, R = 16, T = 10, B = 24;
  const tk = smooth(tickerLoss).map((v, i) => (v === null ? null : [i + 1, v])).filter(Boolean);
  const vals = [...probe.map((p) => p[1]), ...tk.map((p) => p[1])];
  if (!vals.length) return <div className="mt-2 text-xs text-dim">Loss: n/a</div>;
  const yMax = Math.max(...vals) * 1.15;
  const x = (s) => L + (s / Math.max(1, total)) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const path = (p) => p.map((q, i) => `${i ? "L" : "M"}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(" ");
  return (
    <div className="mt-2">
      <div className="mb-1 flex gap-4 text-xs text-dim">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-amber" />held-out loss ({probeSource || "never trained on"})</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-flat" />ticker training loss (5-step avg)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="Training loss by step">
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line x1={L} x2={W - R} y1={y(f * yMax)} y2={y(f * yMax)} style={{ stroke: "var(--kd-line)" }} />
            <text x={L - 6} y={y(f * yMax) + 3} textAnchor="end" fontSize="10" style={{ fill: "var(--kd-dim)" }}>{(f * yMax).toFixed(2)}</text></g>))}
        {[0, total].map((s) => <text key={s} x={x(s)} y={H - 6} textAnchor="middle" fontSize="10" style={{ fill: "var(--kd-dim)" }}>step {s}</text>)}
        {tk.length > 1 && <path d={path(tk)} fill="none" style={{ stroke: "var(--kd-flat)" }} strokeWidth="1.5" />}
        {probe.length > 1 && <path d={path(probe)} fill="none" style={{ stroke: "var(--kd-chart)" }} strokeWidth="2" />}
      </svg>
    </div>
  );
}
