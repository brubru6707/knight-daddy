import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { paths, type Health } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useAdvanced } from "@/lib/advanced";
import { HOME } from "@/lib/peers";
import { SERIF, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
import { BacktestCard, BenchmarkCard } from "@/components/advanced";

// Model info: facts about the sentiment model itself, not about any one stock. Ours vs. FinBERT, the full benchmark
// table, and the historical backtest of the signal (pick a stock with cached history). Only in Advanced mode.
export default function ModelInfo() {
  const router = useRouter();
  const { dark, toggle } = useTheme();
  const st = useStyles(makeStyles);
  const h = useApi<Health>(paths.health());
  const hist = h.data?.historical_tickers || (h.loading ? [] : HOME);
  const [pick, setPick] = useState<string | null>(null);
  const t = pick || hist[0];
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const { advanced } = useAdvanced();
  const [checked, setChecked] = useState(false); // the saved Advanced setting loads a moment after launch
  useEffect(() => { const id = setTimeout(() => setChecked(true), 400); return () => clearTimeout(id); }, []);
  useEffect(() => { if (checked && !advanced) router.replace("/"); }, [checked, advanced]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!advanced) return <View style={st.screen} />;
  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      <View style={st.header}>
        <Pressable onPress={back} style={st.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={st.backText}>‹ Back</Text>
        </Pressable>
        <Pressable onPress={toggle} style={st.themeBtn} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Text style={st.themeIcon}>{dark ? "☀︎" : "☾"}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={st.h1}>Model info</Text>
        <Text style={st.sub}>How the headline tagger was built and how it scores. The same model tags every stock.</Text>
        <BenchmarkCard nonce={0} />
        <View style={st.chips}>
          {hist.map((x) => (
            <Pressable key={x} onPress={() => setPick(x)} style={[st.chip, x === t && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: x === t }}>
              <Text style={[st.chipT, x === t && st.chipTOn]}>{x}</Text>
            </Pressable>))}
        </View>
        {t ? <BacktestCard key={t} ticker={t} nonce={0} /> : null}
        <Text style={st.footer}>News sentiment, not investment advice.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C: Palette) => sheet({
  screen: { flex: 1, backgroundColor: C.ground },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: C.rule },
  backBtn: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  backText: { color: C.ink, fontSize: 16, fontWeight: "600" },
  themeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  themeIcon: { color: C.ink, fontSize: 20 },
  content: { padding: 16, paddingBottom: 48 },
  h1: { color: C.ink, fontSize: 30, fontFamily: SERIF },
  sub: { color: C.dim, fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { color: C.ink, fontSize: 13, fontWeight: "700" },
  chipTOn: { color: C.ground },
  footer: { color: C.dim, fontSize: 12, marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
});
