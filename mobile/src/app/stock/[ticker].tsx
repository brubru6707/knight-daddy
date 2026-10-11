import { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsButton } from "@/components/Settings";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, paths, type Model } from "@/lib/api";
import { useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
import { BriefingCard, CompetitorsRow, ConfidenceBar, CryptoNewsCard, FineTuneCard, HeadlinesCard, PriceHero } from "@/components/detail";
import { SentimentCard } from "@/components/advanced";
import { useAdvanced } from "@/lib/advanced";
import { isCrypto } from "@/lib/peers";

// Ticker detail, only what is specific to this stock: price and chart, Qwen confidence bar, Gemini briefing with Talk,
// this stock's sentiment-vs-price history, headlines, competitors, and tuning. Model-wide facts live on Model info.
// The Advanced switch shows the longer briefing, every article with links and the full fine-tune details.
export default function Stock() {
  const router = useRouter();
  const { C, dark, toggle } = useTheme();
  const st = useStyles(makeStyles);
  // Deep links: ?settings=1 opens settings, ?advanced=1|0 sets Advanced, ?talk=1 opens Talk, ?at=briefing|sentiment|
  // headlines|tune scrolls to that card.
  const { ticker: raw, settings, advanced: advParam, talk: talkParam, at } =
    useLocalSearchParams<{ ticker: string; settings?: string; advanced?: string; talk?: string; at?: string }>();
  const scroll = useRef<ScrollView>(null);
  const [ys, setYs] = useState<Record<string, number>>({});
  const mark = (k: string) => ({ onLayout: (e: { nativeEvent: { layout: { y: number } } }) => { const y = e.nativeEvent.layout.y; setYs((m) => (m[k] === y ? m : { ...m, [k]: y })); } });
  const ticker = String(raw || "").toUpperCase();
  const [nonce, setNonce] = useState(0);
  const crypto = isCrypto(ticker); // display only: price and untagged headlines, no model output, no fine-tune
  const [active, setActive] = useState<Model>("general");
  const { advanced, setAdvanced } = useAdvanced();
  useEffect(() => { if (advParam === "1" || advParam === "0") setAdvanced(advParam === "1"); }, [advParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!at || ys[at] === undefined) return;
    const id = setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, ys[at] - 8), animated: false }), 2500);
    return () => clearTimeout(id);
  }, [at, ys[at ?? ""]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (crypto) return;
    api<{ active: Model }>(paths.specActive(ticker))
      .then((d) => setActive(d.active === "specialist" ? "specialist" : "general")).catch(() => setActive("general"));
  }, [ticker, nonce, crypto]);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  // Competitor taps open the peer on top of this page, so Back walks back through them to the list.
  const pick = (t: string) => router.push({ pathname: "/stock/[ticker]", params: { ticker: t } });

  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      <View style={st.header}>
        <Pressable onPress={back} style={st.back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={st.backText}>‹ Back</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
        {!crypto && (
          <Pressable onPress={() => setAdvanced(!advanced)} style={st.advBtn} hitSlop={6} accessibilityRole="switch"
            accessibilityState={{ checked: advanced }} accessibilityLabel="Advanced">
            <Text style={[st.advText, advanced && { color: C.amber }]}>Advanced</Text>
            <View style={[st.switch, advanced && { backgroundColor: C.amber, borderColor: C.amber }]}>
              <View style={[st.knob, advanced ? { left: 15, backgroundColor: C.ground } : { left: 2 }]} /></View>
          </Pressable>)}
        <Pressable onPress={toggle} style={st.themeBtn} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Text style={st.themeIcon}>{dark ? "☀︎" : "☾"}</Text>
        </Pressable>
        <SettingsButton current={ticker} onChanged={() => setNonce((n) => n + 1)} initiallyOpen={settings === "1"} />
        </View>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={false} tintColor={C.amber} onRefresh={() => setNonce((n) => n + 1)} />}>
        <PriceHero ticker={ticker} nonce={nonce} crypto={crypto} />
        {crypto ? <CryptoNewsCard ticker={ticker} nonce={nonce} /> : <>
        <ConfidenceBar key={`c-${active}`} ticker={ticker} model={active} nonce={nonce} />
        <View {...mark("briefing")}><BriefingCard ticker={ticker} nonce={nonce} advanced={advanced} initialTalk={talkParam === "1"} /></View>
        <View {...mark("sentiment")}><SentimentCard ticker={ticker} nonce={nonce} /></View>
        <View {...mark("headlines")}><HeadlinesCard key={`h-${active}`} ticker={ticker} model={active} nonce={nonce} advanced={advanced} /></View>
        <CompetitorsRow ticker={ticker} onPick={pick} />
        <View {...mark("tune")} />
        <FineTuneCard ticker={ticker} active={active} advanced={advanced} onActive={setActive} onTrained={() => setNonce((n) => n + 1)} />
        </>}
        <Text style={st.footer}>News sentiment, not investment advice.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: Palette) => sheet({
  screen: { flex: 1, backgroundColor: C.ground },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: C.rule },
  back: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  backText: { color: C.ink, fontSize: 16, fontWeight: "600" },
  advBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 6 },
  advText: { color: C.dim, fontSize: 13, fontWeight: "600" },
  switch: { width: 30, height: 18, borderWidth: 1, borderColor: C.rule },
  knob: { position: "absolute", top: 2, width: 12, height: 12, backgroundColor: C.dim },
  themeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  themeIcon: { color: C.ink, fontSize: 20 },
  content: { padding: 16, paddingBottom: 48 },
  footer: { color: C.dim, fontSize: 12, marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
});
