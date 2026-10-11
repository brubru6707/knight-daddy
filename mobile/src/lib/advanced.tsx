import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Advanced mode (switch on the stock screen): longer briefing, every article with links, full fine-tune details.
// Saved on the device only.
const KEY = "kd.advanced";
const Ctx = createContext<{ advanced: boolean; setAdvanced: (v: boolean) => void }>({ advanced: false, setAdvanced: () => {} });

export function AdvancedProvider({ children }: { children: ReactNode }) {
  const [advanced, set] = useState(false);
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => set(v === "1")).catch(() => {}); }, []);
  const setAdvanced = (v: boolean) => { set(v); AsyncStorage.setItem(KEY, v ? "1" : "0").catch(() => {}); };
  return <Ctx.Provider value={{ advanced, setAdvanced }}>{children}</Ctx.Provider>;
}

export const useAdvanced = () => useContext(Ctx);
