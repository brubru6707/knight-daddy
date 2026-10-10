import { useEffect, useRef } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";

// Categorical series colors (dark-surface steps of the validated default palette, fixed order).
export const SERIES = {
  Sentiment: "#3987e5",
  "Buy and hold": "#d95926",
  "Random (mean of 100)": "#199e70",
  Cash: "#8b9099",
};

const BASE = {
  layout: { background: { color: "#0e1114" }, textColor: "#8b9099", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
  grid: { vertLines: { color: "#161b21" }, horzLines: { color: "#161b21" } },
  rightPriceScale: { borderColor: "#222830" },
  timeScale: { borderColor: "#222830" },
  crosshair: { mode: CrosshairMode.Normal },
  autoSize: true,
};

// Generic hook: build a chart in a div, run `draw(chart)` whenever deps change.
export function useChart(draw, deps) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, BASE);
    draw(chart);
    chart.timeScale().fitContent();
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function PriceChart({ bars }) {
  const ref = useChart((chart) => {
    if (!bars?.length) return;
    const s = chart.addCandlestickSeries({
      upColor: "#3ddc84", downColor: "#ff5c5c", wickUpColor: "#3ddc84", wickDownColor: "#ff5c5c", borderVisible: false,
    });
    s.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const v = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, color: "#2a3038" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    v.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? "#1f4d36" : "#5a2626" })));
  }, [bars]);
  return <div ref={ref} className="h-full w-full" />;
}

// Price on top, daily sentiment bars underneath on the same time axis (stacked, not dual-axis).
export function SentimentChart({ rows }) {
  const ref = useChart((chart) => {
    if (!rows?.length) return;
    const p = chart.addLineSeries({ color: "#ffb000", lineWidth: 2, priceLineVisible: false, title: "close" });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.38 } });
    p.setData(rows.map((r) => ({ time: r.time, value: r.close })));
    const h = chart.addHistogramSeries({ priceScaleId: "sent", priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("sent").applyOptions({ scaleMargins: { top: 0.68, bottom: 0.02 } });
    h.setData(rows.filter((r) => r.score !== null).map((r) => ({
      time: r.time, value: r.score, color: r.score > 0.2 ? "#3ddc84" : r.score < -0.2 ? "#ff5c5c" : "#4a525c",
    })));
  }, [rows]);
  return <div ref={ref} className="h-full w-full" />;
}

export function EquityChart({ curves, band }) {
  const ref = useChart((chart) => {
    if (!curves) return;
    const fmt = { type: "custom", formatter: (x) => "$" + Math.round(x).toLocaleString() };
    for (const k of ["p5", "p95"]) {
      chart.addLineSeries({ color: "#199e70", lineWidth: 1, lineStyle: 2, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt }).setData(band[k]);
    }
    for (const [name, data] of Object.entries(curves)) {
      chart.addLineSeries({ color: SERIES[name], lineWidth: 2, priceLineVisible: false, priceFormat: fmt }).setData(data);
    }
    chart.addLineSeries({ color: SERIES.Cash, lineWidth: 1, lineStyle: 2, priceLineVisible: false, priceFormat: fmt })
      .setData(curves.Sentiment.map((d) => ({ time: d.time, value: 10000 })));
  }, [curves, band]);
  return <div ref={ref} className="h-full w-full" />;
}
