# Morning report, night 2 (2026-10-10, 04:40 to about 05:55 EDT)

Branch **`overnight2`** (local commits only; not pushed, because the GitHub token isn't stored; paste it to push).
**Nothing merged to main. Production untouched** (https://knightwatch-plum.vercel.app still serves the 4 h old deploy; checked HTTP 200).
**Preview:** https://knightwatch-f5bw3wpx5-brubru6707s-projects.vercel.app (behind Vercel login). Its frontend deployed,
but its API says "Database not connected": Vercel's Preview environment has no store env vars (they're Production-only).
I didn't point the preview at the production store (that would mix data). The full public flow was instead tested locally with the
same `kw.js` plus the worker: **11/11 passed**.

**Constraint that shaped the night:** the GPU/VS Code session (job 7256341, an **L40S**, not a 3090) had 1 h 19 min left at 04:40
and ends at about 06:00, taking this agent with it. A new GPU session needs an sbatch/interact you'd approve, so I did the
GPU work first (out of your order) and the data audit last. **The data audit is partial.**

## Done (each verified, all smoke tests passing before each commit)

| # | Task | Result |
|---|---|---|
| 2 | Pre-label AAPL MSFT AMZN TSLA | 9B labels done (5,671 headlines incl. niche, 5 min). Train works for each; quick run verified for all. |
| 2 | CRYPTO in SPC and benchmark | SPC has its own ticker picker incl. CRYPTO: binary score, "NO NEUTRAL CLASS" note, verdict (reproduces 0.660 to 0.692, +3.2 pts, better). Benchmark panel has a crypto table with the same note. |
| 3 | Customizable terminal | Toolbar: show/hide each of 7 panels, RESET LAYOUT, named saved layouts (SAVE/LOAD/DELETE), all per browser. Drag/resize still work (tested). |
| 4 | Demo-mode training | QUICK DEMO button, labeled "QUICK DEMO RUN, not scored" everywhere; never served or scored. Full TRAIN stays default. |
| 5 | Niche stocks | CELH, PTON, ENPH, SMCI, WING added (Train + header shortcuts for CELH/SMCI; worker tracks all). |

## Measured timings (task 4), warm L40S

| Mode | Click to DONE (3 runs) | Notes |
|---|---|---|
| Full TRAIN, before tonight | 76 s in-trainer (122 s on the 3090 last night) | |
| **QUICK DEMO, local UI** | **8.4, 8.3, 8.4 s** | model preloaded; 6.7 s inside the trainer |
| QUICK DEMO, back-to-back clicks | 26 to 33 s | next preloaded trainer still loading (about 15 s) |
| QUICK DEMO, public job queue | 11 s | worker poll 3 s (default now 5 s) |
| Full TRAIN, now | 48 s in-trainer (71 s click to DONE in UI test) | also uses the preloaded trainer |

What helped, by measurement: library import 13 to 16 s and model load 3.5 s (fixed by a preloaded "standby" trainer process,
spawned after each run); "before" scoring 8 to 41 s (cached per ticker); 64+64 examples (8 steps) instead of 600+600 (75 steps).
**3090 not measured** (no 3090 tonight). Estimate: about 12 to 15 s with the standby, about 40 s without it.

## Bugs found and fixed

- **Trainers could be killed silently.** `PR_SET_PDEATHSIG` fires when the forking *thread* exits; FastAPI request threads come
  and go. Explains two "stuck at loading model" test failures. All children now fork from one long-lived thread.
- **Site said "Worker offline" during the worker's startup warmup** (heartbeat only came with job claims). Added `jobs/heartbeat`.
- Back-to-back Train clicks got a 409 while the previous trainer was still exiting. Now waits up to 15 s.

## Niche candidates (FNSPID, company-named unique headlines; need >= 150)

Picked: CELH 283, WING 254 (re-filtered to "Wingstop" only; plain "wing" matches unrelated text), SMCI 313, PTON 1,072, ENPH 1,143.
Rejected (0 rows in FNSPID): SOFI, UPST, AFRM, ETSY, HOOD, LCID, MRNA, TTD, RIVN. Rejected (stale): IRBT 806 but none after 2020-06,
LULU 44. Passed but not picked (less niche): ROKU 1,437, DKNG 845, CHWY 499, ZS 340, OKTA 634, PLUG 1,769, FSLR 2,272, DOCU 649,
BYND 965. Finnhub counts **not checked** (ran out of session). Small tickers have small test pools (WING 28, PTON 30 rows), so
their agreement numbers are noisy.

## Data audit (task 1): PARTIAL, see `DATA_AUDIT.md`

Stats for all 4 datasets are computed (sizes, balance, duplicates, leakage, date overlap). Label-quality judgment covers about 10
examples per dataset, not 20 per class (samples saved in `audit/`). Key findings: tweet test set 1.6% exact overlap with train;
specialist test sets 0 overlap; crypto author tags mismatch the text in roughly 30 to 50% of posts; specialist training period
overlaps the backtest year (Dec 2022 to Jun 2023), so never backtest a specialist on it.

## Needs your OK to merge

1. **Review the preview** (or run locally). To make the preview's API work, add `KW_KV_URL`, `KW_KV_SECRET`, `KW_PUSH_SECRET`,
   `KW_TRAIN_PASSWORD` to Vercel's **Preview** environment (ideally a separate Modal Dict so preview and production don't mix).
