# KNIGHTWATCH progress (Hack Knight, finance track)

Updated 2026-10-10 04:20 EDT, written for the managing Claude model. Overnight detail: `~/poc1/MORNING_REPORT.md`.
Full technical detail: `~/poc1/HANDOFF.md`. Repo: https://github.com/brubru6707/knight-daddy (`main` at `4d28ff9`,
working tree clean, everything pushed).

## Status at a glance

| Part | Status |
|---|---|
| Sentiment model (Qwen3.5-2B QLoRA) | Done. 0.919 accuracy; beats **fine-tuned** FinBERT (0.889) by +2.9 pts, CI excludes 0. |
| Backtest | Done and broadened to 6 tickers x 2 years. Sentiment lags price in 11/11; no trading edge. |
| Dashboard (FastAPI + React, 7 draggable panels) | Done, browser-tested. |
| Finnhub live news, Gemini briefing | Verified live. |
| ElevenLabs read-aloud | Built; **key still missing**. Off on the public site by design. |
| Stretch 8: per-ticker specialist (Train button) | Works for **NVDA and DDOG only**; real score **waiting on hand labels**. |
| Crypto specialist (StockTwits) | Done offline: +3.2 pts vs general model, CI excludes 0. **Not in the dashboard yet** (needs OK). |
| Public site | **LIVE: https://knightwatch-plum.vercel.app**. Needs the Oscar worker running for fresh data and Train. |
| GitHub | All work pushed. |

## Headline results (use these in the pitch)

| Model (2,388 held-out tweets) | Accuracy | Macro F1 |
|---|---|---|
| FinBERT zero-shot | 0.725 | 0.668 |
| FinBERT fine-tuned on our data (fair baseline) | 0.889 | 0.856 |
| **Qwen3.5-2B QLoRA (ours, serves the dashboard)** | **0.919** | **0.895** |
| Qwen3.5-9B QLoRA (ours, teacher for Stretch 8) | 0.924 | 0.904 |

- Ours vs fine-tuned FinBERT: +2.9 accuracy pts (95% CI +1.7 to +4.1), McNemar p = 5e-6. FinBERT is about 20x faster.
- Crypto (4,000 balanced StockTwits posts, binary): specialist 0.692 vs general 0.660 vs FinBERT 0.613. The big visible
  change is Neutral rate 79% to 5%; absolute accuracy is still modest.
- Backtest: sentiment correlates with the previous day's return (+0.15 to +0.45, all 11 ticker-years), not the next
  day's (mean 0.00). Lost to buy and hold in 5/6 rising-market runs; never beat 95/100 random-timing seeds.
- **Pitch wording:** "beats FinBERT even after fine-tuning FinBERT on the same data (about 3 pts)" and "news sentiment
  lags price in 11/11 ticker-years". Never claim it makes money; don't lead with the 19-pt zero-shot gap.

## Open question from the user (answered, awaiting decision)

The user asked whether Train can fine-tune a specialist for **any** stock (the panel only offers NVDA/DDOG).
Answer given: not today. Each specialist needs 9B-teacher-labeled headlines (batch-precomputed only for NVDA/DDOG) and a
hand-labeled test set (`SUPPORTED` in `terminal/backend/specialist.py`). Two options offered, neither started:

1. **Any-ticker mode** (about 2 to 3 h): fetch a year of company-named Finnhub headlines, label with the 9B on the fly,
   train, show "agreement with our 9B model" clearly marked **not accuracy**; minimum about 150 headlines; worker also
   pushes that ticker's data to the public site. Adds about 1 min per run (3 to 4 min total). VRAM tight on a 3090.
   Changes the demo path: build on a branch, test locally and on a Vercel preview before merging.
2. **Quick option** (under 1 h): pre-label AAPL, MSFT, AMZN, TSLA (headlines already extracted for the broadened
   backtest) so they get Train buttons via the existing pipeline. Still no hand-label score for them.

## Needs a human

1. Decide on the any-ticker Train option above (1, 2, or neither).
2. OK to add CRYPTO to the SPC and benchmark panels (about 30 min; changes the demo path).
3. **Hand labels** `specialist/labeling/NVDA_labeled.csv` and `DDOG_labeled.csv` from teammates.
4. **ElevenLabs key** (local read-aloud only).
5. Rotate credentials pasted in chat after the hackathon: Gemini, Finnhub, GitHub (expires Oct 12), Modal.

## Public site architecture (short)

- Vercel serves the frontend plus one function (`terminal/frontend/api/kw.js`). Storage is a Modal Dict behind
  `terminal/modal_kv/kv_app.py` (Vercel Storage full; user declined Upstash).
- Oscar cannot accept inbound connections, so the **worker** (`terminal/worker/kw_worker.py`) pushes snapshots for NVDA
  and DDOG every 15 min and runs password-protected Train jobs queued from the site. Without it the site stays up with
  last data and shows "Worker offline".
- Secrets live only in env vars (Vercel env, Oscar `terminal/.env`, Modal Secret `knightwatch-kv`); none committed.
  Train password is `KW_TRAIN_PASSWORD` on Vercel (the user has it).

## Demo-day startup

1. Start an Oscar GPU session about 30 min before presenting (sessions last about 6 h).
2. `source ~/poc1/env.sh && python ~/poc1/terminal/worker/kw_worker.py` (foreground; first push about 2 min).
3. Open https://knightwatch-plum.vercel.app, pick NVDA; Train takes about 1.5 to 2 min with live progress.
4. Fallback: `~/poc1/terminal/run_backend.sh` on Oscar plus an SSH tunnel to port 8000.

## Rules for any agent working on this

- Oscar site policy: flock `/tmp/$USER.agent-lock`, foreground only, no squeue polling, show any sbatch before submitting.
- Don't break the live site or demo path; demo-path changes need the user's OK.
- Never write tokens to files; secrets only in env vars. No em dashes in docs.

## Key files

| What | Where |
|---|---|
| Overnight report | `~/poc1/MORNING_REPORT.md` |
| Technical handoff | `~/poc1/HANDOFF.md` |
| Specialist trainer / backend | `specialist/train_specialist.py`, `terminal/backend/specialist.py` |
| Public site: API, store, worker | `terminal/frontend/api/`, `terminal/modal_kv/`, `terminal/worker/` |
| Crypto | `crypto/` and `results/crypto_*.json` |
| Backtests | `backtest/RESULTS.md`, `results/backtest_broad.json` |
| FinBERT baseline | `finbert_finetune.py`, `results/finbert-finetuned.json` |
