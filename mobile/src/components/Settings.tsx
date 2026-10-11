import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { api, ApiError, paths, resetModel } from "@/lib/api";
import { useSession } from "@/lib/session";
import { HOME, isCrypto } from "@/lib/peers";
import { SERIF, useStyles, useTheme, type Palette, sheet } from "@/lib/theme";

// Settings (gear in the header): active model per stock, reset to the general model (this stock or all stocks), and
// the saved train password (change or forget). Resets use the password-protected /api/specialist/reset.
export function SettingsButton({ current, onChanged, initiallyOpen = false }: { current?: string | null; onChanged?: () => void; initiallyOpen?: boolean }) {
  const { C } = useTheme();
  const st = useStyles(makeStyles);
  const { password, setPassword } = useSession();
  const [open, setOpen] = useState(initiallyOpen); // deep link: knightdaddy:///stock/NVDA?settings=1
  const [active, setActive] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [askFor, setAskFor] = useState<string | null>(null);
  const [editPw, setEditPw] = useState(false);
  const stock = current && !isCrypto(current) && HOME.includes(current) ? current : null;

  const load = () => Promise.all(HOME.map((t) => api<{ active: string }>(paths.specActive(t)).then((d) => [t, d.active] as const).catch(() => [t, null] as const)))
    .then((rows) => setActive(Object.fromEntries(rows)));
  useEffect(() => { if (open) { load(); setMsg(null); setAskFor(null); setEditPw(false); setTyped(""); } }, [open]);

  const reset = async (target: string, pw = password) => {
    if (!pw) { setAskFor(target); return; }
    setBusy(target); setMsg(null);
    try {
      for (const t of target === "all" ? HOME : [target]) await resetModel(t, pw);
      if (pw !== password) setPassword(pw);
      setAskFor(null); setTyped("");
      setMsg(target === "all" ? "All stocks now use the general model." : `${target} now uses the general model.`);
      await load(); onChanged?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setPassword(null); setAskFor(target); setMsg("Wrong train password. Enter it again."); }
      else setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };
  const label = (t: string) => (active[t] === "specialist" ? `${t} specialist` : active[t] === "general" ? "general" : "n/a");

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={st.gearBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Settings">
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth={1.7}>
          <Circle cx={12} cy={12} r={3.2} />
          <Path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" strokeLinecap="round" />
        </Svg>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={st.bg}>
          <View style={st.sheet}>
            <View style={st.head}>
              <Text style={st.h2}>Settings</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityRole="button"><Text style={st.link}>Done</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
              <Text style={st.label}>ACTIVE MODEL</Text>
              {HOME.map((t) => (
                <View key={t} style={st.row}>
                  <Text style={[st.rowT, t === stock && { color: C.ink }]}>{t}</Text>
                  <Text style={[st.rowV, t === stock && { color: C.ink }]}>{label(t)}</Text>
                </View>))}
              {stock && (
                <Pressable onPress={() => reset(stock)} disabled={!!busy} style={[st.btn, { marginTop: 16 }]} accessibilityRole="button">
                  {busy === stock ? <ActivityIndicator color={C.ink} /> : <Text style={st.btnT}>Reset {stock} to general model</Text>}
                </Pressable>)}
              <Pressable onPress={() => reset("all")} disabled={!!busy} style={[st.btn, { marginTop: stock ? 10 : 16 }]} accessibilityRole="button">
                {busy === "all" ? <ActivityIndicator color={C.ink} /> : <Text style={st.btnT}>Reset all stocks to general model</Text>}
              </Pressable>
              {askFor && (
                <View style={st.inline}>
                  <TextInput value={typed} onChangeText={setTyped} secureTextEntry autoFocus autoCapitalize="none" autoCorrect={false}
                    placeholder="Train password" placeholderTextColor={C.dim} style={st.input} onSubmitEditing={() => typed && reset(askFor, typed)}
                    textContentType="none" autoComplete="off" />
                  <Pressable onPress={() => typed && reset(askFor, typed)} style={[st.small, !typed && { opacity: 0.4 }]}><Text style={st.smallT}>Reset</Text></Pressable>
                </View>)}
              <Text style={[st.label, { marginTop: 26 }]}>TRAIN PASSWORD</Text>
              <Text style={st.dim}>{password ? "Saved on this device. Used for fine-tunes and resets." : "Not saved. You will be asked the first time you need it."}</Text>
              {editPw ? (
                <View style={st.inline}>
                  <TextInput value={typed} onChangeText={setTyped} secureTextEntry autoFocus autoCapitalize="none" autoCorrect={false}
                    placeholder="New train password" placeholderTextColor={C.dim} style={st.input} textContentType="none" autoComplete="off" />
                  <Pressable onPress={() => { if (typed) { setPassword(typed); setTyped(""); setEditPw(false); setMsg("Train password saved. It is checked the next time you use it."); } }}
                    style={[st.small, !typed && { opacity: 0.4 }]}><Text style={st.smallT}>Save</Text></Pressable>
                </View>
              ) : (
                <View style={st.links}>
                  <Pressable onPress={() => { setEditPw(true); setAskFor(null); setTyped(""); }} hitSlop={8}><Text style={st.link}>Change train password</Text></Pressable>
                  {password ? <Pressable onPress={() => { setPassword(null); setMsg("Train password forgotten on this device."); }} hitSlop={8}><Text style={st.link}>Forget password</Text></Pressable> : null}
                </View>
              )}
              {msg && <Text style={[st.dim, { color: C.ink, marginTop: 14 }]}>{msg}</Text>}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const makeStyles = (C: Palette) => sheet({
  gearBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.ground, maxHeight: "85%", borderTopWidth: 1, borderColor: C.rule },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  h2: { color: C.ink, fontSize: 22, fontFamily: SERIF },
  label: { color: C.dim, fontSize: 11, letterSpacing: 1.4, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  rowT: { color: C.dim, fontSize: 15, fontWeight: "700" },
  rowV: { color: C.dim, fontSize: 15 },
  btn: { borderWidth: 1, borderColor: C.rule, minHeight: 48, justifyContent: "center", paddingHorizontal: 14 },
  btnT: { color: C.ink, fontSize: 15, fontWeight: "600" },
  inline: { flexDirection: "row", gap: 8, marginTop: 10 },
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: C.line, color: C.ink, fontSize: 16, paddingHorizontal: 12, minHeight: 46 },
  small: { backgroundColor: C.ink, paddingHorizontal: 16, justifyContent: "center", minHeight: 46 },
  smallT: { color: C.ground, fontSize: 15, fontWeight: "700" },
  dim: { color: C.dim, fontSize: 14, lineHeight: 20 },
  links: { flexDirection: "row", gap: 20, marginTop: 10, flexWrap: "wrap" },
  link: { color: C.amber, fontSize: 15, fontWeight: "600" },
});
