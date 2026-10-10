# Knight-Daddy mobile: API contract

The app has no backend of its own. It calls the same deployed API as the web terminal:

- Base URL: `https://knightwatch-plum.vercel.app/api`
- Source: `terminal/frontend/api/kw.js` (one Vercel function, `/api/*` rewritten to it)
- Shapes below were read from `kw.js`, `src/App.jsx`, `src/specialist.jsx`, `src/briefing.jsx` and checked against the live site on 2026-10-10.

## How the public API works

Reads are a **mirror**. The Oscar worker fetches every URL the web frontend uses from the real backend and pushes the responses; GETs replay them. Consequences for the app:

- A GET only works if the exact path was pushed. The key is canonical: query params sorted, `ticker` upper-cased, `refresh` dropped. So the app must use the **same query strings as the web app** (for example `limit=40&model=general&source=live` for headlines).
- Only tracked tickers exist (currently `NVDA`, `DDOG`; see `health.tracked_tickers`). Anything else returns **404** with `{"detail": "Not available on the public site yet (...). Tracked tickers: NVDA, DDOG."}`. The app shows this as a friendly "not tracked" message.
- All errors are JSON `{"detail": "..."}` with a non-2xx status.

## Endpoints used by the app

### `GET /health`
```json
{ "mode": "vercel", "snapshot_pushed_at": "2026-10-10T04:45:51Z", "tracked_tickers": ["NVDA","DDOG"],
  "historical_tickers": ["DDOG","NVDA"], "worker_online": false, "train_password_required": true,
  "gpu": true, "model_loaded": false, "model_endpoint": null, "keys": {...} }
```
`worker_online` is true if the Oscar worker polled within 2 minutes. Used for the worker status card and to decide whether training can start.

### `GET /prices?ticker=NVDA&period=1y`
`period` in `3mo | 6mo | 1y | 2y` (all four are mirrored).
```json
{ "ticker": "NVDA", "period": "1y", "last": 229.28, "change_1d": -0.0052, "change_period": 0.2548,
  "high": 243.37, "low": 163.90,
  "bars": [{ "time": "2025-10-10", "open": 193.0, "high": 195.2, "low": 181.6, "close": 182.7, "volume": 268774400 }] }
```
Changes are fractions (0.25 = +25%). Chart is green if `change_period >= 0`, red otherwise.

### `GET /headlines?ticker=NVDA&source=live&limit=40&model=general`
`model` may also be `specialist` (only once a specialist run is done).
```json
{ "ticker": "NVDA", "source": "live", "provider": "Finnhub", "provider_note": null, "filter_note": "...",
  "model": "general", "labeled": true, "specialist_run": null,
  "items": [{ "title": "...", "source": "Yahoo", "url": "https://...", "time": "2026-10-10T03:26:37+00:00",
              "related": "NVDA", "label": "Bullish|Bearish|Neutral", "p_bull": 0.01, "p_bear": 0.0007, "p_neut": 0.98,
              "general_label": "only when model=specialist" }] }
```

### `GET /briefing?ticker=NVDA`
Gemini summary of the tagged headlines.
```json
{ "status": "ok | no_key | <other>", "message": "when status != ok", "id": "cddf0205256b844e", "ticker": "NVDA",
  "text": "one paragraph", "window": "last 24 hours ...", "n": 25,
  "counts": { "Bullish": 6, "Bearish": 2, "Neutral": 17 }, "model": "gemini-3.5-flash", "guard": "passed",
  "generated_at": "...", "provider": "Finnhub", "cached": true,
  "headlines": [{ "title": "...", "label": "Neutral", "source": "Yahoo" }] }
```
The app never shows `text` as a paragraph. `src/lib/outlook.ts` turns it into one tone line (from `counts`) plus up to 4 one-line reasons, and drops any line containing buy, sell or hold.

### `GET /sentiment?ticker=NVDA`
FNSPID history (2022-12-16 to 2023-12-15), only for `historical_tickers`.
```json
{ "ticker": "NVDA", "start": "2022-12-16", "end": "2023-12-15",
  "rows": [{ "time": "2022-12-16", "close": 16.52, "score": -0.33, "n": 3 }],
  "corr_prev_session": 0.33, "corr_next_open_to_open": -0.098,
  "corr_by_lag": { "-3": 0.03, "-2": 0.18, "-1": 0.33, "0": -0.05, "1": -0.01, "2": 0.05, "3": -0.03 } }
```
`corr_by_lag[k]` = correlation of today's score with the return k days away. If the peak |corr| on negative k (past) beats positive k (future), sentiment **lags** price.

