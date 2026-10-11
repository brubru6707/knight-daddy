import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SUPPORTED } from "./peers";

// "Your list": tickers the user chose at onboarding, saved on the device only. It organizes their own choices.
interface ListState { ready: boolean; onboarded: boolean; list: string[]; save: (l: string[]) => void }
const Ctx = createContext<ListState>({ ready: false, onboarded: false, list: [], save: () => {} });
const KEY = "kd.list.v1";

export function ListProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ ready: false, onboarded: false, list: [] as string[] });
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      const j = v ? JSON.parse(v) : null;
      setState({ ready: true, onboarded: !!j, list: Array.isArray(j?.list) ? j.list.filter((t: string) => SUPPORTED.includes(t)) : [] });
    }).catch(() => setState({ ready: true, onboarded: false, list: [] }));
  }, []);
  const save = (list: string[]) => {
    setState({ ready: true, onboarded: true, list });
    AsyncStorage.setItem(KEY, JSON.stringify({ list })).catch(() => {});
  };
  return <Ctx.Provider value={{ ...state, save }}>{children}</Ctx.Provider>;
}

export const useList = () => useContext(Ctx);
