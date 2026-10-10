# HANDOFF: poc1 / KNIGHTWATCH (Hack Knight, finance track)

Written 2026-10-09 17:12 EDT, Stretch 8 status updated 18:36, news/briefing/audio added 19:28, Gemini and Finnhub verified live 20:21 EDT by the Claude Code session that did the work, for the managing Claude model.
This is the single entry point. It is complete as of the timestamp; detail lives in the files it links.

## 1. TL;DR

- We QLoRA fine-tuned **Qwen3.5-2B** (and 9B) for 3-class financial news sentiment. The 2B gets
  **0.919 accuracy / 0.895 macro F1** vs **FinBERT 0.725 / 0.668** on the same held-out set. Done, verified.
- We **backtested** a sentiment trading rule on NVDA and DDOG (2022-12-16 to 2023-12-15). It **lost to buy and
  hold on both and was indistinguishable from random timing.** Reason: headlines describe moves that already
  happened (score correlates +0.33 with the previous day's return, about 0 with any future day). Done, verified.
- We built **KNIGHTWATCH**, a terminal-style web dashboard (FastAPI + React) showing prices, model-tagged
  headlines, the sentiment-lags-price finding, the backtest, and the benchmark. MVP (6 panels) plus draggable
  layout are done and browser-tested. **Stretch 8 (per-ticker "stock-specific news analyst") is built and
  browser-tested; only the human-labeled score is pending** (teammates are hand-labeling). Details:
  `~/poc1/specialist/PROGRESS_STRETCH8.md`.
- **Gemini briefing (Stretch 9) is verified live** (key added 2026-10-09 about 19:35; model `gemini-3.5-flash`,
  because `gemini-2.5-flash` is closed to new keys and `3.8-flash` took over 60 s). **Finnhub news is verified live**
  (key saved about 20:15). Finnhub's company feed alone was NOT company-specific for NVDA (only 15% of the latest
  headlines named Nvidia), so the backend keeps only headlines naming the company or ticker (name from Finnhub's
  profile endpoint) when at least 8 exist in 7 days: NVDA 44 of 249, DDOG 13 of 24, TSLA 117 of 243. **ElevenLabs
  read-aloud (Stretch 10) is built and tested in no-key mode only; `ELEVENLABS_API_KEY` is still empty.**
- The hackathon story the evidence supports: **"Our model reads financial news better than FinBERT, and we
  used it to show that news sentiment lags price, so it is not a free trading signal."** Do not let anyone
  claim the model makes money; the data says otherwise.

## 2. Environment and constraints (read before doing anything)

- **Cluster:** Brown Oscar. User `brrodrig`. Home `~` = `/users/brrodrig` = `/oscar/home/brrodrig`.
- **Current GPU session:** Slurm job 7245878 on `gpu2109` (RTX 3090 24 GB), started about 18:00 EDT 2026-10-09,
  about 6 h long (earlier session 7231140 on gpu2101 has ended). Anything needing a GPU after that needs a new session, e.g.
  `interact -q gpu -g 1 -f ampere -m 32g -n 4` (Ampere only; Turing cards lack bf16).
- **Site policy for AI agents (`/oscar/AGENTS.md`, enforced by hooks):** heavy work in Slurm jobs; never run
  recursive `find`/`du`/`grep -r` on /oscar without a narrow path; single-threaded, no background jobs, no
  parallel subagents; take `flock -n /tmp/$USER.agent-lock` before work; never poll `squeue`/`sacct`;
  **show any sbatch script to the user before submitting**; no job arrays without approval.
- **Environment setup:** `source ~/poc1/env.sh` (loads python/3.12.8, cuda, cudnn, activates venv
  `~/venvs/fin`, sets `HF_HOME=~/scratch/hf`). Node for the frontend: `module load node-js/22.16.0-5pf2 npm/11.2.0-hzla`.
- **Internet works from compute nodes** (HF, PyPI, npm, yfinance all reachable on 2026-10-09).
- **Storage:** `~/scratch` (512 GB quota, purged periodically) holds caches: `~/scratch/hf` 24 GB, `~/scratch/poc1` 29 GB.
  Home has about 60 GB free. **`~/data` (`/oscar/data/nopi`) is not writable** by this user; adapters live in `~/poc1/adapters/` instead.
- **User preferences:** short status update after each step; verify by running, never assume; be honest about
  negative results; **no em dashes** in any docs or UI text; prioritize working end-to-end over polish.

## 3. What exists (artifact index)

