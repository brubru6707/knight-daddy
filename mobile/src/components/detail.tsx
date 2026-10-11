import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { api, ApiError, paths, resetModel, startTraining, type Briefing, type Headlines, type Health, type Label, type Model,
  type Prices, type SpecInfo, type SpecStatus } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { labelColor, pct, relTime, SERIF, usd, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
import { reasons } from "@/lib/outlook";
import { NAMES, PEERS, short } from "@/lib/peers";
import { Card, Status } from "./Card";
import { LineChart } from "./LineChart";
import { PasswordModal } from "./PasswordModal";

const LABELS: Label[] = ["Bearish", "Neutral", "Bullish"];

// 1D needs intraday bars, which the API does not serve, so it shows n/a rather than a fake line.
const RANGES = [
  { k: "1D", api: null, label: "today" },
  { k: "1W", api: "3mo", n: 6, label: "past week" },
  { k: "1M", api: "3mo", n: 22, label: "past month" },
  { k: "3M", api: "3mo", label: "past 3 months" },
  { k: "1Y", api: "1y", label: "past year" },
  { k: "ALL", api: "2y", label: "past 2 years" },
] as const;

// Crypto trades every day: a week is 7 daily bars and a month 30, not 6 and 22.
const DAYS_7: Record<string, number> = { "1W": 7, "1M": 30 };

export function PriceHero({ ticker, nonce, crypto = false }: { ticker: string; nonce: number; crypto?: boolean }) {
  const [rk, setRk] = useState<string>("1M");
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const r = RANGES.find((x) => x.k === rk)!;
  const s = useApi<Prices>(r.api ? paths.prices(ticker, r.api) : null, nonce);
  const n = crypto && DAYS_7[rk] ? DAYS_7[rk] : "n" in r ? r.n : null;
  const bars = s.data ? (n ? s.data.bars.slice(-n) : s.data.bars) : [];
  const first = bars[0]?.close, last = bars.at(-1)?.close;
  const chg = first && last ? last - first : null;
  const color = chg === null ? C.dim : chg >= 0 ? C.up : C.down;
  return (
    <View style={st.hero}>
      <Text style={st.name}>{NAMES[ticker] || ticker}</Text>
      <Text style={st.tick}>{short(ticker)}{crypto ? " · CRYPTO" : ""}</Text>
      <Text style={st.price} accessibilityLabel="Price">{last !== undefined ? usd(last) : s.loading ? "…" : "n/a"}</Text>
      <Text style={[st.change, { color }]}>
        {chg !== null ? `${chg >= 0 ? "+" : "-"}${usd(Math.abs(chg))} (${pct(chg / first!, 2)})  ` : r.api ? (s.loading ? "" : "n/a  ") : "Intraday prices: n/a  "}
        <Text style={st.changeDim}>{r.api ? r.label : ""}</Text>
      </Text>
      <View style={st.chart}>
        {bars.length > 1 ? <LineChart series={[{ values: bars.map((b) => b.close), color: C.up, width: 2.5, area: true }]} height={200} baseline={first} />
          : <View style={st.chartEmpty}><Text style={st.dim}>{s.loading ? "Loading prices…" : r.api ? "Chart: n/a" : "1D needs intraday prices, which the API does not serve (n/a)"}</Text></View>}
      </View>
      <View style={st.ranges} accessibilityRole="tablist">
        {RANGES.map((x) => (
          <Pressable key={x.k} onPress={() => setRk(x.k)} style={[st.range, x.k === rk && st.rangeOn]} hitSlop={4}
            accessibilityRole="tab" accessibilityState={{ selected: x.k === rk }}>
            <Text style={[st.rangeText, x.k === rk && { color: C.ink }, !x.api && { opacity: 0.6 }]}>{x.k}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type Probs = { p_bearish?: number | null; p_neutral?: number | null; p_bullish?: number | null; confidence_n?: number } | null | undefined;

// Red / yellow / green bar sized by class probabilities. n/a when the fields are missing.
export function ProbBar({ d }: { d: Probs }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const field = { Bearish: d?.p_bearish, Neutral: d?.p_neutral, Bullish: d?.p_bullish };
  const ok = LABELS.every((l) => typeof field[l] === "number");
  const sum = ok ? LABELS.reduce((a, l) => a + (field[l] as number), 0) : 0;
  const fill = { Bearish: C.down, Neutral: C.neutral, Bullish: C.up };
  if (!ok || !sum) return <Text style={st.dim}>Confidence: n/a</Text>;
  const pctOf = (l: Label) => Math.round(((field[l] as number) / sum) * 100);
  return (
    <>
      <View style={st.bar}>
        {LABELS.map((l) => (field[l] as number) > 0 && (
          <View key={l} style={[st.seg, { flex: field[l] as number, backgroundColor: fill[l] }]} accessibilityLabel={`${l} ${pctOf(l)} percent`}>
            <Text style={st.segText} numberOfLines={1}>{pctOf(l)}%</Text>
          </View>
        ))}
      </View>
      <View style={st.legend}>
        {LABELS.map((l) => <Text key={l} style={[st.legendText, { color: labelColor(C, l) }]}>● {l}</Text>)}
      </View>
      <Text style={st.small}>Qwen classification: average class probability over {d?.confidence_n ?? "n/a"} headlines.</Text>
    </>
  );
}

// Qwen (classification): one bar split by the model's real softmax probabilities for this ticker. Reads the
// p_bearish / p_neutral / p_bullish fields the Oscar worker pushes; until they exist it says n/a, never a fake split.
export function ConfidenceBar({ ticker, model, nonce }: { ticker: string; model: Model; nonce: number }) {
  const st = useStyles(makeStyles);
  const s = useApi<Headlines>(paths.headlines(ticker, model), nonce);
  return (
    <Card title="Model confidence" right={<Text style={st.small}>Qwen{model === "specialist" ? `, ${ticker} specialist` : ", general"}</Text>}>
      {s.loading ? <Status s={s} what="confidence" /> : <ProbBar d={s.data} />}
    </Card>
  );
}

// Gemini (summary): up to 4 plain-English bullets, read aloud through the site's ElevenLabs endpoint.
export function BriefingCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Briefing>(paths.briefing(ticker), nonce);
  const [audio, setAudio] = useState<{ state: "idle" | "loading" | "playing"; msg: string | null }>({ state: "idle", msg: null });
  const player = useRef<AudioPlayer | null>(null);
  const stop = () => { player.current?.remove(); player.current = null; setAudio({ state: "idle", msg: null }); };
  useEffect(() => stop, [ticker]);
  const b = s.data;
  const ok = b?.status === "ok";
  const bullets = ok ? reasons(b.text) : [];

  const listen = async () => {
    if (audio.state === "playing") return stop();
    if (!b?.id) return;
    setAudio({ state: "loading", msg: null });
    try {
      const h = await api<Health & { keys?: Record<string, boolean> }>(paths.health());
      if (!h.keys?.ELEVENLABS_API_KEY) throw new Error("n/a on this server");
      const url = paths.audio(b.id, ticker);
      const r = await fetch(url); // the site caches the mp3, so the player's own fetch below is quick
      if (!r.ok) throw new Error("n/a right now");
      await setAudioModeAsync({ playsInSilentMode: true });
      const p = createAudioPlayer({ uri: url });
      player.current = p;
      p.addListener("playbackStatusUpdate", (x) => { if (x.didJustFinish) stop(); });
      p.play();
      setAudio({ state: "playing", msg: null });
    } catch (e) {
      setAudio({ state: "idle", msg: e instanceof Error ? e.message : "n/a right now" });
    }
  };

  return (
    <Card title="Briefing" right={ok ? (
      <Pressable onPress={listen} disabled={audio.state === "loading"} style={st.speaker} hitSlop={6} accessibilityRole="button"
        accessibilityLabel={audio.state === "playing" ? "Stop reading" : `Read the ${ticker} briefing aloud`}>
        {audio.state === "loading" ? <ActivityIndicator size="small" color={C.ink} /> :
          <Text style={st.speakerText}>{audio.state === "playing" ? "■ Stop" : "🔈 Listen"}</Text>}
      </Pressable>) : null}>
      {s.loading && <Status s={s} what="briefing" />}
      {s.err && <Text style={st.dim}>Summary: n/a right now.</Text>}
      {b && !ok && <Text style={st.dim}>Briefing: n/a. {b.status === "no_key" ? "No Gemini key is set on this server." : b.message || ""}</Text>}
      {ok && (
        <>
          {bullets.map((x, i) => (
            <View key={i} style={st.bulletRow}><Text style={st.bulletDot}>·</Text><Text style={st.bullet}>{x}</Text></View>
          ))}
          {bullets.length === 0 && <Text style={st.dim}>Summary: n/a</Text>}
          <Text style={st.small}>Written by Gemini ({b.model || "n/a"}) from {b.n} headlines, {b.window}. Tags come from Qwen.</Text>
          {audio.msg && <Text style={st.small}>Listen: {audio.msg}</Text>}
        </>
      )}
    </Card>
  );
}

const PHASES: Record<string, string> = {
  queued: "Queued, waiting for the Oscar GPU", "waiting for GPU": "Waiting for the Oscar GPU", starting: "Starting",
  "loading data": "Loading data", "loading model": "Loading model", "scoring general model": "Scoring the general model",
  training: "Training", "scoring specialist": "Scoring the specialist", saving: "Saving", done: "Done", failed: "Failed",
};
const clock = (x?: number) => (x === undefined || x === null ? null : x >= 60 ? `${Math.floor(x / 60)}m ${String(Math.round(x % 60)).padStart(2, "0")}s` : `${Math.round(x)}s`);

// Fine-tune controls. Progress and elapsed time come from the train endpoint's status, polled every 2 s.
// Every run starts from a fresh copy of the general model on Oscar, never from an earlier specialist.
export function FineTuneCard({ ticker, active, onActive, onTrained }: {
  ticker: string; active: Model; onActive: (m: Model) => void; onTrained: () => void;
}) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const { password, setPassword } = useSession();
  const [health, setHealth] = useState<Health | null>(null);
  const [info, setInfo] = useState<SpecInfo | null>(null);
  const [status, setStatus] = useState<SpecStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "train" | "reset">(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const online = health ? !!health.worker_online : null;
  const stocks = (info?.supported || []).filter((t) => t !== "CRYPTO");
  const supported = stocks.includes(ticker);
  const running = !!status && !["done", "failed", "none"].includes(status.phase);

  const follow = () => {
    if (poll.current) clearInterval(poll.current);
    const tick = async () => {
      try {
        const d = await api<SpecStatus>(paths.specStatus(ticker));
        setStatus(d);
        if (d.phase === "done" || d.phase === "failed") {
          if (poll.current) clearInterval(poll.current);
          if (d.phase === "done" && !d.quick) onTrained();
        }
      } catch { /* transient: keep polling */ }
    };
    poll.current = setInterval(tick, 2000);
    tick();
  };
  useEffect(() => {
    setStatus(null); setErr(null);
    api<Health>(paths.health()).then(setHealth).catch(() => setHealth(null));
    api<SpecInfo>(paths.specInfo()).then(setInfo).catch(() => setInfo(null));
    api<SpecStatus>(paths.specStatus(ticker)).then((d) => { setStatus(d); if (d.running) follow(); }).catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const run = async (what: "train" | "reset", pw = password) => {
    setErr(null);
    if (!pw) { setPwErr(null); setAsk(what); return; }
    try {
      if (what === "reset") onActive((await resetModel(ticker, pw)).active);
      else { await startTraining(ticker, pw); setStatus({ phase: "queued", step: 0, total_steps: null }); follow(); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      if (code === 401) { setPassword(null); setPwErr("Wrong password. Try again."); setAsk(what); return; }
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const frac = status?.phase === "done" ? 1 : status?.total_steps ? (status.step || 0) / status.total_steps : 0;
  const elapsed = clock(status?.phase === "queued" ? status.queued_s : status?.elapsed_s);
  const shown = running || status?.phase === "done" || status?.phase === "failed";
  return (
    <Card title="Fine-tune">
      <View style={st.rowBetween}>
        <Text style={st.activeLine}>Active model: {active === "specialist" ? `${ticker} specialist` : "general"}</Text>
        <Text style={[st.small, { marginTop: 0 }]}><Text style={{ color: online === null ? C.dim : online ? C.up : C.down }}>● </Text>
          Model {online === null ? "status n/a" : online ? "online" : "offline"}</Text>
      </View>
      <Pressable onPress={() => run("train")} disabled={!supported || running || online === false}
        style={({ pressed }) => [st.primary, (!supported || running || online === false) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
        accessibilityRole="button">
        <Text style={st.primaryText}>{running ? "Fine-tuning…" : "Fine-tune to this stock"}</Text>
      </Pressable>
      {active === "specialist" && !running && (
        <Pressable onPress={() => run("reset")} style={({ pressed }) => [st.secondary, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={st.secondaryText}>Reset to general model</Text>
        </Pressable>
      )}
      {shown && status && (
        <View style={{ marginTop: 14 }}>
          <View style={st.rowBetween}>
            <Text style={[st.small, { marginTop: 0 }, status.phase === "failed" && { color: C.down }]}>{running ? "" : "Last fine-tune: "}{PHASES[status.phase] || status.phase}{status.quick ? " · quick run" : ""}</Text>
            <Text style={[st.small, { marginTop: 0 }]}>{[status.total_steps ? `${status.step}/${status.total_steps}` : null, elapsed].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={st.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}>
            <View style={[st.fill, { width: `${Math.round(frac * 100)}%` }]} />
          </View>
          {status.phase === "failed" && status.error ? <Text style={[st.small, { color: C.down }]}>{status.error}</Text> : null}
          {status.phase === "queued" && status.note ? <Text style={st.small}>{status.note}</Text> : null}
        </View>
      )}
      <Text style={st.small}>
        {!info ? "Specialist info: n/a" : !supported ? `Fine-tuning is available for ${stocks.join(", ")}.`
          : online === false ? "Model offline, showing latest data."
          : "Each fine-tune starts from a fresh copy of the general model and trains on this stock's headlines. It reads news; it is not a trading signal."}
      </Text>
      {err && <Text style={[st.small, { color: C.down }]}>{err}</Text>}
      <PasswordModal visible={!!ask} error={pwErr} onCancel={() => setAsk(null)}
        onSubmit={(pw) => { const what = ask!; setPassword(pw); setAsk(null); run(what, pw); }} />
    </Card>
  );
}

export function HeadlinesCard({ ticker, model, nonce }: { ticker: string; model: Model; nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Headlines>(paths.headlines(ticker, model), nonce);
  const [all, setAll] = useState(false);
  const items = s.data?.items || [];
  const shown = all ? items : items.slice(0, 3);
  return (
    <Card title="Latest headlines" right={s.data?.provider ? <Text style={st.small}>{s.data.provider}</Text> : null}>
      <Status s={s} what="headlines" />
      {s.data && items.length === 0 && <Text style={st.dim}>No headlines found.</Text>}
      {shown.map((h, k) => (
        <Pressable key={k} disabled={!h.url} onPress={() => h.url && WebBrowser.openBrowserAsync(h.url)} testID="headline"
          style={({ pressed }) => [st.headline, k === 0 && { borderTopWidth: 0 }, pressed && { opacity: 0.6 }]}
          accessibilityRole="link" accessibilityLabel={`${h.label || "Untagged"}: ${h.title}`}>
          {model !== "none" && (
            <View style={[st.tag, { borderColor: labelColor(C, h.label) }]}>
              <Text style={[st.tagText, { color: labelColor(C, h.label) }]}>{h.label || "n/a"}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={st.headlineText} numberOfLines={3}>{h.title}</Text>
            <Text style={st.meta}>{[h.source, relTime(h.time)].filter(Boolean).join(" · ")}</Text>
          </View>
        </Pressable>
      ))}
      {items.length > 3 && (
        <Pressable onPress={() => setAll(!all)} style={st.moreBtn} accessibilityRole="button">
          <Text style={st.more}>{all ? "Show fewer headlines" : `View all ${items.length}`}</Text>
        </Pressable>
      )}
      {s.data && <Text style={st.small}>{model === "none" ? "No sentiment model runs on crypto, so these are untagged."
        : `Tags by Qwen, ${model === "specialist" ? `${ticker} specialist` : "general model"}.`}</Text>}
    </Card>
  );
}

export function CompetitorsRow({ ticker, onPick }: { ticker: string; onPick: (t: string) => void }) {
  const st = useStyles(makeStyles);
  const peers = PEERS[ticker];
  return (
    <Card title="Competitors">
      {peers ? (
        <View style={st.peers}>
          {peers.map((p) => (
            <Pressable key={p} onPress={() => onPick(p)} style={({ pressed }) => [st.peer, pressed && { opacity: 0.6 }]}
              accessibilityRole="button" accessibilityLabel={`Open ${p}`}>
              <Text style={st.peerText}>{p}</Text>
              <Text style={st.peerName} numberOfLines={1}>{NAMES[p] || "n/a"}</Text>
            </Pressable>
          ))}
        </View>
      ) : <Text style={st.dim}>Competitors: n/a for {ticker}.</Text>}
    </Card>
  );
}

const makeStyles = (C: Palette) => sheet({
  hero: { marginBottom: 18 },
  name: { color: C.ink, fontSize: 26, fontFamily: SERIF, lineHeight: 32 },
  tick: { color: C.dim, fontSize: 12, letterSpacing: 1.6, marginTop: 2 },
  price: { color: C.ink, fontSize: 44, fontWeight: "700", fontVariant: ["tabular-nums"], marginTop: 12 },
  change: { fontSize: 15, fontWeight: "600", marginTop: 2 },
  changeDim: { color: C.dim, fontSize: 15 },
  chart: { marginTop: 14, borderWidth: 1, borderColor: C.line, padding: 10 },
  chartEmpty: { height: 200, alignItems: "center", justifyContent: "center", padding: 12 },
  ranges: { flexDirection: "row", gap: 4, marginTop: 10 },
  range: { flex: 1, alignItems: "center", paddingVertical: 10, minHeight: 40, borderWidth: 1, borderColor: "transparent" },
  rangeOn: { borderColor: C.rule },
  rangeText: { color: C.dim, fontWeight: "600", fontSize: 14 },
  dim: { color: C.dim, fontSize: 14, lineHeight: 20 },
  small: { color: C.dim, fontSize: 12, lineHeight: 17, marginTop: 8 },
  bar: { flexDirection: "row", height: 38, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  seg: { alignItems: "center", justifyContent: "center", minWidth: 0 },
  segText: { color: C.ground, fontSize: 12, fontWeight: "700" },
  legend: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  legendText: { fontSize: 12, fontWeight: "600" },
  speaker: { borderWidth: 1, borderColor: C.line, paddingHorizontal: 10, minHeight: 36, justifyContent: "center" },
  speakerText: { color: C.ink, fontSize: 13, fontWeight: "600" },
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  bulletDot: { color: C.amber, fontSize: 16, fontWeight: "700" },
  bullet: { color: C.ink, fontSize: 15, lineHeight: 21, flex: 1 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  activeLine: { color: C.ink, fontSize: 15, fontWeight: "600" },
  primary: { backgroundColor: C.ink, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 14 },
  primaryText: { color: C.ground, fontSize: 16, fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: C.rule, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryText: { color: C.ink, fontSize: 15, fontWeight: "600" },
  track: { height: 10, borderWidth: 1, borderColor: C.line, marginTop: 6, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: C.up },
  headline: { flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  tag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start", minWidth: 74, alignItems: "center" },
  tagText: { fontSize: 11, fontWeight: "600" },
  headlineText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  meta: { color: C.dim, fontSize: 12, marginTop: 4 },
  more: { color: C.amber, fontSize: 15, fontWeight: "700" },
  moreBtn: { paddingVertical: 12 },
  peers: { flexDirection: "row", borderTopWidth: 1, borderLeftWidth: 1, borderColor: C.line },
  peer: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.line },
  peerText: { color: C.ink, fontSize: 17, fontWeight: "700" },
  peerName: { color: C.dim, fontSize: 11, marginTop: 2 },
});

