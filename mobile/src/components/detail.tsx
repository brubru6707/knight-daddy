import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import Svg, { Path, Rect } from "react-native-svg";
import { api, ApiError, paths, resetModel, startTraining, talk, type Briefing, type TalkAnswer, type CryptoNews, type Headlines, type Health, type Label, type Model,
  type Prices, type SpecInfo, type SpecStatus } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { labelColor, pct, relTime, SERIF, usd, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
import { bulletsOf, paragraphsOf } from "@/lib/outlook";
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

// Crypto: Coinbase daily candles (2 years, fetched once) trading every day, so ranges are counted in calendar days.
const CRYPTO_DAYS: Record<string, number | null> = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365, ALL: null };

export function PriceHero({ ticker, nonce, crypto = false }: { ticker: string; nonce: number; crypto?: boolean }) {
  const [rk, setRk] = useState<string>("1M");
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const r = RANGES.find((x) => x.k === rk)!;
  const s = useApi<Prices>(!r.api ? null : crypto ? paths.cryptoCandles(ticker) : paths.prices(ticker, r.api), nonce);
  const n = crypto ? CRYPTO_DAYS[rk] ?? null : "n" in r ? r.n : null;
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
        <Text style={st.changeDim}>{r.api ? r.label : ""}{crypto && r.api ? " · Coinbase" : ""}</Text>
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

// Plays one of the site's mp3 endpoints through expo-audio. Throws a short message when read-aloud is unavailable.
async function playUrl(url: string, holder: { current: AudioPlayer | null }, onEnd: () => void) {
  const h = await api<Health>(paths.health());
  if (!h.keys?.ELEVENLABS_API_KEY) throw new Error("n/a on this server");
  const r = await fetch(url); // the site caches the mp3, so the player's own fetch below is quick
  if (!r.ok) throw new Error("n/a right now");
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); // back to loud playback after listening
  const p = createAudioPlayer({ uri: url });
  holder.current = p;
  p.addListener("playbackStatusUpdate", (x) => { if (x.didJustFinish) onEnd(); });
  p.play();
}

