import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CATEGORIES, NAMES, short } from "@/lib/peers";
import { SERIF, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";

// First open: the user taps the names or groups they want to follow. It only organizes their own choices (saved on
// this device); nothing is suggested or ranked. Skip goes straight to the full list.
export function Onboarding({ initial, onDone, onSkip }: { initial: string[]; onDone: (l: string[]) => void; onSkip: () => void }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const [sel, setSel] = useState<string[]>(initial);
  const toggle = (t: string) => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const toggleGroup = (ts: string[]) => setSel((s) => (ts.every((t) => s.includes(t)) ? s.filter((t) => !ts.includes(t)) : [...new Set([...s, ...ts])]));
  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={st.h1}>What do you want to follow?</Text>
        <Text style={st.sub}>Tap names or whole groups. They go in &quot;Your list&quot; at the top of home. This only arranges your screen; it is not a suggestion.</Text>
        {CATEGORIES.map((g) => {
          const all = g.tickers.every((t) => sel.includes(t));
          return (
            <View key={g.name} style={{ marginTop: 22 }}>
              <Pressable onPress={() => toggleGroup(g.tickers)} style={st.groupBtn} accessibilityRole="checkbox" accessibilityState={{ checked: all }} hitSlop={6}>
                <View style={[st.box, all && { backgroundColor: C.ink, borderColor: C.ink }]} />
                <Text style={[st.group, all && { color: C.ink }]}>{g.name.toUpperCase()}</Text>
              </Pressable>
              <View style={st.chips}>
                {g.tickers.map((t) => {
                  const on = sel.includes(t);
                  return (
                    <Pressable key={t} onPress={() => toggle(t)} style={[st.chip, on && st.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <Text style={[st.chipT, on && { color: C.ground }]}>{short(t)}</Text>
                      <Text style={[st.chipN, on && { color: C.ground }]} numberOfLines={1}>{NAMES[t]}</Text>
                    </Pressable>);
                })}
              </View>
            </View>);
        })}
        <Text style={st.footer}>News sentiment, not investment advice.</Text>
      </ScrollView>
      <View style={st.bar}>
        <Pressable onPress={() => onDone(sel)} disabled={!sel.length} style={[st.done, !sel.length && { opacity: 0.4 }]} accessibilityRole="button">
          <Text style={st.doneT}>{sel.length ? `Save my list (${sel.length})` : "Save my list"}</Text>
        </Pressable>
        <Pressable onPress={onSkip} style={st.skip} accessibilityRole="button"><Text style={st.skipT}>Skip</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (C: Palette) => sheet({
  screen: { flex: 1, backgroundColor: C.ground },
  content: { padding: 20, paddingBottom: 32 },
  h1: { color: C.ink, fontSize: 30, fontFamily: SERIF, lineHeight: 36, marginTop: 12 },
  sub: { color: C.dim, fontSize: 14, lineHeight: 20, marginTop: 10 },
  groupBtn: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  box: { width: 14, height: 14, borderWidth: 1, borderColor: C.rule },
  group: { color: C.dim, fontSize: 12, letterSpacing: 1.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56, maxWidth: "100%" },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipT: { color: C.ink, fontSize: 16, fontWeight: "700" },
  chipN: { color: C.dim, fontSize: 12, marginTop: 2 },
  footer: { color: C.dim, fontSize: 12, marginTop: 28 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.rule, backgroundColor: C.ground },
  done: { flex: 1, backgroundColor: C.ink, minHeight: 50, alignItems: "center", justifyContent: "center" },
  doneT: { color: C.ground, fontSize: 16, fontWeight: "700" },
  skip: { minHeight: 50, paddingHorizontal: 16, justifyContent: "center" },
  skipT: { color: C.dim, fontSize: 16 },
});
