import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsButton } from "@/components/Settings";
import { useRouter } from "expo-router";
import { paths, type Replay as ReplayData, type ReplayAvailable } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { NAMES } from "@/lib/peers";
import { labelColor, pct, SERIF, toneColor, usd, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
import { Card, Status } from "@/components/Card";
import { ProbBar } from "@/components/detail";

const day = (d: string, long = true) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US",
  long ? { weekday: "short", month: "short", day: "numeric", year: "numeric" } : { month: "long", year: "numeric" });

// Replay: pick a (ticker, date) pair Oscar published, then show what /api/replay recomputed for it. Always labeled as
// a historical replay, never as live data.
export default function Replay() {
  const router = useRouter();
  const { C, dark, toggle } = useTheme();
  const st = useStyles(makeStyles);
  const av = useApi<ReplayAvailable>(paths.replayAvailable());
  const pairs = useMemo(() => av.data?.pairs || [], [av.data]);
  const tickers = [...new Set(pairs.map((p) => p.ticker))];
  const [pick, setPick] = useState<{ t: string | null; d: string | null }>({ t: null, d: null });
  const [picker, setPicker] = useState(false);
  const t = pick.t && tickers.includes(pick.t) ? pick.t : tickers[0] || null;
  const dates = pairs.filter((p) => p.ticker === t);
  const d = pick.d && dates.some((p) => p.date === pick.d) ? pick.d : null;
  const byMonth = dates.reduce<Record<string, typeof dates>>((m, p) => ((m[p.date.slice(0, 7)] ||= []).push(p), m), {});
  const r = useApi<ReplayData>(t && d ? paths.replay(t, d) : null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      <View style={st.header}>
        <Pressable onPress={back} style={st.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={st.backText}>‹ Back</Text>
        </Pressable>
        <View style={{ flexDirection: "row" }}>
        <Pressable onPress={toggle} style={st.themeBtn} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <Text style={st.themeIcon}>{dark ? "☀︎" : "☾"}</Text>
        </Pressable>
        <SettingsButton current={null} />
        </View>
      </View>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={st.h1}>Replay</Text>
        <Text style={st.sub}>{"Pick a past day. The general model re-reads that day's headlines on Oscar and shows what it would have said then. Historical data, not live."}</Text>
        {av.loading && <View style={{ marginTop: 16 }}><Status s={av} what="replay dates" /></View>}
        {!av.loading && !pairs.length && <Text style={[st.dim, { marginTop: 16 }]}>Replay: n/a (no replay days published yet).</Text>}
        {pairs.length > 0 && (
          <View style={st.pickers}>
            <Text style={st.label}>STOCK</Text>
            <View style={st.chips}>
              {tickers.map((x) => (
                <Pressable key={x} onPress={() => setPick({ t: x, d: null })} style={[st.chip, x === t && st.chipOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: x === t }}>
                  <Text style={[st.chipText, x === t && { color: C.ink }]}>{x}</Text>
                </Pressable>))}
            </View>
            <Text style={[st.label, { marginTop: 14 }]}>DATE ({dates.length} DAYS WITH DATA)</Text>
            <Pressable onPress={() => setPicker(true)} style={st.dateBtn} accessibilityRole="button">
              <Text style={st.dateText}>{d ? day(d) : "Choose a date"}</Text><Text style={st.dim}>⌄</Text>
            </Pressable>
          </View>
        )}
        {t && d && (
          <>
            <View style={st.banner}><Text style={st.bannerText}>Replay - {day(d)}</Text></View>
            {r.loading && <Status s={r} what="replay" />}
            {r.err && <Text style={st.dim}>Replay: n/a for {t} on {day(d)}.</Text>}
            {r.data && (
              <>
                <Text style={st.name}>{NAMES[t] || t}</Text>
                <Text style={st.tick}>{t} · CLOSE THAT DAY</Text>
                <Text style={st.price}>{usd(r.data.price?.close)}</Text>
                <Text style={[st.change, { color: typeof r.data.price?.change_1d === "number" ? toneColor(C, r.data.price.change_1d) : C.dim }]}>
                  {pct(r.data.price?.change_1d, 2)} <Text style={st.dim}>vs the previous close</Text></Text>
                <Card title="Model confidence that day" right={<Text style={st.small}>Qwen, general</Text>}>
                  <ProbBar d={r.data} />
                </Card>
                <Card title="Headlines that day">
                  {r.data.items.map((h, k) => (
                    <View key={k} style={[st.headline, k === 0 && { borderTopWidth: 0 }]}>
                      <View style={[st.tag, { borderColor: labelColor(C, h.label) }]}>
                        <Text style={[st.tagText, { color: labelColor(C, h.label) }]}>{h.label || "n/a"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.headlineText}>{h.title}</Text>
                        <Text style={st.small}>{[h.source, h.time?.slice(11, 16)].filter(Boolean).join(" · ")}</Text>
                      </View>
                    </View>))}
                  <Text style={st.small}>Headlines from the FNSPID dataset, re-tagged by the general Qwen model. A replay of {day(d)}, not live data.</Text>
                </Card>
              </>
            )}
          </>
        )}
        <Text style={st.footer}>News sentiment, not investment advice.</Text>
      </ScrollView>
      <Modal visible={picker} animationType="slide" transparent onRequestClose={() => setPicker(false)}>
        <View style={st.modalBg}>
          <View style={st.sheet}>
            <View style={st.sheetHead}>
              <Text style={st.h2}>Choose a date</Text>
              <Pressable onPress={() => setPicker(false)} hitSlop={8}><Text style={st.link}>Close</Text></Pressable>
            </View>
            <ScrollView>
              {Object.entries(byMonth).map(([m, ps]) => (
                <View key={m}>
                  <Text style={st.month}>{day(`${m}-15`, false)}</Text>
                  {ps.map((p) => (
                    <Pressable key={p.date} onPress={() => { setPick({ t, d: p.date }); setPicker(false); }}
                      style={({ pressed }) => [st.dateRow, (pressed || p.date === d) && { backgroundColor: C.line }]}>
                      <Text style={st.dateText}>{day(p.date)}</Text><Text style={st.dim}>{p.n} headlines</Text>
                    </Pressable>))}
                </View>))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  h1: { color: C.ink, fontSize: 32, fontFamily: SERIF, marginTop: 4 },
  h2: { color: C.ink, fontSize: 20, fontFamily: SERIF },
  sub: { color: C.dim, fontSize: 13, lineHeight: 19, marginTop: 6 },
  dim: { color: C.dim, fontSize: 14 },
  small: { color: C.dim, fontSize: 12, lineHeight: 17, marginTop: 6 },
  label: { color: C.dim, fontSize: 11, letterSpacing: 1.4 },
  pickers: { borderWidth: 1, borderColor: C.line, padding: 14, marginTop: 18 },
  chips: { flexDirection: "row", gap: 8, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  chipOn: { borderColor: C.rule },
  chipText: { color: C.dim, fontSize: 15, fontWeight: "600" },
  dateBtn: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, minHeight: 46, marginTop: 6 },
  dateText: { color: C.ink, fontSize: 15 },
  banner: { borderWidth: 1, borderColor: C.amber, paddingHorizontal: 14, paddingVertical: 10, marginTop: 20, marginBottom: 14 },
  bannerText: { color: C.amber, fontSize: 15, fontWeight: "700" },
  name: { color: C.ink, fontSize: 24, fontFamily: SERIF },
  tick: { color: C.dim, fontSize: 11, letterSpacing: 1.4, marginTop: 2 },
  price: { color: C.ink, fontSize: 40, fontWeight: "700", marginTop: 8, fontVariant: ["tabular-nums"] },
  change: { fontSize: 14, fontWeight: "600", marginBottom: 14 },
  headline: { flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  tag: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start", minWidth: 74, alignItems: "center" },
  tagText: { fontSize: 11, fontWeight: "600" },
  headlineText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  footer: { color: C.dim, fontSize: 12, marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.ground, maxHeight: "75%", borderTopWidth: 1, borderColor: C.rule, paddingBottom: 24 },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  link: { color: C.amber, fontSize: 15, fontWeight: "600" },
  month: { color: C.dim, fontSize: 12, letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  dateRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, minHeight: 48, alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.line },
});
