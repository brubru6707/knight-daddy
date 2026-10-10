import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";

// Colors match the web terminal (terminal/frontend). Light "paper" is the default; dark is the original terminal look.
export interface Palette {
  ground: string; panel: string; line: string; ink: string; dim: string;
  amber: string; up: string; down: string; flat: string; neutral: string; blue: string; onAmber: string; rule: string;
}

export const LIGHT: Palette = {
  ground: "#f5f1e6",
  panel: "#f5f1e6",
  line: "#cfc6b1",
  ink: "#1f1d19",
  dim: "#6f6a5e",
  amber: "#9a5d0d",
  up: "#2d7a43",
  down: "#a8322b",
  flat: "#77736a",
  neutral: "#a07d00",
  blue: "#2f6fb8",
  onAmber: "#fbf9f3",
  rule: "#1f1d19",
};

export const DARK: Palette = {
  ground: "#16171a",
  panel: "#16171a",
  line: "#3a3d43",
  ink: "#e6e2d8",
  dim: "#8f9095",
  amber: "#e9a23b",
  up: "#4fb873",
  down: "#e46a63",
  flat: "#9aa3ad",
  neutral: "#d9b343",
  blue: "#3987e5",
  onAmber: "#0e1114",
  rule: "#d9d5ca",
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
// Headings use IBM Plex Serif, like the web app: put `fontFamily: SERIF` on the style and sheet() leaves it alone.
export const SERIF = "IBMPlexSerif_500Medium";
// StyleSheet.create, with fontFamily set (and fontWeight dropped) on every text style.
export function sheet<T extends StyleSheet.NamedStyles<T>>(styles: T): T {
  const out: Record<string, object> = {};
  for (const [k, v] of Object.entries(styles) as [string, Record<string, unknown>][]) {
    if ("fontFamily" in v) {
      const { fontWeight, ...rest } = v;
      out[k] = rest;
    } else if ("fontSize" in v || "fontWeight" in v) {
      const { fontWeight, ...rest } = v;
      out[k] = { ...rest, fontFamily: monoFor(fontWeight as string | number | undefined) };
    } else out[k] = v;
  }
  return StyleSheet.create(out as T);
}

export const labelColor = (C: Palette, l?: string | null) =>
  l === "Bullish" ? C.up : l === "Bearish" ? C.down : l === "Neutral" ? C.neutral : C.dim;
export const toneColor = (C: Palette, x: number) => (x > 0 ? C.up : x < 0 ? C.down : C.flat);

export const pct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
export const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
export const usd = (x: number | null | undefined) =>
  x === null || x === undefined ? "n/a" : "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
