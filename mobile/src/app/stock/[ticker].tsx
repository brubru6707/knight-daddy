import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsButton } from "@/components/Settings";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, paths, type Model } from "@/lib/api";
import { useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
import { BriefingCard, CompetitorsRow, ConfidenceBar, CryptoNewsCard, FineTuneCard, HeadlinesCard, PriceHero } from "@/components/detail";
import { AdvancedResearch } from "@/components/advanced";
import { isCrypto } from "@/lib/peers";

// Ticker detail: price and chart, Qwen confidence bar, Gemini briefing, fine-tune controls, headlines, competitors,
// advanced research. Back returns to the home list.
export default function Stock() {
  const router = useRouter();
  const { C, dark, toggle } = useTheme();
  const st = useStyles(makeStyles);
  const { ticker: raw, settings } = useLocalSearchParams<{ ticker: string; settings?: string }>();
  const ticker = String(raw || "").toUpperCase();
  const [nonce, setNonce] = useState(0);
  const crypto = isCrypto(ticker); // display only: price and untagged headlines, no model output, no fine-tune
  const [active, setActive] = useState<Model>("general");
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
        <View style={{ flexDirection: "row" }}>
        <Pressable onPress={toggle} style={st.themeBtn} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Text style={st.themeIcon}>{dark ? "☀︎" : "☾"}</Text>
        </Pressable>
        <SettingsButton current={ticker} onChanged={() => setNonce((n) => n + 1)} initiallyOpen={settings === "1"} />
        </View>
      </View>
      <ScrollView contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={false} tintColor={C.amber} onRefresh={() => setNonce((n) => n + 1)} />}>
        <PriceHero ticker={ticker} nonce={nonce} crypto={crypto} />
        {crypto ? <CryptoNewsCard ticker={ticker} nonce={nonce} /> : <>
        <ConfidenceBar key={`c-${active}`} ticker={ticker} model={active} nonce={nonce} />
        <BriefingCard ticker={ticker} nonce={nonce} />
        <FineTuneCard ticker={ticker} active={active} onActive={setActive} onTrained={() => setNonce((n) => n + 1)} />
        <HeadlinesCard key={`h-${active}`} ticker={ticker} model={active} nonce={nonce} />
        <CompetitorsRow ticker={ticker} onPick={pick} />
        <AdvancedResearch ticker={ticker} nonce={nonce} />
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
  themeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  themeIcon: { color: C.ink, fontSize: 20 },
  content: { padding: 16, paddingBottom: 48 },
  footer: { color: C.dim, fontSize: 12, marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
});
