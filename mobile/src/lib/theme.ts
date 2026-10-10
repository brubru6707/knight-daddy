// Colors match the web terminal (terminal/frontend) and the KD favicon.
export const C = {
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
};

export const LABEL_COLOR: Record<string, string> = { Bullish: C.up, Bearish: C.down, Neutral: C.flat };

export const pct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
export const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
export const toneColor = (x: number) => (x > 0 ? C.up : x < 0 ? C.down : C.flat);
