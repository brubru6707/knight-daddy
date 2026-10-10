import { useEffect, useState } from "react";
import { Dot, NAMES, PEERS, relTime, SectionTitle, Status, TAG, useApi } from "./ui.jsx";

export function Headlines({ ticker, specReady, specVersion }) {
  const [all, setAll] = useState(false);
  const [source, setSource] = useState("live");
  const [model, setModel] = useState("general");
  useEffect(() => { if (!specReady) setModel("general"); }, [specReady]);
  useEffect(() => setAll(false), [ticker]);
  const s = useApi(`headlines?ticker=${ticker}&source=${source}&limit=40&model=${model}`, [specVersion]);
  const items = s.data?.items || [];
  const shown = all ? items : items.slice(0, 3);
  const opt = (cur, set, vals) => vals.map((v) => (
    <button key={v} onClick={() => set(v)} aria-pressed={cur === v} className={cur === v ? "text-amber" : "hover:text-ink"}>{v}</button>));
  return (
    <section className="mt-12" aria-label="Latest headlines">
      <SectionTitle right={<span className="flex items-center gap-3">
        {specReady && <span className="flex gap-2">{opt(model, setModel, ["general", "specialist"])}</span>}
        <span className="flex gap-2">{opt(source, setSource, ["live", "historical"])}</span>
        {s.data && <span data-testid="analysed">{items.filter((i) => i.label).length} analysed</span>}
      </span>}>Latest headlines</SectionTitle>
      <Status s={s} what="headlines" />
      {s.data && items.length === 0 && <div className="text-sm text-dim">No headlines found.</div>}
      <ul>
        {shown.map((h, k) => (
          <li key={k} className="flex gap-4 border-b border-line py-3.5" data-testid="headline">
            <span className={`flex w-[72px] shrink-0 items-center gap-1.5 text-xs ${TAG[h.label] || "text-dim"}`}
              title={h.p_bull !== undefined ? `bull ${(h.p_bull * 100).toFixed(0)}% · bear ${(h.p_bear * 100).toFixed(0)}% · neutral ${(h.p_neut * 100).toFixed(0)}%` : "not classified"}>
              <Dot label={h.label} />{h.label || "n/a"}</span>
            <div className="min-w-0">
              {h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="text-[14px] leading-snug text-ink hover:text-amber">{h.title}</a>
                : <span className="text-[14px] leading-snug text-ink">{h.title}</span>}
              {h.general_label && h.general_label !== h.label && <span className="ml-2 text-xs text-amber">general model said {h.general_label}</span>}
              <div className="mt-1 text-xs text-dim">{[h.source, relTime(h.time)].filter(Boolean).join(" · ")}</div>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button onClick={() => setAll(!all)} className="mt-4 text-sm text-amber hover:underline">
          {all ? "Show fewer headlines" : `View all ${items.length}`}</button>
      )}
      {s.data && (
        <p className="mt-4 text-xs text-dim">
          {source === "live" ? `Live headlines from ${s.data.provider || "n/a"}${s.data.filter_note ? `. ${s.data.filter_note}` : ""}.` : "Historical headlines from the FNSPID dataset."}
          {" "}Tags by our {model === "specialist" ? `${ticker} specialist` : "general 2B"} model.</p>
      )}
    </section>
  );
}

export function Competitors({ ticker, onPick }) {
  const peers = PEERS[ticker];
  return (
    <section className="mt-12" aria-label="Competitors">
      <SectionTitle>Competitors</SectionTitle>
      {peers ? (
        <div className="grid grid-cols-3 gap-3">
          {peers.map((p) => (
            <button key={p} onClick={() => onPick(p)} className="rounded-lg border border-line px-4 py-3 text-left hover:border-amber">
              <div className="text-[15px] font-semibold text-ink">{p}</div>
              <div className="mt-0.5 truncate text-xs text-dim">{NAMES[p]?.[0] || "n/a"}</div>
            </button>
          ))}
        </div>
      ) : <div className="text-sm text-dim">Competitors: n/a for {ticker}.</div>}
    </section>
  );
}
