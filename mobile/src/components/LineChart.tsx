import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { C } from "@/lib/theme";

export interface Series { values: number[]; color: string; width?: number; dashed?: boolean }

interface Props {
  series: Series[];
  height?: number;
  baseline?: number; // draws a dotted horizontal line at this value
}

// Minimal responsive line chart: shared y-range across series, no axes, built for glancing.
export function LineChart({ series, height = 180, baseline }: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (baseline !== undefined) all.push(baseline);
  const min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.06 || 1;
  const lo = min - pad, hi = max + pad;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const path = (vals: number[]) => {
    const n = Math.max(1, vals.length - 1);
    return vals.map((v, i) => `${i ? "L" : "M"}${((i / n) * w).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  };
  return (
    <View onLayout={onLayout} style={{ height }}>
      {w > 0 && all.length > 1 && (
        <Svg width={w} height={height}>
          {baseline !== undefined && (
            <Line x1={0} x2={w} y1={y(baseline)} y2={y(baseline)} stroke={C.dim} strokeDasharray="3 5" strokeWidth={1} />
          )}
          {series.map((s, i) => (
            <Path key={i} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2}
              strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </Svg>
      )}
    </View>
  );
}
