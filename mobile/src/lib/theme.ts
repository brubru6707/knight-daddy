import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";

// Colors match the web terminal (terminal/frontend). Light "paper" is the default; dark is the original terminal look.
export interface Palette {
  ground: string; panel: string; line: string; ink: string; dim: string;
  amber: string; up: string; down: string; flat: string; blue: string; onAmber: string;
}

export const LIGHT: Palette = {
  ground: "#f5f1e6",
  panel: "#fbf9f3",
  line: "#d9d0bc",
  ink: "#1f1d19",
  dim: "#6f6a5e",
  amber: "#9a5d0d",
  up: "#2d7a43",
  down: "#a8322b",
  flat: "#77736a",
  blue: "#2f6fb8",
  onAmber: "#fbf9f3",
};

export const DARK: Palette = {
  ground: "#0e1114",
  panel: "#151a1f",
  line: "#232a32",
  ink: "#e6e3d8",
  dim: "#8b9099",
  amber: "#ffb000",
  up: "#3ddc84",
  down: "#ff5c5c",
  flat: "#9aa3ad",
  blue: "#3987e5",
  onAmber: "#0e1114",
};

interface Theme { C: Palette; dark: boolean; toggle: () => void }
const Ctx = createContext<Theme>({ C: LIGHT, dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false); // light by default
  const value = useMemo(() => ({ C: dark ? DARK : LIGHT, dark, toggle: () => setDark((d) => !d) }), [dark]);
  return createElement(Ctx.Provider, { value }, children);
}

export const useTheme = () => useContext(Ctx);

// Styles built from the current palette: `const st = useStyles(makeStyles)` with `makeStyles = (C) => StyleSheet.create(...)`.
export function useStyles<T>(make: (C: Palette) => T): T {
  const { C } = useTheme();
  return useMemo(() => make(C), [C, make]);
}

// IBM Plex Mono everywhere. Custom fonts ignore fontWeight on iOS, so each weight maps to its own font file.
export const MONO = { 400: "IBMPlexMono_400Regular", 500: "IBMPlexMono_500Medium", 600: "IBMPlexMono_600SemiBold", 700: "IBMPlexMono_700Bold" };
const monoFor = (w?: string | number) => {
  const n = w === "bold" ? 700 : Number(w) || 400;
  return n >= 700 ? MONO[700] : n >= 600 ? MONO[600] : n >= 500 ? MONO[500] : MONO[400];
};
// StyleSheet.create, with fontFamily set (and fontWeight dropped) on every text style.
export function sheet<T extends StyleSheet.NamedStyles<T>>(styles: T): T {
  const out: Record<string, object> = {};
  for (const [k, v] of Object.entries(styles) as [string, Record<string, unknown>][]) {
    if ("fontSize" in v || "fontWeight" in v) {
      const { fontWeight, ...rest } = v;
      out[k] = { ...rest, fontFamily: monoFor(fontWeight as string | number | undefined) };
    } else out[k] = v;
  }
  return StyleSheet.create(out as T);
}

export const labelColor = (C: Palette, l?: string | null) =>
  l === "Bullish" ? C.up : l === "Bearish" ? C.down : l === "Neutral" ? C.flat : C.line;
export const toneColor = (C: Palette, x: number) => (x > 0 ? C.up : x < 0 ? C.down : C.flat);

export const pct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
export const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");

// "16h ago" style time for headline rows.
export function relTime(iso?: string | null) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
