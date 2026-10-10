import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SERIF, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";
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
  const s = useStyles(makeStyles);
  const header = (
    <View style={s.header}>
      <Text style={s.title}>{title}</Text>
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
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  if (st.loading) return <View style={s.row}><ActivityIndicator color={C.amber} size="small" /><Text style={s.dim}>  Loading {what}…</Text></View>;
  if (st.err) {
    if (st.status === 404) return <Text style={s.dim}>No {what} for this ticker yet.</Text>;
    return <Text style={s.err} numberOfLines={2}>{`Couldn't load ${what} right now. Pull down to retry.`}</Text>;
  }
  return null;
}

const makeStyles = (C: Palette) => sheet({
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, marginBottom: 14, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, minHeight: 48 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  title: { color: C.ink, fontSize: 18, fontFamily: SERIF },
  chev: { color: C.dim, fontSize: 18 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { flexDirection: "row", alignItems: "center" },
  dim: { color: C.dim, fontSize: 14 },
  err: { color: C.down, fontSize: 14 },
});
