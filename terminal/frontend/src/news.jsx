import { useEffect, useState } from "react";
import { Dot, headlinesPath, NAMES, PEERS, relTime, SectionTitle, Status, TAG, useApi } from "./ui.jsx";

// Latest headlines tagged by the active Qwen model (general or this ticker's specialist). model="none" (crypto):
// untagged headlines only, no model output.
export function Headlines({ ticker, model, specVersion }) {
  const [all, setAll] = useState(false);
  const [source, setSource] = useState("live");
  useEffect(() => setAll(false), [ticker]);
  const tagged = model !== "none";
  const s = useApi(headlinesPath(ticker, model, tagged ? source : "live"), [specVersion]);
  const items = s.data?.items || [];
  const shown = all ? items : items.slice(0, 3);
  const opt = (cur, set, vals) => vals.map((v) => (
    <button key={v} onClick={() => set(v)} aria-pressed={cur === v} className={cur === v ? "text-amber" : "hover:text-ink"}>{v}</button>));
  return (
    <section className="mt-12" aria-label="Latest headlines">
      <SectionTitle right={<span className="flex items-center gap-3">
        {tagged && <span className="flex gap-2">{opt(source, setSource, ["live", "historical"])}</span>}
        {tagged && s.data && <span data-testid="analysed">{items.filter((i) => i.label).length} analysed</span>}
      </span>}>Latest headlines</SectionTitle>
      <Status s={s} what="headlines" />
      {s.data && items.length === 0 && <div className="text-sm text-dim">No headlines found.</div>}
      <ul>
        {shown.map((h, k) => (
          <li key={k} className="flex gap-4 border-b border-line py-3.5" data-testid="headline">
            {tagged && <span className={`flex h-fit w-[80px] shrink-0 items-center gap-1.5 border border-current px-1.5 py-0.5 text-[11px] ${TAG[h.label] || "text-dim"}`}
              title={h.p_bull !== undefined ? `bull ${(h.p_bull * 100).toFixed(0)}% · bear ${(h.p_bear * 100).toFixed(0)}% · neutral ${(h.p_neut * 100).toFixed(0)}%` : "not classified"}>
              <Dot label={h.label} />{h.label || "n/a"}</span>}
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
          {" "}{tagged ? `Tags by Qwen, ${model === "specialist" ? `${ticker} specialist` : "general model"}.` : "No sentiment model runs on crypto, so these are untagged."}</p>
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
        <div className="grid grid-cols-3 gap-0 border-l border-t border-line">
          {peers.map((p) => (
            <button key={p} onClick={() => onPick(p)} className="border-b border-r border-line px-4 py-3 text-left hover:bg-card">
              <div className="text-[15px] font-semibold text-ink">{p}</div>
              <div className="mt-0.5 truncate text-xs text-dim">{NAMES[p]?.[0] || "n/a"}</div>
            </button>
          ))}
        </div>
      ) : <div className="text-sm text-dim">Competitors: n/a for {ticker}.</div>}
    </section>
  );
}
