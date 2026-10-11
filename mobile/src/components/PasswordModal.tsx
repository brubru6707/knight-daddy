import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useStyles, useTheme, type Palette, sheet } from "@/lib/theme";

interface Props { visible: boolean; error?: string | null; onSubmit: (pw: string) => void; onCancel: () => void }

// Asked once; the caller saves an accepted password in the keychain (see lib/session.tsx).
export function PasswordModal({ visible, error, onSubmit, onCancel }: Props) {
  const [pw, setPw] = useState("");
  const { C } = useTheme();
  const s = useStyles(makeStyles);
  const submit = () => { if (pw) { onSubmit(pw); setPw(""); } };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.backdrop}>
        <View style={s.box}>
          <Text style={s.title}>Train password</Text>
          <Text style={s.dim}>Needed to fine-tune or switch models. Asked once, then saved securely on this device.</Text>
          <TextInput value={pw} onChangeText={setPw} secureTextEntry autoFocus autoCapitalize="none" autoCorrect={false}
            placeholder="password" placeholderTextColor={C.dim} style={s.input} onSubmitEditing={submit}
            textContentType="none" autoComplete="off" />
          {error ? <Text style={s.err}>{error}</Text> : null}
          <View style={s.row}>
            <Pressable onPress={() => { setPw(""); onCancel(); }} style={[s.btn, s.ghost]}><Text style={s.dimBtn}>Skip</Text></Pressable>
            <Pressable onPress={submit} style={[s.btn, s.primary, !pw && { opacity: 0.4 }]} disabled={!pw}>
              <Text style={s.primaryText}>Start</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (C: Palette) => sheet({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 24 },
  box: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, padding: 20, gap: 12 },
  title: { color: C.ink, fontSize: 18, fontWeight: "700" },
  dim: { color: C.dim, fontSize: 13 },
  err: { color: C.down, fontSize: 13 },
  input: { borderWidth: 1, borderColor: C.line, color: C.ink, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.ground },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  btn: { paddingHorizontal: 18, paddingVertical: 12, minHeight: 44, justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: C.line },
  primary: { backgroundColor: C.amber },
  dimBtn: { color: C.dim, fontWeight: "600" },
  primaryText: { color: C.onAmber, fontWeight: "700" },
});