// Talk: a press-to-talk conversation about this stock's news and its tone. Hold the mic, ask, release: iOS speech
// recognition turns it into text, the question and the last few turns go to /api/talk, which answers only from the
// real headlines, and the answer is spoken with ElevenLabs. Advice questions get a short decline every time.
// `hear` (deep link, testing): recognize a recorded audio file instead of the microphone.
function TalkPanel({ ticker, briefing, hear }: { ticker: string; briefing: Briefing; hear?: string }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const [turns, setTurns] = useState<(TalkAnswer & { q: string })[]>([]);
  const [phase, setPhase] = useState<"idle" | "listening" | "hearing" | "thinking">("idle");
  const [live, setLive] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [q, setQ] = useState("");
  const [audio, setAudio] = useState<{ which: string | null; loading: boolean; msg: string | null }>({ which: null, loading: false, msg: null });
  const player = useRef<AudioPlayer | null>(null);
  const heard = useRef(""), released = useRef(false), turnsRef = useRef(turns);
  turnsRef.current = turns;
  const stop = () => { player.current?.remove(); player.current = null; setAudio({ which: null, loading: false, msg: null }); };
  useEffect(() => () => { stop(); ExpoSpeechRecognitionModule.abort(); }, []);
  const speak = async (which: string, url: string) => {
    if (audio.which === which && !audio.loading) return stop();
    stop(); setAudio({ which, loading: true, msg: null });
    try { await playUrl(url, player, stop); setAudio({ which, loading: false, msg: null }); }
    catch (e) { setAudio({ which: null, loading: false, msg: e instanceof Error ? e.message : "n/a right now" }); }
  };
  const ask = async (question: string) => {
    question = question.trim();
    if (!question) { setPhase("idle"); setErr("I didn't catch that. Hold the mic and ask again."); return; }
    setPhase("thinking"); setErr(null);
    const history = turnsRef.current.filter((t) => !t.refused).slice(-3).map((t) => ({ q: t.q, a: t.answer }));
    try {
      const r = await talk(ticker, question, history);
      setTurns((t) => [...t, { ...r, q: question }]);
      if (r.id) speak(`a-${r.id}`, paths.talkAudio(r.id));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setPhase("idle"); setLive(""); }
  };

  useSpeechRecognitionEvent("result", (e) => { heard.current = e.results[0]?.transcript || heard.current; setLive(heard.current); });
  useSpeechRecognitionEvent("error", (e) => {
    if (e.error === "aborted") return;
    if (e.error === "no-speech" || e.error === "speech-timeout") return; // handled on "end" as "didn't catch that"
    setErr(e.error === "not-allowed" ? "Microphone or speech access is off. Turn it on in Settings, or type instead." : "Couldn't hear that. Try again, or type instead.");
  });
  useSpeechRecognitionEvent("end", () => { if (released.current) { released.current = false; ask(heard.current); } else setPhase("idle"); });

  const start = async (file?: string) => {
    if (phase !== "idle") return;
    stop(); setErr(null); heard.current = ""; setLive(""); released.current = false;
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setErr("Microphone or speech access is off. Turn it on in Settings, or type instead."); return; }
    setPhase("listening");
    ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true, continuous: true, addsPunctuation: true,
      ...(file ? { audioSource: { uri: file } } : {}) });
    if (file) released.current = true; // a file ends by itself
  };
  const release = () => {
    if (phase !== "listening") return;
    released.current = true; setPhase("hearing");
    ExpoSpeechRecognitionModule.stop();
  };
  useEffect(() => { if (hear) setTimeout(() => start(hear), 800); }, [hear]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = (w: string) => audio.which === w && !audio.loading;
  const label = { idle: turns.length ? "Hold to ask again" : "Hold to talk", listening: "Listening… release to send", hearing: "Got it…", thinking: "Thinking…" }[phase];

  return (
    <View style={st.talk}>
      <Pressable onPress={() => briefing.id && speak("briefing", paths.audio(briefing.id, ticker, briefing.mode))} style={st.talkRead} hitSlop={6}
        accessibilityRole="button" accessibilityLabel={on("briefing") ? "Stop reading" : `Read the ${ticker} briefing aloud`}>
        {audio.loading && audio.which === "briefing" ? <ActivityIndicator size="small" color={C.ink} /> :
          <Text style={st.speakerText}>{on("briefing") ? "■ Stop reading" : "🔈 Read the briefing aloud"}</Text>}
      </Pressable>
      {turns.map((t, i) => (
        <View key={i} style={st.turn}>
          <Text style={st.youText}>You: {t.q}</Text>
          <Text style={[st.answer, t.refused && { color: C.dim }]}>{t.answer}</Text>
          {t.id && (
            <Pressable onPress={() => speak(`a-${t.id}`, paths.talkAudio(t.id!))} hitSlop={6} accessibilityRole="button">
              <Text style={st.hear}>{on(`a-${t.id}`) ? "■ Stop" : audio.loading && audio.which === `a-${t.id}` ? "Loading…" : "🔈 Hear again"}</Text>
            </Pressable>)}
          {t.sources.map((x) => (
            <Pressable key={x.n} disabled={!x.url} onPress={() => x.url && WebBrowser.openBrowserAsync(x.url)} accessibilityRole="link">
              <Text style={st.source}>[{x.n}] <Text style={{ color: C.ink }}>{x.title}</Text>{x.source ? ` · ${x.source}` : ""}</Text>
            </Pressable>))}
        </View>))}
      {phase !== "idle" && live ? <Text style={[st.youText, { marginTop: 12 }]}>You: {live}</Text> : null}
      {audio.msg && <Text style={st.small}>Read-aloud: {audio.msg}</Text>}
      <View style={st.holdWrap}>
        <Pressable onPressIn={() => start()} onPressOut={release} disabled={phase === "hearing" || phase === "thinking"}
          style={[st.hold, phase === "listening" && { backgroundColor: C.amber, borderColor: C.amber, transform: [{ scale: 1.1 }] },
            (phase === "hearing" || phase === "thinking") && { opacity: 0.5 }]}
          accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Hold while you speak, release to send">
          {phase === "thinking" || phase === "hearing" ? <ActivityIndicator color={C.ground} /> : <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={C.ground} strokeWidth={1.8} strokeLinecap="round">
            <Rect x={9} y={3} width={6} height={11} rx={3} fill={phase === "listening" ? C.ground : "none"} /><Path d="M5 11a7 7 0 0014 0M12 18v3" /></Svg>}
        </Pressable>
        <Text style={st.holdLabel} accessibilityLiveRegion="polite">{label}</Text>
      </View>
      {typing ? (
        <View style={st.askRow}>
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => { const x = q; setQ(""); ask(x); }} returnKeyType="send" maxLength={300} autoFocus
            placeholder={`Ask about ${ticker}'s news`} placeholderTextColor={C.dim} style={st.input} accessibilityLabel={`Ask about ${ticker}'s news`} />
          <Pressable onPress={() => { const x = q; setQ(""); ask(x); }} disabled={!q.trim() || phase !== "idle"} style={[st.askBtn, (!q.trim() || phase !== "idle") && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={st.askT}>Ask</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setTyping(true)} hitSlop={8} style={{ alignSelf: "center", marginTop: 8 }} accessibilityRole="button">
          <Text style={st.typeLink}>Type instead</Text>
        </Pressable>
      )}
      {err && <Text style={[st.small, { color: C.down, textAlign: "center" }]}>{err}</Text>}
      <Text style={st.small}>Answers come only from {ticker}'s recent headlines and their tags, and are read aloud. No investment advice, price targets or predictions.</Text>
    </View>
  );
}