2. **Push the branch** (paste the GitHub token), then merge `overnight2` into `main`. That auto-deploys production.
3. **Restart the worker after merging**: the new worker code (new tickers, CRYPTO snapshots, quick jobs, heartbeat) must run on
   Oscar, and the production site needs the new `kw.js` for quick jobs. Old worker plus new site would ignore QUICK DEMO.
4. The standby trainer keeps about 2 to 3 GB of extra GPU memory in use (fine on a 24 GB 3090). Turn it off with `SPECIALIST_STANDBY=0`.
5. Still pending from before: hand labels, ElevenLabs key, credential rotation after the hackathon.

## Not done

- Data audit label-quality pass (20 per class with judgments), license re-checks, Finnhub counts for niche tickers.
- Quick-demo timing on a 3090.

---

# Morning report (overnight autonomous run, 2026-10-10)

Started 01:05 EDT, hard stop 05:05 EDT. Oscar GPU session 7256341 on gpu3006 (RTX 3090).
Rules followed: live site untouched except a GitHub-triggered rebuild of identical code (verified), foreground only,
no sbatch, no squeue polling, no new deploys, no data deleted.

## 1. GitHub push: DONE

- Secret scan of all 22 staged files: no `.env` files; none of the 3 secrets in `terminal/.env` (Gemini, Finnhub,
  push secret), the GitHub/Modal/Vercel tokens, or the train password; no key-shaped strings. **Nothing leaks.**
- Commit `78256e0` pushed to `main` (token used in memory only; not in `.git/config` or any credential file).
- The push triggered Vercel's Git deploy (same frontend code as the live deploy): **Ready in 16 s**. Verified after:
  page, `/api/health`, prices, briefing all HTTP 200; store `modal`; data unchanged (last push 00:45).

## 2. Crypto specialist (StockTwits)

### Pre-registered plan (written 01:09, before any scoring)

- Data: `ElKulako/stocktwits-crypto` (1.33M posts, author-tagged). Keep only Bullish (2) and Bearish (0); label 1 is
  "untagged", not a real Neutral, so it is dropped everywhere. Normalize text (lowercase, collapse spaces), drop texts
  that appear with conflicting labels, drop exact normalized duplicates, drop posts under 3 words. No dates exist, so
  the split is random (seed 0); verify zero text overlap between splits.
- Test set: balanced, 2,000 Bullish + 2,000 Bearish (chance accuracy 50%). Held-out set: 1,000 balanced (second sample).
  Training pool: the rest, balanced by downsampling Bullish.
