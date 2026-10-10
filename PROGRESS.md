# KNIGHTWATCH progress (Hack Knight, finance track)

Updated 2026-10-10 00:59 EDT, written for the managing Claude model. Full technical detail: `~/poc1/HANDOFF.md`.

## Status at a glance

| Part | Status |
|---|---|
| Sentiment model (Qwen3.5-2B QLoRA) vs FinBERT | Done. 0.919 vs 0.725 accuracy. |
| Backtest: does sentiment trade? | Done. No: lost to buy and hold, matched random timing. |
| Dashboard (6 MVP panels + draggable layout) | Done, browser-tested. |
| Finnhub live news (company-name filtered) | **Verified live.** NVDA 44 of 249 weekly headlines name the company. |
| Gemini briefing panel | **Verified live** (gemini-3.5-flash), grounded, no advice. |
| ElevenLabs read-aloud | Built; **key still missing**. Off on the public site by design. |
| Stretch 8: stock-specific news analyst (per-ticker specialist) | Built and tested; **waiting on teammates' hand labels** for the real score. |
| **Public site** | **LIVE: https://knightwatch-plum.vercel.app**, live browser test 11/11. |
| Crypto news specialist | Paused after the dataset review (Step 1). |
| GitHub repo | https://github.com/brubru6707/knight-daddy. **20 recent paths not pushed yet** (awaiting user OK). |

## Public site (new since last update)

- **Architecture:** Vercel serves the frontend and one API function. Storage is a **Modal Dict** behind a tiny Modal
  endpoint (`terminal/modal_kv/kv_app.py`, workspace `shapeup`), because Vercel Storage is full and the user chose not
  to use Upstash (code still supports Upstash). The **Oscar worker** (`terminal/worker/kw_worker.py`) pushes snapshots of
  every page for NVDA and DDOG and runs password-protected Train jobs from the site, pushing progress back.
- **Verified on the live URL (2026-10-10 00:45):** all panels load from snapshots (0.2 to 0.3 s per request), wrong train
  password rejected, a real Train run finished in **92 s from click** with live progress ("step 8/75" at 48 s).
- **Depends on Oscar:** data refreshes (every 15 min) and Train only work while the worker runs in a GPU session.
  Otherwise the site stays up with the last data and says "Worker offline". Last push: 2026-10-10 00:45 EDT.
- **Train password:** set as `KW_TRAIN_PASSWORD` on Vercel (the user has it; changeable in Vercel settings).
- **Secrets:** only in env vars (Vercel: KW_PUSH_SECRET, KW_TRAIN_PASSWORD, KW_KV_URL, KW_KV_SECRET; Oscar
  `terminal/.env`: KW_API_URL, KW_PUSH_SECRET; Modal Secret `knightwatch-kv`). Nothing printed or committed.
- **Off on the public site:** read-aloud and live classification; tickers other than NVDA and DDOG.

## Main results

| Model (2,388 held-out tweets) | Accuracy | Macro F1 |
|---|---|---|
| FinBERT, zero-shot | 0.725 | 0.668 |
| **Qwen3.5-2B QLoRA (ours, serves the dashboard)** | **0.919** | **0.895** |
| Qwen3.5-9B QLoRA (ours, teacher for Stretch 8) | 0.924 | 0.904 |

Backtest (Dec 2022 to Dec 2023): sentiment NVDA +96% vs buy and hold +190%; DDOG +18% vs +57%. Headlines track
yesterday's move (corr +0.33), not tomorrow's (about 0). **Pitch:** our model reads financial news better than FinBERT,
and we used it to show news sentiment lags price. Never claim it makes money.

## Bugs found and fixed in the deployment work

- Worker claimed a Train job during its own GPU warmup, so the job failed instantly. Now it never claims while busy and
  retries a briefly busy GPU for up to 2 minutes.
- Test helpers left an orphaned dev server holding the agent lock; fixed by closing the lock descriptor for children.
- A test check passed on the button label instead of a real training step; tightened to require "step N/75".
- Vercel without a database would silently lose data per instance; it now refuses with a clear 503 instead.

## Blockers and open items (need a human)

1. **Push to GitHub:** 20 changed/new paths (API, worker, Modal store, frontend, docs) are live on Vercel but not in the
   repo. Secret scan was clean on the earlier batch; rerun before pushing. Needs the user's OK (GitHub token, in memory).
2. **Hand labels** for NVDA and DDOG (`specialist/labeling/*_labeled.csv`) still not returned; the specialist's real
   before/after score cannot be computed until then.
3. **Crypto specialist:** waiting on the user's choice of test set (StockTwits tagged posts as primary + Myashka as
   secondary, or a hand-labeled set). See `crypto/DATA_REVIEW.md`.
4. **ElevenLabs key** missing (read-aloud works locally only once it is added; stays off on the public site).
5. **Credentials pasted in chat** (Gemini, Finnhub, GitHub, Modal tokens) should be rotated after the hackathon.

## How to run the demo

- Start a GPU session on Oscar, then: `source ~/poc1/env.sh && python ~/poc1/terminal/worker/kw_worker.py`
  (foreground; Ctrl-C to stop). The public site picks it up within about 20 seconds.
- Redeploy the site: `cd ~/poc1 && npx vercel@60.0.0 deploy --prod` (Vercel CLI login is saved in `~`).
- Local dashboard instead: `~/poc1/terminal/run_backend.sh`, then an SSH tunnel to port 8000.

## Environment

- Oscar GPU session 7256341 on gpu3006 (RTX 3090), about 5 h left at 00:59.
- Site rules: no squeue polling, show any sbatch before submitting, single-threaded agent work, foreground processes only.

## Key files

| What | Where |
|---|---|
| Technical handoff | `~/poc1/HANDOFF.md` |
| Public site: API, store, worker | `terminal/frontend/api/`, `terminal/modal_kv/`, `terminal/worker/` |
| Dashboard README | `~/poc1/terminal/README.md` |
| Stretch 8 detail | `~/poc1/specialist/PROGRESS_STRETCH8.md` |
| Crypto data review | `~/poc1/crypto/DATA_REVIEW.md` |
| Backtest write-up | `~/poc1/backtest/RESULTS.md` |