// Gemini briefing from this stock's own tagged headlines: up to 4 bullets, or paragraphs in Advanced mode. Talk opens
// read-aloud (ElevenLabs) and questions.
export function BriefingCard({ ticker, nonce, advanced, initialTalk = false, hear }: { ticker: string; nonce: number; advanced: boolean; initialTalk?: boolean; hear?: string }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const long = useApi<Briefing>(advanced ? paths.briefing(ticker, true) : null, nonce);
  const longOk = advanced && long.data?.status === "ok";
  const fallback = advanced && !long.loading && !longOk;
  const s = useApi<Briefing>(!advanced || fallback ? paths.briefing(ticker) : null, nonce);
  const [open, setOpen] = useState(initialTalk);
  useEffect(() => setOpen(initialTalk), [ticker]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = longOk ? long : s;
  const b = cur.data;
  const ok = b?.status === "ok";
  const paras = ok && b.mode === "advanced" ? paragraphsOf(b.text) : [];
  const bullets = ok && b.mode !== "advanced" ? bulletsOf(b.text) : [];

  return (
    <Card title="Briefing" right={ok ? (
      <Pressable onPress={() => setOpen(!open)} style={[st.speaker, open && { borderColor: C.amber }]} hitSlop={6} accessibilityRole="button"
        accessibilityState={{ expanded: open }} accessibilityLabel={`Talk about ${ticker}'s news`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={open ? C.amber : C.ink} strokeWidth={2} strokeLinecap="round">
            <Rect x={9} y={3} width={6} height={11} rx={3} /><Path d="M5 11a7 7 0 0014 0M12 18v3" /></Svg>
          <Text style={[st.speakerText, open && { color: C.amber }]}>Talk</Text></View>
      </Pressable>) : null}>
      {(cur.loading || (advanced && long.loading)) && <Status s={cur} what="briefing" />}
      {cur.err && <Text style={st.dim}>Summary: n/a right now.</Text>}
      {b && !ok && <Text style={st.dim}>Briefing: n/a. {b.status === "no_key" ? "No Gemini key is set on this server." : b.message || ""}</Text>}
      {ok && (
        <>
          {paras.map((x, i) => <Text key={i} style={st.para}>{x}</Text>)}
          {bullets.map((x, i) => (
            <View key={i} style={st.bulletRow}><Text style={st.bulletDot}>·</Text><Text style={st.bullet}>{x}</Text></View>
          ))}
          {paras.length === 0 && bullets.length === 0 && <Text style={st.dim}>Summary: n/a</Text>}
          <Text style={st.small}>Written by Gemini ({b.model || "n/a"}) from {b.n} {ticker} headlines, {b.window}. Tags come from Qwen.</Text>
          {fallback && <Text style={st.small}>Longer briefing: n/a until the next update. Showing the short one.</Text>}
          {open && <TalkPanel ticker={ticker} briefing={b} hear={hear} />}
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
// Advanced mode shows everything (active model, status dot, steps, elapsed time, the long explanation); otherwise the
// same button and box with plain wording, a simple progress state and a Done check.
export function FineTuneCard({ ticker, active, advanced, onActive, onTrained }: {
  ticker: string; active: Model; advanced: boolean; onActive: (m: Model) => void; onTrained: () => void;
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
      if (pw !== password) setPassword(pw); // accepted: keep it in the keychain
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      if (code === 401) { setPassword(null); setPwErr("Wrong password. Try again."); setAsk(what); return; }
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const frac = status?.phase === "done" ? 1 : status?.total_steps ? (status.step || 0) / status.total_steps : 0;
  const elapsed = clock(status?.phase === "queued" ? status.queued_s : status?.elapsed_s);
  const shown = running || status?.phase === "done" || status?.phase === "failed";
  const modal = <PasswordModal visible={!!ask} error={pwErr} onCancel={() => setAsk(null)}
    onSubmit={(pw) => { const what = ask!; setAsk(null); run(what, pw); }} />;
  if (!advanced) {
    const done = status?.phase === "done" && !status.quick;
    return (
      <Card title="Tune">
        <Pressable onPress={() => run("train")} disabled={!supported || running || online === false}
          style={({ pressed }) => [st.primary, { marginTop: 0 }, (!supported || running || online === false) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
          accessibilityRole="button">
          <Text style={st.primaryText}>{running ? "Tuning…" : "Tune to this stock"}</Text>
        </Pressable>
        {active === "specialist" && !running && (
          <Pressable onPress={() => run("reset")} style={({ pressed }) => [st.secondary, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={st.secondaryText}>Undo tuning</Text>
          </Pressable>
        )}
        {(running || done || status?.phase === "failed") && (
          <View style={{ marginTop: 14 }}>
            <Text style={[st.small, { marginTop: 0 }, done && { color: C.up }, status?.phase === "failed" && { color: C.down }]}>
              {running ? "Tuning…" : done ? "✓ Done" : "Didn't finish. Try again later."}</Text>
            <View style={st.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}>
              <View style={[st.fill, { width: `${Math.round(frac * 100)}%` }]} />
            </View>
          </View>
        )}
        <Text style={st.small}>{online === false ? "Tuning is offline right now." : !info || supported
          ? "Trains the model on this stock's news so it reads these headlines more accurately. About a minute."
          : `Tuning is available for ${stocks.join(", ")}.`}</Text>
        {err && <Text style={[st.small, { color: C.down }]}>{err}</Text>}
        {modal}
      </Card>
    );
  }
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
      {modal}
    </Card>
  );
}

const fullTime = (iso?: string) => {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? "Time n/a" : new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

// Latest headlines: 3 at first, "Show more" expands the full list. Advanced mode adds each article's source, full
// timestamp and a link to the original story, newest first.
export function HeadlinesCard({ ticker, model, nonce, advanced, initialAll = false }: { ticker: string; model: Model; nonce: number; advanced: boolean; initialAll?: boolean }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Headlines>(paths.headlines(ticker, model), nonce);
  const [all, setAll] = useState(initialAll);
  const items = s.data?.items || [];
  const ordered = advanced ? [...items].sort((a, b) => (Date.parse(b.time || "") || 0) - (Date.parse(a.time || "") || 0)) : items;
  const shown = all ? ordered : ordered.slice(0, 3);
  return (
    <Card title="Latest headlines" right={s.data?.provider ? <Text style={st.small}>{s.data.provider}</Text> : null}>
      <Status s={s} what="headlines" />
      {advanced && s.data && <Text style={[st.small, { marginTop: 0, marginBottom: 6 }]}>{items.length} articles for {ticker}, newest first, with the link to each original story.</Text>}
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
            <Text style={st.headlineText} numberOfLines={advanced ? undefined : 3}>{h.title}</Text>
            {advanced ? (
              <View style={st.artMeta}>
                <Text style={[st.meta, { color: C.ink, fontWeight: "700" }]}>{h.source || "Source n/a"}</Text>
                <Text style={st.meta}>{fullTime(h.time)}</Text>
                <Text style={[st.meta, { color: h.url ? C.amber : C.dim, fontWeight: "700" }]}>{h.url ? "Open article ↗" : "Link n/a"}</Text>
              </View>
            ) : <Text style={st.meta}>{[h.source, relTime(h.time)].filter(Boolean).join(" · ")}</Text>}
          </View>
        </Pressable>
      ))}
      {items.length > 3 && (
        <Pressable onPress={() => setAll(!all)} style={st.moreBtn} accessibilityRole="button">
          <Text style={st.more}>{all ? "Show less" : "Show more"}</Text>
        </Pressable>
      )}
      {s.data && <Text style={st.small}>{model === "none" ? "No sentiment model runs on crypto, so these are untagged."
        : `Tags by Qwen, ${model === "specialist" ? `${ticker} specialist` : "general model"}.`}</Text>}
    </Card>
  );
}

// Crypto headlines (/api/crypto/news). Tags and the tone bar appear only once the worker pushes the general model's
// tags for the coin; until then both are hidden (not shown as n/a). No fine-tune on crypto.
export function CryptoNewsCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<CryptoNews>(paths.cryptoNews(ticker), nonce);
  const [all, setAll] = useState(false);
  const d = s.data, items = d?.items || [];
  const tagged = !!d?.tagged;
  const hasBar = tagged && [d?.p_bearish, d?.p_neutral, d?.p_bullish].every((x) => typeof x === "number");
  const shown = all ? items : items.slice(0, 3);
  return (
    <>
      {hasBar && <Card title="Headline tone" right={<Text style={st.small}>general news model</Text>}><ProbBar d={d} /></Card>}
      <Card title="Latest headlines" right={d?.provider ? <Text style={st.small}>{d.provider}</Text> : null}>
        {s.loading && <Status s={s} what="headlines" />}
        {s.err && <Text style={st.dim}>Headlines: n/a right now.</Text>}
        {d && items.length === 0 && <Text style={st.dim}>No headlines found.</Text>}
        {shown.map((h, k) => (
          <Pressable key={k} disabled={!h.url} onPress={() => h.url && WebBrowser.openBrowserAsync(h.url)}
            style={({ pressed }) => [st.headline, k === 0 && { borderTopWidth: 0 }, pressed && { opacity: 0.6 }]} accessibilityRole="link">
            {tagged && (
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
            <Text style={st.more}>{all ? "Show less" : "Show more"}</Text>
          </Pressable>
        )}
        {d?.filter_note ? <Text style={st.small}>{d.filter_note}.</Text> : null}
        {tagged && <Text style={[st.small, { color: C.amber }]}>Tagged by our general news model, not yet validated on crypto.</Text>}
      </Card>
    </>
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
  para: { color: C.ink, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  talk: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  talkRead: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
  turn: { marginTop: 12 },
  youText: { color: C.dim, fontSize: 14, lineHeight: 20 },
  answer: { color: C.ink, fontSize: 15, lineHeight: 21, marginTop: 4 },
  hear: { color: C.dim, fontSize: 12, marginTop: 4 },
  source: { color: C.dim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  askRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  holdWrap: { alignItems: "center", marginTop: 16, gap: 8 },
  hold: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.ink, borderWidth: 2, borderColor: C.ink, alignItems: "center", justifyContent: "center" },
  holdLabel: { color: C.dim, fontSize: 13 },
  typeLink: { color: C.amber, fontSize: 13, fontWeight: "600" },
  input: { flex: 1, borderWidth: 1, borderColor: C.line, color: C.ink, paddingHorizontal: 10, minHeight: 44, fontSize: 15 },
  askBtn: { backgroundColor: C.ink, paddingHorizontal: 16, minHeight: 44, justifyContent: "center" },
  askT: { color: C.ground, fontSize: 15, fontWeight: "700" },
  artMeta: { flexDirection: "row", flexWrap: "wrap", columnGap: 10 },
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

