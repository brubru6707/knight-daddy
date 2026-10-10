import { createContext, useContext, useState, type ReactNode } from "react";

export type Mode = "simple" | "advanced";

interface Session {
  mode: Mode;
  setMode: (m: Mode) => void;
  // Train password: React state only. Never persisted, never logged, gone when the app closes.
  password: string | null;
  setPassword: (p: string | null) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("simple");
  const [password, setPassword] = useState<string | null>(null);
  return <Ctx.Provider value={{ mode, setMode, password, setPassword }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