- Primary metric: binary Bullish vs Bearish, deciding by P(Bullish) vs P(Bearish) only (the labels have no Neutral).
  Secondary: the model's normal 3-way argmax with Neutral counted as wrong, plus the Neutral rate.
  FinBERT: positive vs negative the same way.
- **Gate:** if the general 2B's binary accuracy on the test set is >= 0.889 (its 0.919 on tweets minus 3 points),
  STOP: no specialist, report that as the finding.
- If there is a gap: `specialist/train_specialist.py` unchanged, defaults (600 crypto + 600 general replay, 1 epoch,
  lr 5e-5), continuing from the general 2B adapter. Eval general vs specialist vs FinBERT with 95% paired bootstrap CIs
  and exact McNemar. Verdict "better" only if the CI of the accuracy difference excludes 0. No tuning.

### Results (verified 01:14)

Data: 1.33M posts -> 778,526 tagged, deduplicated, >= 3 words (Bullish 656k, Bearish 122k). Test 4,000 balanced,
held-out 1,000 balanced, training pool 239,192 balanced. Zero text overlap between splits (asserted).

**Gate: GAP.** General 2B binary accuracy 0.662 [0.647, 0.676], far below the 0.889 stop threshold. It labels 79% of
crypto posts Neutral (FinBERT: 84%), which supports the hypothesis that crypto slang reads as "no lean" to a model
trained on financial-news tweets.

| Model (4,000 balanced StockTwits posts) | Binary acc [95% CI] | Macro F1 | F1 bear / bull | 3-way acc (Neutral = wrong) | Neutral rate |
|---|---|---|---|---|---|
| Qwen3.5-2B general (before) | 0.660 [0.645, 0.675] | 0.659 | 0.680 / 0.637 | 0.169 | 79.0% |
| **Qwen3.5-2B crypto specialist (after)** | **0.692 [0.678, 0.707]** | **0.691** | 0.711 / 0.671 | **0.667** | 4.7% |
| FinBERT (zero-shot) | 0.613 [0.598, 0.628] | 0.613 | 0.610 / 0.615 | 0.119 | 83.6% |

- Specialist vs general: **+3.2 points, 95% CI [+2.3, +4.1], McNemar p = 1.3e-11** (244 fixed, 116 broken): **BETTER**.
- Specialist vs FinBERT: **+7.9 points, CI [+6.1, +9.6], McNemar p = 2e-19**: **BETTER**.
- Training: 600 crypto + 600 general examples, 75 steps, 144 s total; held-out loss 1.77 -> 0.55; 3-way agreement with
  human tags on the 1,000 held-out posts 0.19 -> 0.68. Sanity: the run's "before" score (0.660) matches the separate
  gate test (0.662). Default settings, no tuning.

**Honest reading.** The big visible change is that the specialist stops calling crypto posts Neutral (79% -> 5%).
The pure Bullish-vs-Bearish gain is real but modest (+3 points) and absolute accuracy is still only 0.69: StockTwits
tags are the author's stance, and many posts do not show it in the text, so the ceiling is well below 1.0.
Caveats: random split (no dates), so posts from the same users can be in both train and test (only exact duplicates
were removed), which may flatter the specialist slightly. The trainer's progress file mislabels the probe/agreement
pool as "Jul-Dec 2023 headlines (9B labels)" (hard-coded for NVDA); for this run it is 1,000 held-out StockTwits posts
with human tags. Left the shared trainer untouched on purpose.

**Not done (needs you):** adding CRYPTO to the SPC panel and benchmark panel changes the demo path, which the overnight
rules forbid. Everything is ready: adapter at `~/scratch/poc1/crypto/runs/<run>/adapter`, results in
`results/crypto_gate.json` and `results/crypto_specialist.json`, code in `crypto/`.

## 3. Broadened backtest: DONE (verified 01:22)

