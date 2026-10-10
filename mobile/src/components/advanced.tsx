import { StyleSheet, Text, View } from "react-native";
import { paths, type Backtest, type Benchmarks, type Health, type Sentiment, type SpecEval, type SpecInfo, type SpecStatus } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { money, pct, toneColor, useStyles, useTheme, type Palette } from "@/lib/theme";
import { Card, Status } from "./Card";
import { LineChart } from "./LineChart";

function Pill({ text, color }: { text: string; color: string }) {
  const st = useStyles(makeStyles);
  return <View style={[st.pill, { borderColor: color }]}><Text style={[st.pillText, { color }]}>{text}</Text></View>;
}

export function SentimentCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Sentiment>(paths.sentiment(ticker), nonce);
  const d = s.data;
  const lags = d ? Object.entries(d.corr_by_lag).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]) : [];
  const peak = (f: (k: number) => boolean) => Math.max(0, ...lags.filter(([k]) => f(k)).map(([, v]) => Math.abs(v)));
  const past = peak((k) => k < 0), next = peak((k) => k > 0);
  const lagsPrice = past > next;
  const finding = d ? <Pill text={lagsPrice ? "LAGS PRICE" : "LEADS PRICE"} color={C.amber} /> : null;
  // Daily score, smoothed over 10 days so the line is readable on a phone.
  const scores = d ? d.rows.map((r) => r.score ?? 0) : [];
  const smooth = scores.map((_, i) => { const w = scores.slice(Math.max(0, i - 9), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
  return (
    <Card title="Sentiment vs price" collapsible summary={finding}>
      <Status s={s} what="sentiment history" />
      {d && (
        <>
          <View style={st.rowBetween}>{finding}<Text style={st.dim}>{d.start} to {d.end}</Text></View>
          <Text style={st.lead}>
            Headlines track the <Text style={{ color: C.amber }}>{lagsPrice ? "past" : "next"}</Text> move more than the {lagsPrice ? "next" : "past"} one.
          </Text>
          <Text style={st.label}>Price</Text>
          <LineChart series={[{ values: d.rows.map((r) => r.close), color: C.amber }]} height={90} />
          <Text style={st.label}>News score (10-day avg)</Text>
          <LineChart series={[{ values: smooth, color: C.flat, width: 1.5 }]} height={60} baseline={0} />
          <Text style={[st.label, { marginTop: 12 }]}>Correlation with return k days away</Text>
          <View style={st.lagRow}>
            {lags.map(([k, v]) => (
              <View key={k} style={st.lagCol}>
                <Text style={st.lagVal}>{v.toFixed(2)}</Text>
                <View style={st.lagTrack}>
                  <View style={{ height: `${Math.max(4, (Math.abs(v) / 0.35) * 100)}%`, width: "60%",
                    backgroundColor: k < 0 ? C.amber : C.dim, opacity: v < 0 ? 0.5 : 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                </View>
                <Text style={st.dim}>{k === 0 ? "0d" : k < 0 ? `${k}d` : `+${k}d`}</Text>
              </View>
            ))}
          </View>
          <Text style={st.small}>Left (amber) = past returns. Taller left bars mean news reacts to price.</Text>
        </>
      )}
    </Card>
  );
}

export function BacktestCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Backtest>(paths.backtest(ticker), nonce);
  const d = s.data;
  const sent = d?.metrics["Sentiment"], bh = d?.metrics["Buy and hold"];
  const beat = !!(sent && bh && sent.total_return > bh.total_return);
  const nRand = d?.diagnostics.random_seeds_beaten_by_sentiment ?? 0;
  const skill = nRand >= 95;
  const summary = d ? <Pill text={beat ? "BEAT B&H" : "LOST TO B&H"} color={beat ? C.up : C.down} /> : null;
  return (
    <Card title="Backtest" collapsible summary={summary}>
      <Status s={s} what="backtest" />
      {d && sent && bh && (
        <>
          <View style={st.bigRow}>
            <View style={st.big}><Text style={st.bigLabel}>News strategy</Text>
              <Text style={[st.bigNum, { color: toneColor(C, sent.total_return) }]}>{pct(sent.total_return, 0)}</Text></View>
            <View style={st.big}><Text style={st.bigLabel}>Buy and hold</Text>
              <Text style={[st.bigNum, { color: toneColor(C, bh.total_return) }]}>{pct(bh.total_return, 0)}</Text></View>
          </View>
          <View style={st.pills}>
            {summary}
            <Pill text={skill ? "UNUSUAL" : "LUCK"} color={skill ? C.amber : C.flat} />
            <Text style={st.dim}>beat {nRand}/{d.seeds} random</Text>
          </View>
          <LineChart height={130} series={[
            { values: d.curves["Buy and hold"].map((p) => p.value), color: C.flat, width: 1.5 },
            { values: (d.curves["Random (mean of 100)"] || []).map((p) => p.value), color: C.dim, width: 1, dashed: true },
            { values: d.curves["Sentiment"].map((p) => p.value), color: C.amber, width: 2.5 },
          ]} baseline={d.capital} />
          <Text style={st.small}>
            <Text style={{ color: C.amber }}>━ news</Text>  <Text style={{ color: C.flat }}>━ buy and hold</Text>  <Text>┅ random avg</Text>
            {"\n"}{money(d.capital)} start · {d.start} to {d.end} · {(d.slippage * 100).toFixed(2)}% slippage
          </Text>
          <Text style={st.read}>{skill
            ? "Beat 95+ random-timing runs: unusual, but one stock, one year."
            : "Within the range of random timing: consistent with luck, not skill."}</Text>
        </>
      )}
    </Card>
  );
}

export function BenchmarkCard({ nonce }: { nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Benchmarks>(paths.benchmarks(), nonce);
  const rows = s.data?.rows || [];
  const ours = rows.find((r) => r.model.includes("2B QLoRA"));
  const fb = rows.find((r) => /finbert fine/i.test(r.model)) || rows.find((r) => /finbert/i.test(r.model));
  const ahead = ours && fb ? ours.accuracy > fb.accuracy : null;
  const summary = ahead === null ? null : <Pill text={ahead ? "AHEAD" : "BEHIND"} color={ahead ? C.up : C.down} />;
  return (
    <Card title="Benchmark" collapsible summary={summary}>
      <Status s={s} what="benchmarks" />
      {ours && fb && (
        <View style={st.bigRow}>
          <View style={st.big}><Text style={st.bigLabel}>Ours (2B)</Text><Text style={[st.bigNum, { color: C.amber }]}>{(ours.accuracy * 100).toFixed(1)}%</Text></View>
          <View style={st.big}><Text style={st.bigLabel}>{fb.model.replace(/\s*\(.*\)/, "")}</Text><Text style={st.bigNum}>{(fb.accuracy * 100).toFixed(1)}%</Text></View>
        </View>
      )}
      {rows.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <View style={st.tr}><Text style={[st.th, { flex: 1, textAlign: "left" }]}>model</Text><Text style={st.th}>acc</Text><Text style={st.th}>F1</Text></View>
          {rows.map((r) => {
            const mine = r.model.includes("ours");
            return (
              <View key={r.model} style={st.tr}>
                <Text style={[st.td, { flex: 1, textAlign: "left", color: mine ? C.ink : C.dim }]} numberOfLines={1}>
                  {r.model.includes("2B QLoRA") ? "▶ " : ""}{r.model}</Text>
                <Text style={[st.td, mine && { color: C.ink }]}>{(r.accuracy * 100).toFixed(1)}</Text>
                <Text style={[st.td, mine && { color: C.ink }]}>{r.macro_f1.toFixed(3)}</Text>
              </View>
            );
          })}
          <Text style={st.small}>{s.data?.dataset}</Text>
        </View>
      )}
    </Card>
  );
}

const fmt = (x?: number | null) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);

export function SpecialistCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const info = useApi<SpecInfo>(paths.specInfo(), nonce);
  const supported = info.data?.supported?.includes(ticker);
  const ev = useApi<SpecEval>(supported ? paths.specEval(ticker) : null, nonce);
  const status = useApi<SpecStatus>(supported ? paths.specStatus(ticker) : null, nonce);
  const e = ev.data;
  const c = e?.comparison;
  const verdict = c ? (c.verdict === "no clear difference" ? "No clear difference" : `Specialist ${c.verdict}`) : null;
  const vColor = !c ? C.flat : c.verdict === "better" ? C.up : c.verdict === "worse" ? C.down : C.flat;
  const summary = verdict ? <Pill text={verdict.toUpperCase()} color={vColor} /> : null;
  return (
    <Card title="Specialist before / after" collapsible summary={summary}>
      <Status s={info} what="specialist info" />
      {info.data && !supported && <Text style={st.dim}>No specialist for {ticker}. Available: {info.data.supported.join(", ")}.</Text>}
      <Status s={ev} what="specialist results" />
      {e?.status === "scored" && e.models && c && (
        <>
          <View style={st.bigRow}>
            <View style={st.big}><Text style={st.bigLabel}>General 2B</Text><Text style={st.bigNum}>{fmt(e.models.general.accuracy)}</Text></View>
            <Text style={st.arrow}>→</Text>
            <View style={st.big}><Text style={st.bigLabel}>Specialist</Text><Text style={[st.bigNum, { color: C.amber }]}>{fmt(e.models.specialist.accuracy)}</Text></View>
          </View>
          <View style={st.pills}>{summary}
            <Text style={st.dim}>Δ {pct(c.accuracy_diff)} [{pct(c.accuracy_diff_ci95[0])}, {pct(c.accuracy_diff_ci95[1])}]</Text></View>
          <Text style={st.small}>Rule fixed in advance: better or worse only if the 95% CI excludes 0. n={e.n_scored}.</Text>
        </>
      )}
      {e && e.status !== "scored" && (
        <>
          <View style={st.pills}><Pill text="NOT SCORED YET" color={C.flat} /></View>
          <Text style={st.dim}>{e.message}</Text>
          {e.agreement_with_teacher && (
            <View style={[st.bigRow, { marginTop: 10 }]}>
              <View style={st.big}><Text style={st.bigLabel}>9B agreement before</Text><Text style={st.bigNum}>{fmt(e.agreement_with_teacher.general)}</Text></View>
              <Text style={st.arrow}>→</Text>
              <View style={st.big}><Text style={st.bigLabel}>after</Text><Text style={[st.bigNum, { color: C.amber }]}>{fmt(e.agreement_with_teacher.specialist)}</Text></View>
            </View>
          )}
          <Text style={st.small}>
            Agreement with our 9B model is not accuracy.{e.n_test_rows ? ` ${e.changed_on_test_rows}/${e.n_test_rows} test tags changed.` : ""}
          </Text>
        </>
      )}
      {status.data && status.data.phase !== "none" && (
        <Text style={[st.small, { marginTop: 8 }]}>Last training run: {status.data.phase}
          {status.data.total_steps ? ` (${status.data.step}/${status.data.total_steps} steps)` : ""}</Text>
      )}
    </Card>
  );
}

export function WorkerCard({ health }: { health: Health | null }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const online = !!health?.worker_online;
  const summary = health ? <Pill text={online ? "ONLINE" : "OFFLINE"} color={online ? C.up : C.down} /> : null;
  return (
    <Card title="Worker" collapsible summary={summary}>
      {!health && <Text style={st.dim}>Status unavailable.</Text>}
      {health && (
        <>
          <View style={st.pills}>
            <View style={[st.dot, { backgroundColor: online ? C.up : C.down }]} />
            <Text style={[st.bigNum, { fontSize: 22, color: online ? C.up : C.down }]}>{online ? "Online" : "Offline"}</Text>
          </View>
          <Text style={st.dim}>{online ? "Oscar GPU worker is polling. Training available." : "Oscar GPU worker is not polling. Training unavailable; data below is the latest snapshot."}</Text>
          {health.snapshot_pushed_at && <Text style={st.small}>Data pushed {new Date(health.snapshot_pushed_at).toLocaleString()}</Text>}
          <Text style={st.small}>Tracked: {(health.tracked_tickers || []).join(", ") || "none"}</Text>
        </>
      )}
    </Card>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  dim: { color: C.dim, fontSize: 14, lineHeight: 20 },
  small: { color: C.dim, fontSize: 12, lineHeight: 17, marginTop: 6 },
  lead: { color: C.ink, fontSize: 15, fontWeight: "600", marginVertical: 8 },
  label: { color: C.dim, fontSize: 12, marginTop: 6, marginBottom: 2, letterSpacing: 0.5 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  pills: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 8, flexWrap: "wrap" },
  lagRow: { flexDirection: "row", gap: 4, marginTop: 4 },
  lagCol: { flex: 1, alignItems: "center" },
  lagVal: { color: C.ink, fontSize: 10, fontVariant: ["tabular-nums"] },
  lagTrack: { height: 40, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  bigRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  big: { flex: 1 },
  bigLabel: { color: C.dim, fontSize: 12 },
  bigNum: { color: C.ink, fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  arrow: { color: C.dim, fontSize: 22 },
  read: { color: C.ink, fontSize: 14, lineHeight: 20, marginTop: 8, borderLeftWidth: 2, borderLeftColor: C.amber, paddingLeft: 8 },
  tr: { flexDirection: "row", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  th: { color: C.dim, fontSize: 12, width: 52, textAlign: "right" },
  td: { color: C.dim, fontSize: 13, width: 52, textAlign: "right", fontVariant: ["tabular-nums"] },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
