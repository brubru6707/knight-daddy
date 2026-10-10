import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { paths, type Briefing, type Headlines, type Label, type Prices } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { labelColor, pct, relTime, toneColor, useStyles, useTheme, type Palette } from "@/lib/theme";
import { reasons, toneLine, hasAdvice } from "@/lib/outlook";
import { PEERS } from "@/lib/peers";
import { Card, Status } from "./Card";
import { LineChart } from "./LineChart";

const PERIODS = [["3mo", "3M"], ["6mo", "6M"], ["1y", "1Y"], ["2y", "2Y"]] as const;

export function PriceHero({ ticker, nonce }: { ticker: string; nonce: number }) {
  const [period, setPeriod] = useState<string>("1y");
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const s = useApi<Prices>(paths.prices(ticker, period), nonce);
  const d = s.data;
  const color = d && d.change_period >= 0 ? C.up : C.down;
  return (
    <View style={st.hero}>
      <Text style={st.heroTicker}>{ticker}</Text>
      {d ? (
        <>
          <Text style={st.price}>${d.last.toFixed(2)}</Text>
          <View style={st.changeRow}>
            <Text style={[st.change, { color: toneColor(C, d.change_1d) }]}>{pct(d.change_1d, 2)} today</Text>
            <Text style={[st.change, { color }]}>{pct(d.change_period)} {period.toUpperCase()}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <LineChart series={[{ values: d.bars.map((b) => b.close), color, width: 2.5 }]} height={190} />
          </View>
        </>
      ) : (
        <View style={{ minHeight: 60, justifyContent: "center" }}><Status s={s} what="prices" /></View>
      )}
      <View style={st.chips}>
        {PERIODS.map(([p, label]) => (
          <Pressable key={p} onPress={() => setPeriod(p)} style={[st.chip, p === period && st.chipOn]} hitSlop={4}
            accessibilityRole="button" accessibilityState={{ selected: p === period }}>
            <Text style={[st.chipText, p === period && { color: C.onAmber }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function CountRow({ counts }: { counts: Partial<Record<Label, number>> }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  return (
    <View style={st.countRow}>
      {(["Bullish", "Bearish", "Neutral"] as Label[]).map((l) => (
        <Text key={l} style={[st.count, { color: labelColor(C, l) }]}>
          <Text style={st.countNum}>{counts[l] || 0}</Text> {l}
        </Text>
      ))}
    </View>
  );
}

export function HeadlinesCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const s = useApi<Headlines>(paths.headlines(ticker), nonce);
  const [all, setAll] = useState(false);
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const items = s.data?.items || [];
  const counts = items.reduce<Partial<Record<Label, number>>>((a, i) => {
    if (i.label) a[i.label] = (a[i.label] || 0) + 1;
    return a;
  }, {});
  const shown = all ? items : items.slice(0, 5);
  return (
    <Card title="Headlines" right={s.data?.provider ? <Text style={st.dim}>{s.data.provider}</Text> : null}>
      <Status s={s} what="headlines" />
      {s.data && (
        <>
          <CountRow counts={counts} />
          {items.length === 0 && <Text style={st.dim}>No headlines this week.</Text>}
          {shown.map((h, k) => (
            <Pressable key={k} disabled={!h.url} onPress={() => h.url && WebBrowser.openBrowserAsync(h.url)}
              style={({ pressed }) => [st.headline, { borderLeftColor: labelColor(C, h.label) }, pressed && { opacity: 0.6 }]}
              accessibilityRole="link" accessibilityLabel={`${h.label || "Untagged"}: ${h.title}`}>
              <Text style={st.headlineText} numberOfLines={3}>{h.title}</Text>
              <Text style={st.meta}>{[h.label, h.source, relTime(h.time)].filter(Boolean).join(" · ")}</Text>
            </Pressable>
          ))}
          {items.length > 5 && (
            <Pressable onPress={() => setAll(!all)} style={st.moreBtn} accessibilityRole="button">
              <Text style={st.more}>{all ? "Show less" : `Show all ${items.length}`}</Text>
            </Pressable>
          )}
        </>
      )}
    </Card>
  );
}

export function OutlookCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const s = useApi<Briefing>(paths.briefing(ticker), nonce);
  const st = useStyles(makeStyles);
  const b = s.data;
  const ok = b?.status === "ok";
  const tone = ok ? toneLine(b.counts, b.n) : "";
  const bullets = ok ? reasons(b.text) : [];
  return (
    <Card title="Outlook">
      {s.loading && <Status s={s} what="outlook" />}
      {s.err && <Text style={st.dim}>Outlook unavailable right now. The AI summary is paused; pull down to retry later.</Text>}
      {b && !ok && <Text style={st.dim}>{b.status === "no_key" ? "Outlook unavailable right now." : b.message || "Outlook unavailable."}</Text>}
      {ok && (
        <>
          {!hasAdvice(tone) && <Text style={st.tone}>{tone}</Text>}
          {bullets.map((r, i) => (
            <View key={i} style={st.bulletRow}>
              <Text style={st.bulletDot}>•</Text>
              <Text style={st.bullet}>{r}</Text>
            </View>
          ))}
          <Text style={st.footer}>News summary, not financial advice.</Text>
        </>
      )}
    </Card>
  );
}

export function CompetitorsCard({ ticker, onPick }: { ticker: string; onPick: (t: string) => void }) {
  const peers = PEERS[ticker];
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  return (
    <Card title="Competitors">
      {peers ? (
        <View style={st.peers}>
          {peers.map((p) => (
            <Pressable key={p} onPress={() => onPick(p)} style={({ pressed }) => [st.peer, pressed && { borderColor: C.amber }]}
              accessibilityRole="button" accessibilityLabel={`Load ${p}`}>
              <Text style={st.peerText}>{p}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={st.dim}>No competitor list for {ticker} yet.</Text>
      )}
    </Card>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  hero: { paddingVertical: 8, marginBottom: 12 },
  heroTicker: { color: C.dim, fontSize: 15, fontWeight: "700", letterSpacing: 1.5 },
  price: { color: C.ink, fontSize: 48, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 2 },
  changeRow: { flexDirection: "row", gap: 16, marginTop: 2 },
  change: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", gap: 8, marginTop: 12 },
  chip: { flex: 1, alignItems: "center", paddingVertical: 10, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.amber, borderColor: C.amber },
  chipText: { color: C.dim, fontWeight: "700", fontSize: 14 },
  dim: { color: C.dim, fontSize: 14, lineHeight: 20 },
  countRow: { flexDirection: "row", gap: 16, marginBottom: 10 },
  count: { fontSize: 14, fontWeight: "600" },
  countNum: { fontSize: 20, fontWeight: "800" },
  headline: { borderLeftWidth: 4, paddingLeft: 12, paddingRight: 8, paddingVertical: 10, marginBottom: 8, backgroundColor: C.ground, borderRadius: 6 },
  headlineText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  meta: { color: C.dim, fontSize: 12, marginTop: 4 },
  more: { color: C.amber, fontSize: 15, fontWeight: "700" },
  moreBtn: { paddingVertical: 12, alignItems: "center" },
  tone: { color: C.ink, fontSize: 17, fontWeight: "700", marginBottom: 10 },
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  bulletDot: { color: C.amber, fontSize: 15 },
  bullet: { color: C.ink, fontSize: 15, lineHeight: 21, flex: 1 },
  footer: { color: C.dim, fontSize: 12, marginTop: 8 },
  peers: { flexDirection: "row", gap: 10 },
  peer: { flex: 1, alignItems: "center", paddingVertical: 16, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.ground },
  peerText: { color: C.ink, fontSize: 18, fontWeight: "800", letterSpacing: 1 },
});