| Path | What | Status |
|---|---|---|
| `~/poc1/HANDOFF.md` | this file | current |
| `~/poc1/NOTES.md` | every command that worked, versions, failures, training details | current through the 9B run |
| `~/poc1/PROGRESS.md` | human-friendly progress summary, incl. Stretch 8 plan, data findings, open decisions | current (2026-10-09 17:36) |
| `~/poc1/backtest/RESULTS.md` | backtest results, method, caveats, chart | current |
| `~/poc1/terminal/README.md` | dashboard: run, SSH tunnel, API, tests, config | current |
| `~/poc1/specialist/PROGRESS_STRETCH8.md` | Stretch 8: plan, data, timing, results so far, bugs fixed, what to do when labels arrive | current (18:36) |
| `~/poc1/specialist/` | Stretch 8 code: data prep, teacher labeling, trainer, eval; `labeling/` for hand labels | |
| `~/poc1/env.sh` | environment setup | |
| `~/poc1/train_qlora.py` | QLoRA train + eval for any decoder LM; resumes from checkpoints | |
| `~/poc1/finbert_eval.py`, `common.py` | FinBERT baseline; shared metrics | |
| `~/poc1/sbatch_train.sh` | batch job used for the 9B run | |
| `~/poc1/results/*.json` | metrics per model (ignore `smoke-*`) | |
| `~/poc1/adapters/qwen35-2b/`, `qwen35-9b/` | final LoRA adapters (the 2B serves the dashboard) | |
| `~/poc1/logs/` | all run logs | |
| `~/poc1/backtest/` | `prep_news.py`, `prep_prices.py`, `classify.py`, `backtest.py`, `results.json`, `equity_curves.png` | |
| `~/poc1/terminal/` | `run_backend.sh`, `backend/` (FastAPI, `classifier.py`, `modal_app.py`), `frontend/` (React), `scripts/ui_smoke_test.py`, screenshots | |
| `~/scratch/poc1/backtest/` | FNSPID raw CSVs (5.3 + 21.6 GB), per-ticker news/sentiment/price parquet | |
| `~/scratch/poc1/terminal/` | dashboard caches (prices, live news, `labels.json` classification cache) | |
| `~/scratch/poc1/qwen35-2b/`, `qwen35-9b/` | training checkpoints | |

## 4. Results

### Sentiment model (zeroshot/twitter-financial-news-sentiment, validation split, 2,388 tweets)

| Model | Accuracy | Macro F1 | Eval ex/s | GPU |
|---|---|---|---|---|
| FinBERT (ProsusAI/finbert), zero-shot | 0.7253 | 0.6682 | 1063 | RTX 3090 |
| Qwen3.5-2B base, zero-shot | 0.3907 | 0.3999 | 154 | RTX 3090 |
| **Qwen3.5-2B QLoRA, 1 epoch** | **0.9188** | **0.8951** | 106 | RTX 3090 |
| Qwen3.5-9B QLoRA, 1 epoch | 0.9238 | 0.9040 | 29 | RTX A5000 |

9B is barely better than 2B at about 4x lower throughput; the 2B is the one to demo. 2B training took 8 minutes.
Caveat: zero-shot FinBERT is a weak baseline (never trained on this dataset); a fine-tuned FinBERT would be fairer.

### Backtest ($10,000, 2022-12-16 to 2023-12-15, 0.05% slippage, trade at next open)

| | NVDA return / Sharpe | DDOG return / Sharpe |
|---|---|---|
| Sentiment strategy | +96.5% / 1.78 | +18.0% / 0.60 |
| Buy and hold | **+189.9% / 2.40** | **+57.3% / 1.06** |
| Random timing (mean of 100) | +89.6% / 1.87 | +33.2% / 0.79 |
| Cash | 0% | 0% |

Sentiment beat 57/100 (NVDA) and 41/100 (DDOG) random runs: consistent with luck. Rules were fixed before
running and never tuned. Engine and no-lookahead verified (hand calc matches; 0 headlines used early).

## 5. Key decisions and why (do not silently reverse these)

- **Target words are Negative/Positive/Neutral, not Bearish/Bullish/Neutral:** "Bullish" is 3 Qwen tokens
  (`B`,`ull`,`ish`); single-token targets make scoring clean. Outputs are mapped back to Bearish/Bullish/Neutral.
- **Classification never generates text:** it compares next-token logits of the 3 target tokens, so every
  output is a valid label. Thinking mode is disabled (`enable_thinking=False`).
