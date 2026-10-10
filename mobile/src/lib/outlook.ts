import type { Counts } from "./api";

// Never show trading advice words, whatever the briefing model wrote.
const ADVICE = /\b(buy|buys|buying|sell|sells|selling|hold|holds|holding)\b/i;
const MAX_LEN = 64;

const clip = (s: string) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1).trimEnd() + "…" : s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function toneLine(counts: Counts = {}, n?: number): string {
  const bull = counts.Bullish || 0, bear = counts.Bearish || 0, neut = counts.Neutral || 0;
  const total = n || bull + bear + neut;
  const net = total ? (bull - bear) / total : 0;
  const word = net > 0.2 ? "Leaning positive" : net < -0.2 ? "Leaning negative" : "Mostly neutral";
  return `${word} news (${bull} up, ${bear} down, ${neut} flat)`;
}

// Turn the Gemini paragraph into up to 4 short one-line reasons.
export function reasons(text = "", max = 4): string[] {
  const out: string[] = [];
  const sentences = text.replace(/([a-z0-9%)\]][.!?])\s+(?=[A-Z"])/g, "$1\n").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    if (/classified|sentiment model/i.test(s)) continue; // the counts sentence: already in the tone line
    // Drop lead-ins like "Over the last 24 hours, coverage surrounding Nvidia focused on ..."
    const body = s.replace(/^.*?\b(focused on|centered on|centred on|highlighted|discussed|included|covered)\s+/i, "")
      .replace(/[.!?]$/, "");
    const parts = body.split(/,|;/).map((p) => p.trim().replace(/^(and|or)\s+/i, "")).filter((p) => p.length > 3);
    for (const p of parts) {
      if (ADVICE.test(p)) continue;
      out.push(clip(cap(p)));
      if (out.length >= max) return out;
    }
  }
  return out;
}

export const hasAdvice = (s: string) => ADVICE.test(s);
