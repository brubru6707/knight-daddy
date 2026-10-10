import { StyleSheet, Text, View } from "react-native";
import type { SpecStatus } from "@/lib/api";
import { useStyles, useTheme, type Palette } from "@/lib/theme";

const PHASES: Record<string, string> = {
  queued: "Queued, waiting for the GPU", "waiting for GPU": "Waiting for the GPU", starting: "Starting",
  "loading data": "Loading data", "loading model": "Loading model", "scoring general model": "Scoring the general model",
  training: "Training", "scoring specialist": "Scoring the specialist", saving: "Saving", done: "Fine-tune done", failed: "Fine-tune failed",
};

export type TrainState =
  | { kind: "idle" }
  | { kind: "info"; text: string; tone?: "warn" | "dim" }
  | { kind: "job"; ticker: string; status: SpecStatus | null };

export function TrainBar({ state }: { state: TrainState }) {
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  if (state.kind === "idle") return null;
  if (state.kind === "info") {
    const color = state.tone === "warn" ? C.amber : C.dim;
    return <View style={[s.box, { borderColor: color }]}><Text style={[s.text, { color }]}>{state.text}</Text></View>;
  }
  const st = state.status;
  const done = st?.phase === "done";
  const failed = st?.phase === "failed";
  const frac = done ? 1 : st?.total_steps ? (st.step || 0) / st.total_steps : 0;
  const color = failed ? C.down : C.amber;
  return (
    <View style={[s.box, { borderColor: color }]}>
      <View style={s.row}>
        <Text style={[s.text, { color }]}>{st ? PHASES[st.phase] || st.phase : "Starting"} · {state.ticker}</Text>
        {st?.total_steps ? <Text style={s.dim}>{st.step}/{st.total_steps}</Text> : null}
      </View>
      <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}>
        <View style={[s.fill, { width: `${Math.round(frac * 100)}%`, backgroundColor: color }]} />
      </View>
      {failed && st?.error ? <Text style={s.err}>{st.error}</Text> : null}
      {st?.phase === "queued" && st.note ? <Text style={s.dim}>{st.note}</Text> : null}
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  text: { fontSize: 14, fontWeight: "700" },
  dim: { color: C.dim, fontSize: 13 },
  err: { color: C.down, fontSize: 13 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.ground, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
});