Same strategy and rules as the original (`backtest/broaden.py` reuses `backtest.py`'s engine and constants), 6 tickers
x 2 windows: 2023 = 2022-12-16 to 2023-12-15 (rising market), 2022 = 2021-12-16 to 2022-12-15 (falling market).
Outputs in `~/scratch/poc1/backtest_broad/` (separate from the dashboard's cache on purpose) and
`results/backtest_broad.json`. **Sanity:** NVDA and DDOG 2023 reproduce the original results exactly (+96.5%, +18.0%).
**Excluded:** AMZN 2022, because FNSPID has zero AMZN headlines in that window (same >= 100 headline-day rule as before).

| Ticker | Window | Headline days | Orders | Sentiment | Buy & hold | Random (mean) | Random seeds beaten | Corr w/ previous day | Corr w/ next day |
|---|---|---|---|---|---|---|---|---|---|
| NVDA | 2023 | 249 | 23 | +96.5% | +189.9% | +89.6% | 57/100 | +0.33 | -0.10 |
| NVDA | 2022 | 240 | 71 | -51.6% | -45.6% | -24.9% | 13/100 | +0.44 | -0.08 |
| DDOG | 2023 | 146 | 21 | +18.0% | +57.3% | +33.2% | 41/100 | +0.15 | -0.02 |
| DDOG | 2022 | 129 | 31 | -35.0% | -54.6% | -28.5% | 50/100 | +0.45 | +0.11 |
| AAPL | 2023 | 251 | 26 | +13.5% | +45.3% | +19.8% | 32/100 | +0.23 | -0.07 |
| AAPL | 2022 | 132 | 21 | -1.5% | -23.5% | -12.5% | 84/100 | +0.22 | +0.11 |
| MSFT | 2023 | 249 | 25 | +27.7% | +50.4% | +22.8% | 65/100 | +0.28 | -0.05 |
| MSFT | 2022 | 157 | 29 | -9.4% | -25.2% | -15.3% | 67/100 | +0.20 | +0.03 |
| AMZN | 2023 | 191 | 15 | +35.7% | +69.8% | +32.6% | 63/100 | +0.19 | -0.03 |
| TSLA | 2023 | 251 | 24 | +98.8% | +58.7% | +33.5% | 93/100 | +0.38 | +0.03 |
| TSLA | 2022 | 158 | 32 | -24.5% | -52.5% | -30.1% | 65/100 | +0.35 | +0.05 |

**Does "sentiment lags price" hold? Yes, in all 11 ticker-years.**
- Correlation with the previous day's return is positive in 11/11 (range +0.15 to +0.45, mean +0.29);
  all exceed about 0.12, roughly the 5% significance level for ~250 days.
- Correlation with the next day's return ranges -0.10 to +0.11 (mean -0.00); none exceeds 0.12 in size.

**Trading:** no consistent edge. In the rising 2023 window sentiment lost to buy and hold in 5/6 (TSLA was the
exception: +98.8% vs +58.7%, beating 93/100 random runs). In the falling 2022 window it beat buy and hold in 4/5,
but random timing also beat buy and hold there (any strategy that sits in cash part of the time loses less in a
falling market). Against random timing it beat on average 57/100 seeds; none reached 95/100, and
with 11 tries a best result of 93 is about a coin flip by chance (1 - 0.93^11 = 55%). Conclusion unchanged and now
much stronger: headlines describe moves that already happened; they are not a trading signal.

## 4. Fine-tuned FinBERT baseline: DONE (verified 01:26)

`finbert_finetune.py`: ProsusAI/finbert fine-tuned on our same 9,543 training tweets, settings fixed in advance
(3 epochs, lr 2e-5, batch 32, seed 0, final epoch kept, validation never used for choices). 33 s on an L40S.

| Model (2,388 validation tweets) | Accuracy | Macro F1 | F1 Bearish / Bullish / Neutral |
|---|---|---|---|
| FinBERT zero-shot | 0.725 | 0.668 | 0.599 / 0.604 / 0.802 |
| **FinBERT fine-tuned (new fair baseline)** | **0.889** | **0.856** | 0.807 / 0.839 / 0.923 |
| Qwen3.5-2B QLoRA (ours) | 0.919 | 0.895 | 0.862 / 0.880 / 0.943 |

Paired on the same tweets: **ours +2.9 accuracy points (95% CI +1.7 to +4.1), macro F1 +3.8 (CI +2.1 to +5.2),
McNemar p = 5e-6** (148 tweets only ours got right, 79 only FinBERT). So our model still wins clearly, but the honest gap
against a fine-tuned FinBERT is about 3 points, not 19. FinBERT fine-tuned is also about 20x faster. **Update the pitch:**
"beats FinBERT even after fine-tuning FinBERT on the same data" is the stronger, honest claim.

Added to the dashboard's benchmark list (backend only, additive; `results/finbert-finetuned.json`,
`results/qwen2b_vs_finbert_finetuned.json`). The public site shows it after the worker's next snapshot push.

## Verification summary

- Live site checked after both GitHub-triggered rebuilds: HTTP 200 on page and APIs, data and storage unchanged.
- Local regression after all changes: `ui_smoke_test.py` (all panels, 40 tagged headlines, layout drag) and
  `briefing_smoke_test.py` (8/8, Finnhub + Gemini live), no console errors, no server tracebacks.
- Crypto and FinBERT results each reproduced their own sanity checks (general model 0.660 vs 0.662 in two runs;
  FinBERT rerun identical; our 2B scored 0.918 through the dashboard classifier vs 0.919 in training).
- Note: tonight's GPU is an **NVIDIA L40S** (gpu3006), not the RTX 3090 used earlier; speeds are not directly comparable.
- No leftover processes; agent lock free.

## What needs you

1. **Crypto in the dashboard?** The specialist wins, but adding CRYPTO to the SPC panel and a results row changes the demo
   path, which tonight's rules forbid. Say the word and it is about 30 minutes (panel option + benchmark row + test).
2. **Hand labels** (`specialist/labeling/NVDA_labeled.csv`, `DDOG_labeled.csv`) still not returned.
3. **ElevenLabs key** still missing (read-aloud is off on the public site regardless).
4. **Rotate the credentials pasted in chat** after the hackathon: Gemini, Finnhub, GitHub (expires Oct 12), Modal.
5. **Pitch wording:** lead with "beats a fine-tuned FinBERT by about 3 points" and "sentiment lags price in 11/11
   ticker-years", not the 19-point zero-shot gap.

## Demo-day startup (exact steps)

1. Start an Oscar GPU session (Open OnDemand desktop/VS Code on a GPU node, or `interact -q gpu -g 1 -f ampere -m 32g -n 4`).
   Sessions last at most about 6 hours; start it 30 minutes before you present.
2. In a terminal on that node:
   ```
   source ~/poc1/env.sh && python ~/poc1/terminal/worker/kw_worker.py
   ```
   Leave it running in the foreground (Ctrl-C to stop). First snapshot push takes about 2 minutes (includes the new
   fine-tuned FinBERT benchmark row); after that the banner on the site says "Worker online".
3. Open **https://knightwatch-plum.vercel.app**, click NVDA. Train needs the team's train password (set on Vercel as
   `KW_TRAIN_PASSWORD`); a run takes about 1.5 to 2 minutes and shows live progress.
4. Fallback if the public site has a problem: on Oscar run `~/poc1/terminal/run_backend.sh`, then from your laptop
   `ssh -N -L 8000:<gpu-node>:8000 brrodrig@ssh.ccv.brown.edu` and open http://localhost:8000 (everything, including
   read-aloud once a key exists, works locally).

## Final state (01:30 EDT)

All 4 priorities done in about 25 minutes of work; stopped early because everything else needs your input.
Commits on `main` (pushed): `78256e0` public site, `de1e53b` crypto specialist, `de3f024` broadened backtest,
`b3727d2` fine-tuned FinBERT + docs, plus this report. Each push triggered a Vercel Git rebuild of the unchanged frontend
(Ready in 11 to 16 s); the live site was re-checked after each (HTTP 200, data and storage unchanged, last data push
00:45). Nothing new was deployed beyond those identical rebuilds; the demo path is unchanged.
