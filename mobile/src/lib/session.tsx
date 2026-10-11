import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

// Train password: asked once, then kept in the iOS keychain (expo-secure-store) and reused silently. Cleared when the
// server rejects it (401) or the user picks "Forget password" in settings. Never written to the repo or the bundle.
const KEY = "kd.trainpw";

interface Session {
  password: string | null;
  setPassword: (p: string | null) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [password, setPw] = useState<string | null>(null);
  useEffect(() => { SecureStore.getItemAsync(KEY).then((v) => v && setPw(v)).catch(() => {}); }, []);
  const setPassword = (p: string | null) => {
    setPw(p);
    (p ? SecureStore.setItemAsync(KEY, p) : SecureStore.deleteItemAsync(KEY)).catch(() => {});
  };
  return <Ctx.Provider value={{ password, setPassword }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
