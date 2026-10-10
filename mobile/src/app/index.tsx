import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { api, ApiError, paths, startTraining, type Health, type SpecInfo, type SpecStatus } from "@/lib/api";
import { useSession, type Mode } from "@/lib/session";
import { C } from "@/lib/theme";
import { PEERS } from "@/lib/peers";
import { CompetitorsCard, HeadlinesCard, OutlookCard, PriceHero } from "@/components/simple";
import { BacktestCard, BenchmarkCard, SentimentCard, SpecialistCard, WorkerCard } from "@/components/advanced";
import { PasswordModal } from "@/components/PasswordModal";
import { TrainBar, type TrainState } from "@/components/TrainBar";

const OFFLINE = "Model offline, showing latest data";
const TICKER_RE = /^[A-Z][A-Z.-]{0,9}$/;

export default function Home() {
  const { mode, setMode, password, setPassword } = useSession();
  // Deep links: knightdaddy://?ticker=DDOG&mode=advanced (also exp://<host>/--/?ticker=... in Expo Go).
  const link = useLocalSearchParams<{ ticker?: string; mode?: string }>();
  const linkTicker = typeof link.ticker === "string" && TICKER_RE.test(link.ticker.toUpperCase()) ? link.ticker.toUpperCase() : null;
  const [ticker, setTicker] = useState(linkTicker || "NVDA");
  const [query, setQuery] = useState(linkTicker || "NVDA");
  const [seenLink, setSeenLink] = useState(linkTicker);
  if (linkTicker && linkTicker !== seenLink) { setSeenLink(linkTicker); setTicker(linkTicker); setQuery(linkTicker); }
  useEffect(() => { if (link.mode === "simple" || link.mode === "advanced") setMode(link.mode); }, [link.mode, setMode]);
  const [nonce, setNonce] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [train, setTrain] = useState<TrainState>({ kind: "idle" });
  const [pwOpen, setPwOpen] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api<Health>(paths.health());
      setHealth(h); setHealthErr(null);
      return h;
    } catch (e) {
      setHealthErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);
  useEffect(() => {
    let live = true;
    api<Health>(paths.health()).then((h) => { if (live) setHealth(h); })
      .catch((e: unknown) => { if (live) setHealthErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const tracked = health?.tracked_tickers;
  const unsupported = !!tracked && !tracked.includes(ticker);

  const follow = (t: string) => {
    if (poll.current) clearInterval(poll.current);
    const tick = async () => {
      try {
        const st = await api<SpecStatus>(paths.specStatus(t));
        setTrain({ kind: "job", ticker: t, status: st });
        if (st.phase === "done" || st.phase === "failed") {
          if (poll.current) clearInterval(poll.current);
          if (st.phase === "done") setNonce((n) => n + 1);
        }
      } catch { /* transient: keep polling */ }
    };
    setTrain({ kind: "job", ticker: t, status: { phase: "queued" } });
    poll.current = setInterval(tick, 2000);
    tick();
  };

  const submitTraining = async (t: string, pw: string) => {
    try {
      await startTraining(t, pw);
      follow(t);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      const msg = e instanceof Error ? e.message : String(e);
      if (status === 401) { setPassword(null); pending.current = t; setPwErr("Wrong password. Try again."); setPwOpen(true); return; }
      if (status === 503) { setTrain({ kind: "info", text: OFFLINE, tone: "warn" }); return; }
      if (status === 409) { setTrain({ kind: "info", text: "GPU busy with another run. Showing latest data.", tone: "warn" }); return; }
      setTrain({ kind: "info", text: `Fine-tune not started: ${msg}`, tone: "warn" });
    }
  };

  const load = (t: string) => {
    if (poll.current) clearInterval(poll.current);
    setTrain({ kind: "idle" });
    setTicker(t); setQuery(t); setNonce((n) => n + 1);
    refreshHealth();
  };

  // "Load + Fine-tune": load everything for the ticker, then queue a training job if the worker can take it.
  const loadAndTrain = async () => {
    Keyboard.dismiss();
    const t = query.trim().toUpperCase();
    if (!TICKER_RE.test(t)) { setTrain({ kind: "info", text: "Enter a ticker symbol, like NVDA.", tone: "dim" }); return; }
    load(t);
    const h = await refreshHealth();
    if (h?.tracked_tickers && !h.tracked_tickers.includes(t)) return; // friendly message is shown below
    let info: SpecInfo | null = null;
    try { info = await api<SpecInfo>(paths.specInfo()); } catch { /* fall through */ }
    if (info && !info.supported.includes(t)) {
      setTrain({ kind: "info", text: `No fine-tune model for ${t} yet. Showing latest data.`, tone: "dim" }); return;
    }
    if (!h?.worker_online) { setTrain({ kind: "info", text: OFFLINE, tone: "warn" }); return; }
    if (!password) { pending.current = t; setPwErr(null); setPwOpen(true); return; }
    submitTraining(t, password);
  };

  const onPassword = (pw: string) => {
    setPassword(pw); setPwOpen(false);
    const t = pending.current; pending.current = null;
    if (t) submitTraining(t, pw);
  };

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <View style={s.header}>
        <View style={s.brand}>
          <Image source={require("../../assets/icon.png")} style={s.logo} />
          <Text style={s.brandText}>Knight-Daddy</Text>
        </View>
        <View style={s.toggle} accessibilityRole="tablist">
          {(["simple", "advanced"] as Mode[]).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[s.toggleBtn, mode === m && s.toggleOn]}
              accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
              <Text style={[s.toggleText, mode === m && { color: C.ground }]}>{m === "simple" ? "Simple" : "Advanced"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} tintColor={C.amber} onRefresh={() => { setNonce((n) => n + 1); refreshHealth(); }} />}>
        <View style={s.search}>
          <TextInput value={query} onChangeText={(v) => setQuery(v.toUpperCase())} placeholder="Ticker" placeholderTextColor={C.dim}
            autoCapitalize="characters" autoCorrect={false} maxLength={10} returnKeyType="go" onSubmitEditing={loadAndTrain}
            style={s.input} accessibilityLabel="Ticker" />
          <Pressable onPress={loadAndTrain} style={({ pressed }) => [s.go, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <Text style={s.goText}>Load + Fine-tune</Text>
          </Pressable>
        </View>

        <TrainBar state={train} />
        {healthErr && !health && <Text style={s.warn}>{"Can't reach the server right now. Pull down to retry."}</Text>}

        {unsupported ? (
          <>
            <View style={s.friendly}>
              <Text style={s.friendlyBig}>{`${ticker} isn't tracked yet`}</Text>
              <Text style={s.dim}>Knight-Daddy currently follows {tracked!.join(" and ")}. Tap one to jump back.</Text>
              <View style={s.peers}>
                {tracked!.map((t) => (
                  <Pressable key={t} onPress={() => load(t)} style={s.peer}><Text style={s.peerText}>{t}</Text></Pressable>
                ))}
              </View>
            </View>
            {PEERS[ticker] && <CompetitorsCard ticker={ticker} onPick={load} />}
          </>
        ) : mode === "simple" ? (
          <>
            <PriceHero key={`px-${ticker}`} ticker={ticker} nonce={nonce} />
            <HeadlinesCard ticker={ticker} nonce={nonce} />
            <OutlookCard ticker={ticker} nonce={nonce} />
            <CompetitorsCard ticker={ticker} onPick={load} />
          </>
        ) : (
          <>
            <PriceHero key={`px-${ticker}`} ticker={ticker} nonce={nonce} />
            <SentimentCard ticker={ticker} nonce={nonce} />
            <BacktestCard ticker={ticker} nonce={nonce} />
            <BenchmarkCard nonce={nonce} />
            <SpecialistCard ticker={ticker} nonce={nonce} />
            <WorkerCard health={health} />
          </>
        )}
        <Text style={s.disclaimer}>Research demo. News summary, not financial advice.</Text>
      </ScrollView>

      <PasswordModal visible={pwOpen} error={pwErr} onSubmit={onPassword}
        onCancel={() => { setPwOpen(false); pending.current = null; setTrain({ kind: "info", text: "Fine-tune skipped. Showing latest data.", tone: "dim" }); }} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 26, height: 26, borderRadius: 6 },
  brandText: { color: C.amber, fontSize: 16, fontWeight: "800", letterSpacing: 1 },
  toggle: { flexDirection: "row", backgroundColor: C.panel, borderRadius: 999, borderWidth: 1, borderColor: C.line, padding: 3 },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  toggleOn: { backgroundColor: C.amber },
  toggleText: { color: C.dim, fontWeight: "700", fontSize: 13 },
  content: { padding: 16, paddingBottom: 48 },
  search: { flexDirection: "row", gap: 10, marginBottom: 12 },
  input: { flex: 1, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, color: C.ink, fontSize: 18, fontWeight: "700", paddingHorizontal: 14, paddingVertical: 12, letterSpacing: 1 },
  go: { backgroundColor: C.amber, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
  goText: { color: C.ground, fontWeight: "800", fontSize: 14 },
  warn: { color: C.amber, fontSize: 13, marginBottom: 12 },
  dim: { color: C.dim, fontSize: 14 },
  friendly: { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 16, marginBottom: 12, gap: 8 },
  friendlyBig: { color: C.ink, fontSize: 22, fontWeight: "800" },
  peers: { flexDirection: "row", gap: 10, marginTop: 4 },
  peer: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.amber },
  peerText: { color: C.amber, fontWeight: "800", fontSize: 16 },
  disclaimer: { color: C.dim, fontSize: 11, textAlign: "center", marginTop: 8 },
});