### `GET /backtest?ticker=NVDA`
```json
{ "ticker": "NVDA", "start": "...", "end": "...", "capital": 10000, "slippage": 0.0005, "threshold": 0.2, "seeds": 100,
  "metrics": { "Sentiment" | "Buy and hold" | "Random (mean of 100)" | "Cash":
               { "final_value": 19646, "total_return": 0.96, "max_drawdown": -0.20, "orders": 23,
                 "round_trips": 12, "win_rate": 0.67, "sharpe": 1.78 } },
  "curves": { "Sentiment": [{ "time": "...", "value": 10000 }], "Buy and hold": [...], "Random (mean of 100)": [...] },
  "random_band": { "p5": [...], "p95": [...] },
  "diagnostics": { "random_seeds_beaten_by_sentiment": 57, ... } }
```
Read: beat buy-and-hold or not; "unusual" only if it beat 95+ of the 100 random seeds, otherwise "luck".

### `GET /benchmarks`
```json
{ "dataset": "zeroshot/twitter-financial-news-sentiment (validation, 2388 tweets)",
  "rows": [{ "model": "Qwen3.5-2B QLoRA (ours)", "accuracy": 0.919, "macro_f1": 0.895,
             "per_class_f1": { "Bearish": 0.0, "Bullish": 0.0, "Neutral": 0.0 }, "examples_per_sec": 0, "gpu": "...", "n": 2388 }],
  "crypto": { "optional": "..." } }
```
Live rows on 2026-10-10: FinBERT (zero-shot), Qwen3.5-2B base, Qwen3.5-2B QLoRA (ours), Qwen3.5-9B QLoRA (ours). The web panel also looks for a "FinBERT fine" row; it is not in the live data yet, so the app compares ours vs whichever FinBERT rows exist.

### `GET /specialist/info`
```json
{ "supported": ["NVDA","DDOG"], "tickers": { "NVDA": { "teacher_labels": true, "hand_labels": false, "test_set": "hand|teacher|author_tags (optional)", "latest_run": "..." } },
  "busy": false, "busy_with": null }
```

### `GET /specialist/eval?ticker=NVDA`
`status` is one of:
- `scored`: `models.{general,specialist,teacher}.{name, accuracy, accuracy_ci95, macro_f1, macro_f1_ci95, per_class_f1}`, `comparison.{verdict, accuracy_diff, accuracy_diff_ci95, mcnemar}`. `verdict` is `"better" | "worse" | "no clear difference"` (rule fixed in advance: better or worse only if the 95% CI excludes 0).
- `scored_binary`: crypto variant with `binary_accuracy`.
- `no_human_labels` / `no_run`: only `message`, `agreement_with_teacher` ({n, general, specialist}), `changed_on_test_rows`, `n_test_rows`.

Live on 2026-10-10: NVDA and DDOG are `no_human_labels`, so no verdict exists yet. The app shows the message plus the 9B-agreement before/after, and shows the verdict as soon as `status` becomes `scored`.

### `GET /specialist/status?ticker=NVDA`
Training progress (same shape locally and on the public site).
```json
{ "ticker": "NVDA", "phase": "queued|starting|loading data|loading model|scoring general model|training|scoring specialist|saving|done|failed|none",
  "running": false, "step": 75, "total_steps": 75, "quick": false, "note": "...", "error": "when failed",
  "elapsed_s": 0, "eta_s": 0, "losses": [...], "loss_ticker": [...], "probe": [[step, loss]] }
```
Progress bar = `step / total_steps` (100% when `phase == "done"`). Poll every 2 s until `done` or `failed`.

### `POST /specialist/train`
Headers: `content-type: application/json`, `x-train-password: <password>`. Body: `{ "ticker": "NVDA", "quick": false }`.
- 200 `{ "ticker": "NVDA", "job": "<uuid>" }`
- 401 wrong password, 400 unsupported ticker, 503 worker offline (or training disabled), 409 GPU busy.

The password is asked once per app session, kept in React state only, never stored or committed. On 503 the app shows "Model offline, showing latest data" and keeps everything else loaded.

## Not used by the app
`classify`, `briefing/audio`, `specialist/stream` return 503/410 on the public site. `snapshot` and `jobs/*` are worker-only (shared secret).

## Competitor peer map (hardcoded in `src/lib/peers.ts`)

| Ticker | Peers |
|---|---|
| NVDA | AMD, INTC, TSM |
| AAPL | MSFT, GOOGL, AMZN |
| TSLA | RIVN, LCID, F |
| DDOG | SNOW, NET, DT |
| CELH | MNST, KDP, PEP |
| SMCI | DELL, HPE, NVDA |
| AMD | NVDA, INTC, QCOM |
| MSFT | AAPL, GOOGL, AMZN |

Tapping a peer loads it. Peers that are not tracked by the public mirror show the friendly "not tracked yet" message rather than an error.
