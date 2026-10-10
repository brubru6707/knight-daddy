import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { paths, type Briefing, type Headlines, type Label, type Prices } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { C, LABEL_COLOR, pct, toneColor } from "@/lib/theme";
import { reasons, toneLine, hasAdvice } from "@/lib/outlook";
import { PEERS } from "@/lib/peers";
import { Card, Status } from "./Card";
import { LineChart } from "./LineChart";

const PERIODS = [["3mo", "3M"], ["6mo", "6M"], ["1y", "1Y"], ["2y", "2Y"]] as const;

export function PriceHero({ ticker, nonce }: { ticker: string; nonce: number }) {
  const [period, setPeriod] = useState<string>("1y");
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
            <Text style={[st.change, { color: toneColor(d.change_1d) }]}>{pct(d.change_1d, 2)} today</Text>
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
          <Pressable key={p} onPress={() => setPeriod(p)} style={[st.chip, p === period && st.chipOn]} hitSlop={6}>
            <Text style={[st.chipText, p === period && { color: C.ground }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function CountRow({ counts }: { counts: Partial<Record<Label, number>> }) {
  return (
    <View style={st.countRow}>
      {(["Bullish", "Bearish", "Neutral"] as Label[]).map((l) => (
        <Text key={l} style={[st.count, { color: LABEL_COLOR[l] }]}>
          <Text style={st.countNum}>{counts[l] || 0}</Text> {l}
        </Text>
      ))}
    </View>
  );
}

export function HeadlinesCard({ ticker, nonce }: { ticker: string; nonce: number }) {
  const s = useApi<Headlines>(paths.headlines(ticker), nonce);
  const [all, setAll] = useState(false);
  const items = s.data?.items || [];
  const counts = items.reduce<Partial<Record<Label, number>>>((a, i) => {
    if (i.label) a[i.label] = (a[i.label] || 0) + 1;
    return a;
  }, {});
  const shown = all ? items : items.slice(0, 8);
  return (
    <Card title="Headlines" right={s.data?.provider ? <Text style={st.dim}>{s.data.provider}</Text> : null}>
      <Status s={s} what="headlines" />
      {s.data && (
        <>
          <CountRow counts={counts} />
          {items.length === 0 && <Text style={st.dim}>No headlines this week.</Text>}
          {shown.map((h, k) => (
            <Pressable key={k} disabled={!h.url} onPress={() => h.url && WebBrowser.openBrowserAsync(h.url)}
              style={({ pressed }) => [st.headline, { borderLeftColor: h.label ? LABEL_COLOR[h.label] : C.line }, pressed && { opacity: 0.6 }]}
              accessibilityRole="link" accessibilityLabel={`${h.label || "Untagged"}: ${h.title}`}>
              <Text style={st.headlineText} numberOfLines={3}>{h.title}</Text>
              <Text style={st.meta}>{[h.source, (h.time || "").slice(5, 16).replace("T", " ")].filter(Boolean).join(" · ")}</Text>
            </Pressable>
          ))}
          {items.length > 8 && (
            <Pressable onPress={() => setAll(!all)} hitSlop={8}>
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
  const b = s.data;
  const ok = b?.status === "ok";
  const tone = ok ? toneLine(b.counts, b.n) : "";
  const bullets = ok ? reasons(b.text) : [];
  return (
    <Card title="Outlook">
      <Status s={s} what="outlook" />
      {b && !ok && <Text style={st.dim}>{b.status === "no_key" ? "Outlook unavailable right now." : b.message || "Outlook unavailable."}</Text>}
      {ok && (
        <>
          {!hasAdvice(tone) && <Text style={st.tone}>{tone}</Text>}
          {bullets.map((r, i) => (
            <View key={i} style={st.bulletRow}>
              <Text style={st.bulletDot}>•</Text>
              <Text style={st.bullet} numberOfLines={1}>{r}</Text>
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

const st = StyleSheet.create({
  hero: { paddingVertical: 8, marginBottom: 12 },
  heroTicker: { color: C.dim, fontSize: 14, fontWeight: "700", letterSpacing: 1.5 },
  price: { color: C.ink, fontSize: 48, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 2 },
  changeRow: { flexDirection: "row", gap: 16, marginTop: 2 },
  change: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.amber, borderColor: C.amber },
  chipText: { color: C.dim, fontWeight: "700", fontSize: 12 },
  dim: { color: C.dim, fontSize: 13 },
  countRow: { flexDirection: "row", gap: 16, marginBottom: 10 },
  count: { fontSize: 14, fontWeight: "600" },
  countNum: { fontSize: 20, fontWeight: "800" },
  headline: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 7, marginBottom: 6, backgroundColor: C.ground, borderRadius: 6 },
  headlineText: { color: C.ink, fontSize: 14, lineHeight: 19 },
  meta: { color: C.dim, fontSize: 11, marginTop: 3 },
  more: { color: C.amber, fontSize: 13, fontWeight: "600", marginTop: 4 },
  tone: { color: C.ink, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 5 },
  bulletDot: { color: C.amber, fontSize: 15 },
  bullet: { color: C.ink, fontSize: 14, flex: 1 },
  footer: { color: C.dim, fontSize: 11, marginTop: 8 },
  peers: { flexDirection: "row", gap: 10 },
  peer: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.ground },
  peerText: { color: C.ink, fontSize: 18, fontWeight: "800", letterSpacing: 1 },
});
