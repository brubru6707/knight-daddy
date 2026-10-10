// Client for the deployed Knight-Daddy API (same one the web terminal uses). See mobile/API.md.
export const API_BASE = "https://knight-daddy.us/api";

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
  id?: string; status: string; message?: string; text?: string; n?: number; counts?: Counts;
  window?: string; model?: string; generated_at?: string;
}

export interface Sentiment {
  ticker: string; start: string; end: string;
  rows: { time: string; close: number; score: number | null; n: number }[];
  corr_by_lag: Record<string, number>;
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
}
export type Model = "general" | "specialist";

// Same query strings as the web app: the public site only replays paths the worker pushed.
export const paths = {
  health: () => "health",
  prices: (t: string, period: string) => `prices?ticker=${t}&period=${period}`,
  headlines: (t: string, model: Model = "general") => `headlines?ticker=${t}&source=live&limit=40&model=${model}`,
  audio: (id: string, t: string) => `${API_BASE}/briefing/audio?id=${id}&ticker=${t}`,
  specActive: (t: string) => `specialist/active?ticker=${t}`,
  briefing: (t: string) => `briefing?ticker=${t}`,
  sentiment: (t: string) => `sentiment?ticker=${t}`,
  backtest: (t: string) => `backtest?ticker=${t}`,
  benchmarks: () => "benchmarks",
  specInfo: () => "specialist/info",
  specEval: (t: string) => `specialist/eval?ticker=${t}`,
  specStatus: (t: string) => `specialist/status?ticker=${t}`,
};

// Every fine-tune starts on Oscar from a fresh copy of the general model, never from an earlier specialist.
export function startTraining(ticker: string, password: string) {
  return api<{ ticker: string; job: string }>("specialist/train", {
    method: "POST",
    headers: { "content-type": "application/json", "x-train-password": password },
    body: JSON.stringify({ ticker, quick: false }),
  });
}

export function resetModel(ticker: string, password: string) {
  return api<{ ticker: string; active: Model }>("specialist/reset", {
    method: "POST",
    headers: { "content-type": "application/json", "x-train-password": password },
    body: JSON.stringify({ ticker }),
  });
}
