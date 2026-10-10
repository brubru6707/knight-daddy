import { useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { paths, type Headlines, type Label, type Prices } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { HOME, NAMES } from "@/lib/peers";
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
  const p = useApi<Prices>(paths.prices(ticker, "3mo"), nonce);
  const h = useApi<Headlines>(paths.headlines(ticker), nonce);
  if (p.err && h.err) return null; // only rows with real data
  const tone = h.data ? dominant(h.data.items) : null;
  return (
    <Pressable onPress={() => onOpen(ticker)} style={({ pressed }) => [st.row, pressed && { backgroundColor: C.line }]}
      accessibilityRole="button" accessibilityLabel={`${ticker}, ${NAMES[ticker]}`}>
      <View style={st.mono}><Text style={st.monoText}>{ticker[0]}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.ticker}>{ticker}</Text>
        <Text style={st.company} numberOfLines={1}>{NAMES[ticker] || "n/a"}</Text>
      </View>
      <View style={st.right}>
        <Text style={st.price}>{p.data ? usd(p.data.last) : p.loading ? "…" : "n/a"}</Text>
        <View style={st.rightRow}>
          {!h.loading && (
            <View style={[st.pill, { borderColor: labelColor(C, tone) }]}>
              <Text style={[st.pillText, { color: labelColor(C, tone) }]}>{tone || "n/a"}</Text>
            </View>
          )}
          <Text style={[st.change, { color: p.data ? toneColor(C, p.data.change_1d) : C.dim }]}>
            {p.data ? pct(p.data.change_1d, 2) : p.loading ? "" : "n/a"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function Home() {
  const router = useRouter();
  const { C, dark, toggle } = useTheme();
  const st = useStyles(makeStyles);
  const [nonce, setNonce] = useState(0);
  const open = (t: string) => router.push({ pathname: "/stock/[ticker]", params: { ticker: t } });
  // Deep link: knightdaddy://?ticker=DDOG opens that stock.
  const link = useLocalSearchParams<{ ticker?: string }>();
  useEffect(() => {
    const t = typeof link.ticker === "string" ? link.ticker.toUpperCase() : "";
    if (TICKER_RE.test(t)) router.push({ pathname: "/stock/[ticker]", params: { ticker: t } });
  }, [link.ticker, router]);

  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      <View style={st.header}>
        <View style={st.brand}>
          <Image source={require("../../assets/icon.png")} style={st.logo} />
          <Text style={st.brandText}>Knight-Daddy</Text>
        </View>
        <Pressable onPress={toggle} style={st.themeBtn} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Text style={st.themeIcon}>{dark ? "☀︎" : "☾"}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={false} tintColor={C.amber} onRefresh={() => setNonce((n) => n + 1)} />}>
        <Text style={st.h1}>Stocks</Text>
        <Text style={st.sub}>{"Price and today's change, with the dominant tone of recent headlines."}</Text>
        <View style={st.list}>
          {HOME.map((t) => <Row key={t} ticker={t} nonce={nonce} onOpen={open} />)}
        </View>
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
  h1: { color: C.ink, fontSize: 32, fontFamily: SERIF, marginTop: 8 },
  sub: { color: C.dim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  list: { marginTop: 18, borderTopWidth: 1, borderTopColor: C.rule },
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
  footer: { color: C.dim, fontSize: 12, marginTop: 28, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
});