- **FinBERT label order differs from the dataset** (FinBERT 0=positive, 1=negative; dataset 0=Bearish, 1=Bullish). Mapped by name.
- **Backtest headlines are filtered to ones naming the company,** because FNSPID ticker tags are noisy.
- **FNSPID has dates, not times,** so every headline is treated as after-close and trades the next open.
- **Test year is the 12 months ending at FNSPID's cutoff (2023-12-16),** the most recent full year with both news and prices.
- **Dashboard sentiment-vs-price uses stacked panes on one time axis, not a dual y-axis.**

## 6. Verified vs not verified

**Verified by running:** all training/eval numbers; backtest numbers and checks; every dashboard API endpoint
(curl); dashboard UI on NVDA and DDOG in headless Chromium (all panels render, 40 tagged headlines, backtest
runs, drag-and-reload keeps layout, zero console errors); frontend production build.

**Not verified:**
- `terminal/backend/modal_app.py` (Modal deployment) is written but **never deployed or run**. Unknowns:
  Modal account/auth, whether `causal-conv1d` is needed there (Qwen3.5 falls back to a slower path without it), cold start time.
- Viewing from the user's laptop via SSH tunnel: instructions written (`ssh -N -L 8000:gpu2101:8000
  brrodrig@ssh.ccv.brown.edu`), not tested from the laptop side.
- Whether the sentiment training data's dates overlap the backtest year (would affect label accuracy, not the conclusion).

## 7. Known issues and caveats

- **Live news relevance:** Finnhub is the primary source (`backend/news.py`), filtered to company-named headlines
  (see above). Without its key the backend falls back to Yahoo (`yf.Search`), where only 5 to 6 of 38 NVDA headlines
  mention Nvidia. The name filter misses companies known by another name in headlines (e.g. Alphabet vs Google).
- **Fixed 2026-10-09 19:20:** concurrent first requests (feed + briefing on page load) loaded the model twice at
  once and both failed ("Cannot copy out of meta tensor"). GPU model creation and use are now behind one lock;
  verified with 4 simultaneous cold requests, all 200, 0 errors.
- **Sentiment and backtest panels only work for NVDA and DDOG** (cached FNSPID). Adding a ticker: edit `NAMES`
  in `backtest/classify.py`, run `prep_news.py <nasdaq csv> TICKER` (scans 21.6 GB, about 4 min), add the
  ticker to `prep_prices.py`, run `classify.py TICKER` (GPU).
- **Dashboard needs a GPU** for new headline labels (first request about 25 s while the model loads). Without a GPU
  or `MODEL_ENDPOINT_URL`, it still runs but new live headlines show as unclassified.
- **Speed comparisons across GPUs** (9B on A5000 vs others on 3090) are only rough.
- **Scratch is purged periodically.** Adapters and results are already in home; FNSPID and HF caches would need re-downloading.
- Minor UI: the sentiment chart's right price axis shows a meaningless negative range below the bars.

## 8. Open tasks (suggested priority)

- **Overnight run 2026-10-10 (see `MORNING_REPORT.md`):** pushed to GitHub; crypto specialist wins (+3.2 pts binary,
  CI excludes 0) but not in the dashboard yet; broadened backtest confirms the lag finding in 11/11 ticker-years;
  fine-tuned FinBERT (0.889) added to the benchmark (our 2B leads by +2.9 pts, CI +1.7 to +4.1).

- **Public site LIVE (verified 2026-10-10 00:46): https://knightwatch-plum.vercel.app** (Vercel project `knightwatch`, root
  `terminal/frontend`, linked to the GitHub repo). Storage is a Modal Dict behind `terminal/modal_kv/kv_app.py`
  (https://shapeup--knightwatch-kv-web.modal.run, Modal workspace `shapeup`) because Vercel Storage is full and the
  user chose not to use Upstash. Vercel env (production): KW_PUSH_SECRET, KW_TRAIN_PASSWORD, KW_KV_URL, KW_KV_SECRET.
  Oscar `terminal/.env`: KW_API_URL, KW_PUSH_SECRET. Live browser test 11/11, Train click to DONE 92 s.
  The site only refreshes and trains while the worker runs on Oscar:
  `source ~/poc1/env.sh && python ~/poc1/terminal/worker/kw_worker.py` (foreground, GPU session).
  CLI deploys must run from `~/poc1` (root `.vercelignore` uploads only the frontend). Earlier notes below are history.
- **(history) Public site on Vercel (built 2026-10-09 23:05):** API + job queue (`terminal/frontend/api/kw.js`),
  Oscar push worker (`terminal/worker/kw_worker.py`), frontend in public mode (banner, password Train, polling).
  Verified locally with an in-memory stand-in for Upstash (`public_smoke_test.py` 11/11). Needs the user to import the
  repo in Vercel, add Upstash, set `KW_PUSH_SECRET` / `KW_TRAIN_PASSWORD`, then run the worker on Oscar.
  **Stopped 2026-10-09 23:51 (session ending):** the 14 changed files are NOT yet committed or pushed to GitHub;
  the Vercel CLI is not installed and no Vercel login exists. Next session: push (GitHub token, in memory only),
  then the user either logs in with `npx vercel@60.0.0 login` in their own terminal (device code; writes an auth file
  in ~) or gives a Vercel access token (preferred, used in memory). Then create the project (root `terminal/frontend`),
  add Upstash, set env vars, deploy, run the worker, and run `scripts/public_smoke_test.py` against the real URL.

- **Crypto news specialist (paused 2026-10-09 about 22:05, after Step 1):** dataset review in `crypto/DATA_REVIEW.md`.
  No documented human-labeled 3-class crypto set exists on HF; best option is ElKulako/stocktwits-crypto (author
  self-tags; "Neutral" likely means untagged). Waiting on the user's choice of test set before the gate test (Step 2).

0. **Stretch 8, waiting on human labels:** everything is built and tested (TRAIN to DONE in about 2 min on NVDA,
   10/10 browser checks). When teammates return `~/poc1/specialist/labeling/{NVDA,DDOG}_labeled.csv`, run
   `python ~/poc1/specialist/eval_specialist.py NVDA` (or just open the SPC panel) and report the verdict as is.
   Early signal without human labels: the specialist changes only 6 of 120 NVDA test tags, so "no clear difference"
   is a likely outcome. User rules: no tuning until it wins, frame as "stock-specific news analyst", never a trading signal.

1. **Make the demo reachable without Oscar:** deploy `modal_app.py`, set `MODEL_ENDPOINT_URL` and `MODEL_ENDPOINT_TOKEN`
   in `terminal/.env`, then host the backend anywhere (it needs no GPU when an endpoint is set). Needs user's Modal account.
2. **Verify Finnhub, Gemini, ElevenLabs live** once keys are in `terminal/.env` (code is done; see the terminal README
   section "Live news, AI briefing, read-aloud"). Start the backend and run
   `PLAYWRIGHT_BROWSERS_PATH=~/scratch/pw-browsers ~/venvs/fin/bin/python ~/poc1/terminal/scripts/briefing_smoke_test.py`;
   with keys it requires Finnhub as provider, at least 60% of NVDA titles naming Nvidia, a briefing with no advice
   phrases, and a real MP3. Gemini part already passes live. Unverified assumptions: ElevenLabs voice
   `JBFqnCBsd6RMkjVDRZzb` / model `eleven_flash_v2_5` (override with `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`).
3. **Fairer baseline:** fine-tune FinBERT on the same training split.
4. **Broader backtest:** more tickers and years, so conclusions are not one draw.

## 9. How to resume

```bash
# new GPU session (Ampere), then:
source ~/poc1/env.sh
~/poc1/terminal/run_backend.sh                     # dashboard API + UI on :8000
# laptop: ssh -N -L 8000:<node>:8000 brrodrig@ssh.ccv.brown.edu, open http://localhost:8000  (<node> from squeue --me)
# rerun pieces:
cd ~/poc1 && python finbert_eval.py
cd ~/poc1 && python train_qlora.py --model Qwen/Qwen3.5-2B --out ~/scratch/poc1/qwen35-2b --eval_base
cd ~/poc1/backtest && python classify.py && python backtest.py
cd ~/poc1/terminal/frontend && npm run build       # after UI edits
PLAYWRIGHT_BROWSERS_PATH=~/scratch/pw-browsers python ~/poc1/terminal/scripts/ui_smoke_test.py http://127.0.0.1:8000 DDOG out.png
```

## 10. Side notes

- An unrelated repo `~/facelift` (git, branch main, untracked `agents/`) was the session's starting directory. It
  was not modified by this project.
- Earlier in the session, a folder `~/POC1` was created and renamed to `~/poc1`.
- Software installed for this work: venv `~/venvs/fin` (torch 2.11.0+cu128, transformers 5.19.0, peft 0.21.2,
  bitsandbytes 0.50.2, fla 0.5.2, causal-conv1d 1.7.0, fastapi 0.143.0, yfinance 1.7.0, playwright), headless
  Chromium in `~/scratch/pw-browsers`, npm packages in `~/poc1/terminal/frontend/node_modules`.
