# KNIGHTWATCH progress (Hack Knight, finance track)

Updated 2026-10-10 05:52 EDT, written for the managing Claude model. Night-2 detail: top of `~/poc1/MORNING_REPORT.md`.
Technical handoff: `~/poc1/HANDOFF.md`. Data audit: `~/poc1/DATA_AUDIT.md`.

## Where things stand

| | State |
|---|---|
| **Production site** | https://knightwatch-plum.vercel.app, **unchanged** since last night, healthy (HTTP 200). Built from `main` at `4d28ff9`. |
| **New work** | Branch **`overnight2`** in `~/poc1` (head `8b7cf37`), **local only, not pushed** (needs the user's GitHub token pasted again; never store it). |
| **Preview deploy** | https://knightwatch-f5bw3wpx5-brubru6707s-projects.vercel.app (Vercel login required). Frontend works; **API returns "Database not connected"** because Vercel's Preview environment has no store env vars. |
| **GPU** | Oscar session 7256341 (L40S, gpu3006) ended about 06:00. Any new GPU work needs a new session or an sbatch shown to the user first. |

## What `overnight2` adds (all smoke tests pass: UI, specialist, briefing, public-mode 11/11, new toolbar/quick 17/17)

1. **More tickers for Train:** AAPL, MSFT, AMZN, TSLA, plus niche CELH, PTON, ENPH, SMCI, WING (9B teacher labels in
   `~/scratch/poc1/specialist/`). These have **no hand labels**, so the panel shows agreement with the 9B, labeled "not accuracy".
2. **CRYPTO specialist in the dashboard:** the SPC panel has its own ticker picker incl. CRYPTO, scored binary on 4,000
   author-tagged StockTwits posts with a visible "NO NEUTRAL CLASS" note (0.660 to 0.692, +3.2 pts, CI excludes 0). The
   benchmark panel has a crypto table.
3. **Customizable terminal:** toolbar to show/hide each of 7 panels, reset layout, named saved layouts (per browser). Drag/resize kept.
4. **QUICK DEMO training:** labeled "QUICK DEMO RUN, not scored", never served or scored; full TRAIN stays default.
   Measured on the warm L40S: **8.4 / 8.3 / 8.4 s click to DONE** (preloaded "standby" trainer; 64+64 examples; cached
   "before" scores). Back-to-back clicks: 26 to 33 s (standby reloading). Public queue: 11 s. Full TRAIN: 76 s to 48 s.
   Not measured on a 3090 (estimate 12 to 15 s).
5. **Bug fixes:** trainers could be silently killed (`PR_SET_PDEATHSIG` fires when the forking *thread* exits; now all
   children fork from one long-lived thread); worker showed "offline" during warmup (new `jobs/heartbeat`); 409 on rapid re-click.
6. **Data audit (partial):** stats done for all 4 datasets; label-quality judgment covers about 10 examples per dataset, not
   20 per class (samples in `audit/`). Key findings: tweet test set 1.6% exact overlap with train; specialist test sets 0
   overlap; crypto tags mismatch the text in about 30 to 50% of posts; specialist training period (before Jul 2023)
   overlaps the backtest year, so never backtest a specialist on it.

## Headline results (pitch)

| Model (2,388 held-out tweets) | Accuracy | Macro F1 |
|---|---|---|
| FinBERT zero-shot | 0.725 | 0.668 |
| FinBERT fine-tuned on our data | 0.889 | 0.856 |
| **Qwen3.5-2B QLoRA (ours, serves the dashboard)** | **0.919** | **0.895** |
| Qwen3.5-9B QLoRA (teacher) | 0.924 | 0.904 |

- Ours vs fine-tuned FinBERT: +2.9 pts (CI +1.7 to +4.1). Sentiment lags price in 11/11 ticker-years; no trading edge.
- Pitch: "beats FinBERT even after fine-tuning FinBERT on our data" and "news sentiment lags price". Never claim it makes money.

## Waiting on the user (in order)

1. **Review the preview / branch.** To make the preview API work: add `KW_KV_URL`, `KW_KV_SECRET`, `KW_PUSH_SECRET`,
   `KW_TRAIN_PASSWORD` to Vercel's **Preview** env (ideally a separate Modal Dict, so preview and production data don't mix).
2. **Paste the GitHub token** to push `overnight2`; then **merge to `main`** (auto-deploys production). Needs explicit OK.
3. **After merging, restart the Oscar worker** with the new code (new tickers, CRYPTO snapshots, quick jobs, heartbeat).
   Old worker plus new site ignores QUICK DEMO.
4. Hand labels for NVDA/DDOG (`specialist/labeling/*_labeled.csv`); ElevenLabs key; rotate credentials pasted in chat after
   the hackathon (Gemini, Finnhub, GitHub expires Oct 12, Modal).

## Not done / open ideas

- Data audit: full 20-per-class label review with judgments; license re-checks against dataset cards.
- Quick-demo timing on a 3090.
- Specialists for SOFI, HOOD, RIVN, AFRM, UPST (0 rows in FNSPID but 280 to 572 company-named Finnhub headlines last year;
  pipeline currently reads FNSPID only).
- Standby trainer holds about 2 to 3 GB extra GPU memory; disable with `SPECIALIST_STANDBY=0` if memory is tight.

## Demo-day startup

1. Start an Oscar GPU session 30 min before presenting.
2. `source ~/poc1/env.sh && python ~/poc1/terminal/worker/kw_worker.py` (foreground; Ctrl-C to stop).
3. Open the site, pick a ticker; QUICK DEMO for a live run, TRAIN for the real one (team's train password).
4. Fallback: `~/poc1/terminal/run_backend.sh` on Oscar plus an SSH tunnel. Note: port 8000 can be taken by another user
   on shared nodes; then run uvicorn on another port (`.env` sets PORT=8000, so pass the port to uvicorn directly).

## Rules for any agent

- Oscar policy: flock `/tmp/$USER.agent-lock`, foreground only, no squeue polling, show any sbatch before submitting.
- Don't touch production or merge without the user's OK. Secrets only in env vars; never write tokens to files. No em dashes.
- Don't `pkill -f` a pattern that also appears in your own command line (it kills your shell); use pids or `[x]yz` patterns.

## Key files

| What | Where |
|---|---|
| Trainer (quick/standby modes) | `specialist/train_specialist.py` |
| Specialist backend (tickers, standby, spawner) | `terminal/backend/specialist.py` |
| Extra-ticker pools / niche scan | `specialist/prep_more.py`, `niche/scan_fnspid.py`, `results/niche_*.json` |
| Frontend (toolbar, SPC) | `terminal/frontend/src/App.jsx`, `terminal/frontend/src/specialist.jsx` |
| Public API / worker | `terminal/frontend/api/kw.js`, `terminal/worker/kw_worker.py` |
| New smoke test | `terminal/scripts/toolbar_quick_smoke_test.py` |
| Audit | `DATA_AUDIT.md`, `audit/`, `results/data_audit_stats.json` |
