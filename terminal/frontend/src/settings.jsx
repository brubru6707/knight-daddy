import { useEffect, useRef, useState } from "react";
import { api, HOME, isCrypto, setPw, useSavedPw, withPw } from "./ui.jsx";

const Gear = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// Settings (gear in the header): active model per stock, reset to the general model (this stock or all stocks), and
// the saved train password (change or forget). Resets use the password-protected /api/specialist/reset.
export function Settings({ current, onChanged }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [typed, setTyped] = useState("");
  const [askFor, setAskFor] = useState(null); // pending reset target while the password box is open
  const [editPw, setEditPw] = useState(false);
  const saved = useSavedPw();
  const box = useRef(null);
  const stock = current && !isCrypto(current) && HOME.includes(current) ? current : null;

  const load = () => Promise.all(HOME.map((t) => api(`specialist/active?ticker=${t}`).then((d) => [t, d.active]).catch(() => [t, null])))
    .then((rows) => setActive(Object.fromEntries(rows)));
  useEffect(() => { if (open) { load(); setMsg(null); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const reset = async (target, pw = saved) => {
    if (!pw) { setAskFor(target); return; }
    setBusy(target); setMsg(null);
    try {
      for (const t of target === "all" ? HOME : [target]) await withPw("specialist/reset", { ticker: t }, pw);
      if (pw !== saved) setPw(pw);
      setAskFor(null); setTyped("");
      setMsg(target === "all" ? "All stocks now use the general model." : `${target} now uses the general model.`);
      await load(); onChanged?.();
    } catch (e) {
      if (e.status === 401) { setAskFor(target); setMsg("Wrong train password. Enter it again."); }
      else setMsg(e.message);
    } finally { setBusy(null); }
  };
  const label = (t) => (active[t] === "specialist" ? `${t} specialist` : active[t] === "general" ? "general" : "n/a");

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} aria-label="Settings" aria-expanded={open} data-testid="settings"
        className="flex h-9 w-9 items-center justify-center text-dim hover:text-ink"><Gear /></button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-[min(340px,calc(100vw-2rem))] border border-rule bg-ground p-4 text-sm" role="dialog" aria-label="Settings" data-testid="settings-panel">
          <div className="kd-label">Active model</div>
          <ul className="mt-2" data-testid="settings-models">
            {HOME.map((t) => (
              <li key={t} className={`flex justify-between border-b border-line py-1.5 ${t === stock ? "text-ink" : "text-dim"}`}>
                <span className="font-semibold">{t}</span><span>{label(t)}</span></li>))}
          </ul>
          <div className="mt-4 flex flex-col gap-2">
            {stock && (
              <button onClick={() => reset(stock)} disabled={!!busy} className="border border-rule px-3 py-2 text-left text-ink hover:border-amber hover:text-amber disabled:opacity-40">
                {busy === stock ? "Resetting…" : `Reset ${stock} to general model`}</button>)}
            <button onClick={() => reset("all")} disabled={!!busy} className="border border-rule px-3 py-2 text-left text-ink hover:border-amber hover:text-amber disabled:opacity-40">
              {busy === "all" ? "Resetting…" : "Reset all stocks to general model"}</button>
          </div>
          {askFor && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed) reset(askFor, typed); }}>
              <input type="password" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Train password" aria-label="Train password"
                className="min-w-0 flex-1 border border-line bg-ground px-3 py-1.5 text-ink outline-none focus:border-amber" />
              <button className="bg-amber px-3 py-1.5 font-semibold text-ground disabled:opacity-40" disabled={!typed}>Reset</button>
            </form>)}
          <div className="kd-label mt-5">Train password</div>
          <div className="mt-1 text-xs text-dim" data-testid="pw-state">{saved ? "Saved on this device. Used for fine-tunes and resets." : "Not saved. You will be asked the first time you need it."}</div>
          {editPw ? (
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed) { setPw(typed); setTyped(""); setEditPw(false); setMsg("Train password saved. It is checked the next time you use it."); } }}>
              <input type="password" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="New train password" aria-label="New train password"
                className="min-w-0 flex-1 border border-line bg-ground px-3 py-1.5 text-ink outline-none focus:border-amber" />
              <button className="bg-ink px-3 py-1.5 font-semibold text-ground disabled:opacity-40" disabled={!typed}>Save</button>
            </form>
          ) : (
            <div className="mt-2 flex gap-4 text-xs">
              <button onClick={() => { setEditPw(true); setAskFor(null); setTyped(""); }} className="text-amber hover:underline">Change train password</button>
              {saved && <button onClick={() => { setPw(""); setMsg("Train password forgotten on this device."); }} className="text-amber hover:underline">Forget password</button>}
            </div>
          )}
          {msg && <div className="mt-3 text-xs text-ink" data-testid="settings-msg">{msg}</div>}
        </div>
      )}
    </div>
  );
}
