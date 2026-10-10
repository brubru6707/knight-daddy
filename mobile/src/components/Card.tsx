import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "@/lib/theme";
import type { ApiState } from "@/lib/useApi";

interface Props {
  title: string;
  right?: ReactNode;
  summary?: ReactNode; // shown in the header when collapsed
  collapsible?: boolean;
  initiallyOpen?: boolean;
  children?: ReactNode;
}

export function Card({ title, right, summary, collapsible, initiallyOpen = true, children }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const header = (
    <View style={s.header}>
      <Text style={s.title}>{title.toUpperCase()}</Text>
      <View style={s.headerRight}>
        {!open && summary}
        {right}
        {collapsible && <Text style={s.chev}>{open ? "▾" : "▸"}</Text>}
      </View>
    </View>
  );
  return (
    <View style={s.card}>
      {collapsible ? (
        <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          {header}
        </Pressable>
      ) : header}
      {open && <View style={s.body}>{children}</View>}
    </View>
  );
}

// Loading / error line for a useApi state. 404 from the mirror = ticker not tracked: friendly, not red.
export function Status<T>({ s: st, what }: { s: ApiState<T>; what: string }) {
  if (st.loading) return <View style={s.row}><ActivityIndicator color={C.amber} size="small" /><Text style={s.dim}>  Loading {what}…</Text></View>;
  if (st.err) {
    if (st.status === 404) return <Text style={s.dim}>No {what} for this ticker yet.</Text>;
    return <Text style={s.err}>{`Couldn't load ${what}. ${st.err}`}</Text>;
  }
  return null;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 14, marginBottom: 12, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  title: { color: C.amber, fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  chev: { color: C.dim, fontSize: 16 },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  row: { flexDirection: "row", alignItems: "center" },
  dim: { color: C.dim, fontSize: 13 },
  err: { color: C.down, fontSize: 13 },
});
