import { useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsButton } from "@/components/Settings";
import { useLocalSearchParams, useRouter } from "expo-router";
import { paths, type CryptoNews, type CryptoQuote, type Headlines, type Label, type Prices } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { CRYPTO, HOME, isCrypto, NAMES, short, SUPPORTED } from "@/lib/peers";
import { useList } from "@/lib/list";
import { Onboarding } from "@/components/Onboarding";
import { labelColor, pct, SERIF, toneColor, usd, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";

const TICKER_RE = /^[A-Z][A-Z.-]{0,9}$/;

// Most common Qwen tag among the headlines (ties go to Neutral); null when nothing is tagged.
function dominant(items: Headlines["items"] = []): Label | null {
  const c = { Bullish: 0, Bearish: 0, Neutral: 0 };
  for (const i of items) if (i.label) c[i.label]++;
  const top = Math.max(c.Bullish, c.Bearish, c.Neutral);
  if (!top) return null;
  return c.Neutral === top ? "Neutral" : c.Bullish === top ? (c.Bearish === top ? "Neutral" : "Bullish") : "Bearish";
}

// One stock row: the share PRICE and today's change (we have no accounts or holdings), plus the dominant tone.
function Row({ ticker, nonce, onOpen }: { ticker: string; nonce: number; onOpen: (t: string) => void }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const crypto = isCrypto(ticker);
  // crypto: Coinbase price and 24h change; the tone pill appears only once the worker pushes tags for the coin
  const p = useApi<Prices | CryptoQuote>(crypto ? paths.cryptoQuote(ticker) : paths.prices(ticker, "3mo"), nonce);
  const h = useApi<Headlines | CryptoNews>(crypto ? paths.cryptoNews(ticker) : paths.headlines(ticker), nonce);
  if (crypto ? p.err : p.err && h.err) return null; // only rows with real data (never an n/a price for crypto)
  const tone = h.data ? dominant(h.data.items) : null;
  const change = p.data ? ("change_24h" in p.data ? p.data.change_24h : p.data.change_1d) : null;
  const showPill = crypto ? !!((h.data as CryptoNews | null)?.tagged && tone) : !h.loading;
  return (
    <Pressable onPress={() => onOpen(ticker)} style={({ pressed }) => [st.row, pressed && { backgroundColor: C.line }]}
      accessibilityRole="button" accessibilityLabel={`${ticker}, ${NAMES[ticker]}`}>
      <View style={st.mono}><Text style={st.monoText}>{short(ticker)[0]}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.ticker}>{short(ticker)}</Text>
        <Text style={st.company} numberOfLines={1}>{NAMES[ticker] || "n/a"}</Text>
      </View>
      <View style={st.right}>
        <Text style={st.price}>{p.data ? usd(p.data.last) : p.loading ? "…" : "n/a"}</Text>
        <View style={st.rightRow}>
          {showPill && (
            <View style={[st.pill, { borderColor: labelColor(C, tone) }]}>
              <Text style={[st.pillText, { color: labelColor(C, tone) }]}>{tone || "n/a"}</Text>
            </View>
          )}
          <Text style={[st.change, { color: typeof change === "number" ? toneColor(C, change) : C.dim }]}>
            {p.data ? pct(change, 2) : p.loading ? "" : "n/a"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function Section({ title, note, tickers, nonce, onOpen, right }: {
  title: string; note?: string; tickers: string[]; nonce: number; onOpen: (t: string) => void; right?: ReactNode;
}) {
  const st = useStyles(makeStyles);
  return (
    <View style={{ marginTop: 26 }}>
      <View style={st.secHead}><Text style={st.h2}>{title}</Text>{right}</View>
      {note ? <Text style={st.sub}>{note}</Text> : null}
      <View style={st.list}>{tickers.map((t) => <Row key={t} ticker={t} nonce={nonce} onOpen={onOpen} />)}</View>
    </View>
  );
}

// Explore more: every supported name not already in Your list, A to Z, each with an Add button. It only lets the
// user add names; nothing is ranked or suggested.
function Explore({ list, onAdd, onOpen }: { list: string[]; onAdd: (t: string) => void; onOpen: (t: string) => void }) {
  const st = useStyles(makeStyles);
  const rest = SUPPORTED.filter((t) => !list.includes(t)).sort((a, b) => short(a).localeCompare(short(b)));
  return (
    <View style={{ marginTop: 26 }}>
      <Text style={st.h2}>Explore more</Text>
      <Text style={st.sub}>Every name Knight-Daddy covers, A to Z. Add any of them to Your list.</Text>
      {rest.length === 0 ? <Text style={[st.sub, { marginTop: 10 }]}>Every covered name is already in Your list.</Text> : (
        <View style={st.list}>
          {rest.map((t) => (
            <View key={t} style={st.row}>
              <Pressable onPress={() => onOpen(t)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} accessibilityRole="button">
                <View style={st.mono}><Text style={st.monoText}>{short(t)[0]}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.ticker}>{short(t)}</Text>
                  <Text style={st.company} numberOfLines={1}>{NAMES[t] || "n/a"}</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => onAdd(t)} style={st.add} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Add ${short(t)} to Your list`}>
                <Text style={st.addT}>+ Add</Text>
              </Pressable>
            </View>))}
        </View>
      )}
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const { C, dark, toggle } = useTheme();
  const st = useStyles(makeStyles);
  const [nonce, setNonce] = useState(0);
  const { ready, onboarded, list, save } = useList();
  const [editing, setEditing] = useState(false);
  const open = (t: string) => router.push({ pathname: "/stock/[ticker]", params: { ticker: t } });
  // Deep link: knightdaddy://?ticker=DDOG opens that stock.
  const link = useLocalSearchParams<{ ticker?: string }>();
  useEffect(() => {
    const t = typeof link.ticker === "string" ? link.ticker.toUpperCase() : "";
    if (TICKER_RE.test(t)) router.push({ pathname: "/stock/[ticker]", params: { ticker: t } });
  }, [link.ticker, router]);

  if (!ready) return <View style={st.screen} />;
  if (!onboarded || editing) {
    return <Onboarding initial={list} onDone={(l) => { save(l); setEditing(false); }} onSkip={() => { save(editing ? list : []); setEditing(false); }} />;
  }
  const edit = (label: string) => (
    <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button"><Text style={st.link}>{label}</Text></Pressable>);

  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      <View style={st.header}>
        <View style={st.brand}>
          <Image source={require("../../assets/icon.png")} style={st.logo} />
          <Text style={st.brandText}>Knight-Daddy</Text>
        </View>
        <View style={{ flexDirection: "row" }}>
        <Pressable onPress={toggle} style={st.themeBtn} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Text style={st.themeIcon}>{dark ? "☀︎" : "☾"}</Text>
        </Pressable>
        <SettingsButton current={null} />
        </View>
      </View>
      <ScrollView contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={false} tintColor={C.amber} onRefresh={() => setNonce((n) => n + 1)} />}>
        {list.length > 0 && <Section title="Your list" tickers={list} nonce={nonce} onOpen={open} right={edit("Edit your list")} />}
        <Section title="Stocks" note={"Price and today's change, with the dominant tone of recent headlines."} tickers={HOME}
          nonce={nonce} onOpen={open} right={list.length ? null : edit("Build your list")} />
        <Section title="Crypto" note="Coinbase price and 24h change." tickers={CRYPTO} nonce={nonce} onOpen={open} />
        <Explore list={list} onAdd={(t) => save(list.includes(t) ? list : [...list, t])} onOpen={open} />
        <Pressable onPress={() => router.push("/replay")} style={({ pressed }) => [st.replay, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={st.h2}>Replay</Text>
          <Text style={st.sub}>{"Re-run the model on a past day's headlines and see what it would have said."}</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/model")} style={({ pressed }) => [st.replay, { marginTop: 12 }, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={st.h2}>Model info</Text>
          <Text style={st.sub}>How our news model scores against FinBERT, the full benchmark table and the historical backtest.</Text>
        </Pressable>
        <Text style={st.footer}>News sentiment, not investment advice.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: Palette) => sheet({
  screen: { flex: 1, backgroundColor: C.ground },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.rule },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 24, height: 24 },
  brandText: { color: C.amber, fontSize: 16, fontWeight: "700" },
  themeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  themeIcon: { color: C.ink, fontSize: 20 },
  content: { padding: 16, paddingBottom: 48 },
  h2: { color: C.ink, fontSize: 24, fontFamily: SERIF },
  secHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  link: { color: C.amber, fontSize: 13, fontWeight: "600" },
  replay: { marginTop: 28, borderWidth: 1, borderColor: C.line, padding: 14, gap: 2 },
  sub: { color: C.dim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  list: { marginTop: 10, borderTopWidth: 1, borderTopColor: C.rule },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: C.line, minHeight: 72 },
  mono: { width: 40, height: 40, borderWidth: 1, borderColor: C.rule, alignItems: "center", justifyContent: "center" },
  monoText: { color: C.ink, fontSize: 16, fontFamily: SERIF },
  ticker: { color: C.ink, fontSize: 16, fontWeight: "700" },
  company: { color: C.dim, fontSize: 12, marginTop: 2 },
  right: { alignItems: "flex-end", gap: 5 },
  rightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  price: { color: C.ink, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  change: { fontSize: 13, fontWeight: "600", minWidth: 58, textAlign: "right", fontVariant: ["tabular-nums"] },
  pill: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  pillText: { fontSize: 11, fontWeight: "600" },
  add: { borderWidth: 1, borderColor: C.rule, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  addT: { color: C.ink, fontSize: 13, fontWeight: "700" },
  footer: { color: C.dim, fontSize: 12, marginTop: 28, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
});
