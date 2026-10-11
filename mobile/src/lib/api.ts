// Client for the deployed Knight-Daddy API (same one the web terminal uses). See mobile/API.md.
// EXPO_PUBLIC_API_BASE overrides it at build time (local testing only); installed builds use the public site.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "https://knight-daddy.us/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/${path}`, init);
  } catch {
    throw new ApiError("Can't reach the Knight-Daddy server. Check your connection.", 0);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j?.detail || `${r.status} ${r.statusText}`, r.status);
  return j as T;
}

export type Label = "Bullish" | "Bearish" | "Neutral";
export type Counts = Partial<Record<Label, number>>;

export interface Health {
  mode?: string;
  snapshot_pushed_at?: string | null;
  tracked_tickers?: string[];
  historical_tickers?: string[];
  worker_online?: boolean;
  train_password_required?: boolean;
  keys?: Record<string, boolean>;
}

export interface Bar { time: string; open: number; high: number; low: number; close: number; volume: number }
export interface Prices {
  ticker: string; period: string; bars: Bar[]; last: number;
  change_1d: number; change_period: number; high: number; low: number;
}

export interface Headline {
  title: string; source?: string; url?: string; time?: string;
  label?: Label; general_label?: Label; p_bear?: number; p_bull?: number; p_neut?: number;
}
// p_bearish / p_neutral / p_bullish: the Qwen model's ticker-level softmax, pushed by the Oscar worker (absent until then).
export interface Headlines {
  ticker: string; provider?: string; items: Headline[]; model?: string;
  p_bearish?: number | null; p_neutral?: number | null; p_bullish?: number | null; confidence_n?: number;
}

export interface Briefing {
  id?: string; status: string; mode?: "normal" | "advanced"; message?: string; text?: string; n?: number; counts?: Counts;
  window?: string; model?: string; generated_at?: string;
}

export interface Sentiment {
  ticker: string; start: string; end: string;
  rows: { time: string; close: number; score: number | null; n: number }[];
  corr_by_lag: Record<string, number | null> | null; // null on the live version until min_days tagged days
  source?: "live"; tagged_days?: number; min_days?: number;
}

export interface Metric {
  final_value: number; total_return: number; max_drawdown: number; orders: number;
  win_rate: number | null; sharpe: number | null;
}
export interface Backtest {
  ticker: string; start: string; end: string; capital: number; seeds: number; threshold: number; slippage: number;
  metrics: Record<string, Metric>;
  curves: Record<string, { time: string; value: number }[]>;
  diagnostics: { random_seeds_beaten_by_sentiment: number };
}

export interface BenchRow { model: string; accuracy: number; macro_f1: number; per_class_f1?: Partial<Record<Label, number>> }
export interface Benchmarks { dataset: string; rows: BenchRow[] }

export interface SpecInfo { supported: string[]; busy?: boolean }

export interface ModelScore { name: string; accuracy: number; macro_f1: number; binary_accuracy?: number }
export interface SpecEval {
  ticker: string; status: string; message?: string; label_source?: string;
  n_scored?: number; n_test_rows?: number; changed_on_test_rows?: number;
  agreement_with_teacher?: { n: number; general: number; specialist: number } | null;
  models?: { general: ModelScore; specialist: ModelScore };
  comparison?: { verdict: string; accuracy_diff: number; accuracy_diff_ci95: [number, number] };
}

export interface SpecStatus {
  ticker?: string; phase: string; running?: boolean; step?: number; total_steps?: number | null;
  quick?: boolean; note?: string; error?: string; elapsed_s?: number; queued_s?: number;
  losses?: number[]; probe?: [number, number][]; // per-step training loss; held-out loss every few steps
}
export type Model = "general" | "specialist" | "none"; // "none": crypto, untagged headlines only

export interface CryptoQuote { ticker: string; source: string; last: number; open_24h: number; change_24h: number | null }
export interface CryptoNews extends Omit<Headlines, "items"> { tagged?: boolean; filter_note?: string; crypto_model?: boolean; items: (Headlines["items"][number] & { crypto_label?: Label | null })[] }

export interface ReplayPair { ticker: string; date: string; n: number }
export interface ReplayAvailable { pairs: ReplayPair[]; source?: string }
export interface Replay {
  ticker: string; date: string; replay: true; model: string; source: string; items: Headline[];
  p_bearish?: number | null; p_neutral?: number | null; p_bullish?: number | null; confidence_n?: number;
  price?: { close: number; prev_close: number | null; change_1d: number | null };
}

// Same query strings as the web app: the public site only replays paths the worker pushed.
export const paths = {
  health: () => "health",
  prices: (t: string, period: string) => `prices?ticker=${t}&period=${period}`,
  headlines: (t: string, model: Model = "general") => `headlines?ticker=${t}&source=live&limit=40&model=${model}`,
  audio: (id: string, t: string, mode?: string) => `${API_BASE}/briefing/audio?id=${id}&ticker=${t}${mode === "advanced" ? "&mode=advanced" : ""}`,
  talkAudio: (id: string) => `${API_BASE}/talk/audio?id=${id}`,
  specActive: (t: string) => `specialist/active?ticker=${t}`,
  replayAvailable: () => "replay/available",
  cryptoQuote: (t: string) => `crypto/quote?ticker=${t}`,
  cryptoCandles: (t: string) => `crypto/candles?ticker=${t}&days=730`,
  cryptoNews: (t: string) => `crypto/news?ticker=${t}`,
  replay: (t: string, d: string) => `replay?ticker=${t}&date=${d}`,
  briefing: (t: string, advanced = false) => `briefing?ticker=${t}${advanced ? "&mode=advanced" : ""}`,
  sentiment: (t: string) => `sentiment?ticker=${t}&live=1`, // live=1: every stock (Tiger daily tags) besides FNSPID
  backtest: (t: string) => `backtest?ticker=${t}`,
  benchmarks: () => "benchmarks",
  specInfo: () => "specialist/info",
  specEval: (t: string) => `specialist/eval?ticker=${t}`,
  specStatus: (t: string) => `specialist/status?ticker=${t}`,
};

// Talk: a question about one stock's news and its tone, answered from the real headlines only. Advice questions
// (buy, sell, hold, price targets, whether to invest) get a short decline every time.
export interface TalkSource { n: number; title: string; source?: string; url?: string; time?: string }
export interface TalkAnswer { ticker: string; id?: string; answer: string; engine?: "gemini" | "error"; refused?: boolean; model?: string; sources: TalkSource[] }
export function talk(ticker: string, question: string, history: { q: string; a: string }[] = []) {
  return api<TalkAnswer>("talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, question, history }) });
}

// Every fine-tune starts on Oscar from a fresh copy of the general model, never from an earlier specialist.
export function startTraining(ticker: string, password: string) {
  return api<{ ticker: string; job: string }>("specialist/train", {
    method: "POST",
    headers: { "content-type": "application/json", "x-train-password": password },
    body: JSON.stringify({ ticker, quick: false }),
  });
}

export function resetModel(ticker: string, password: string) {
  return api<{ ticker: string; active: "general" | "specialist" }>("specialist/reset", {
    method: "POST",
    headers: { "content-type": "application/json", "x-train-password": password },
    body: JSON.stringify({ ticker }),
  });
}
