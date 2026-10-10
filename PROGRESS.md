# KNIGHTWATCH progress (Hack Knight, finance track)

Updated 2026-10-09 20:21 EDT, written for the managing Claude model. Full technical detail: `~/poc1/HANDOFF.md`.

## Status at a glance

| Part | Status |
|---|---|
| Sentiment model (Qwen3.5-2B QLoRA) vs FinBERT | Done. 0.919 vs 0.725 accuracy. |
| Backtest: does sentiment trade? | Done. No: lost to buy and hold, matched random timing. |
| KNIGHTWATCH dashboard (6 MVP panels + draggable layout) | Done, browser-tested. |
| Stretch 8: "stock-specific news analyst" (train a per-ticker specialist) | Built and browser-tested (10/10). **Waiting on teammates' hand labels** for the real score. |
| Finnhub live news (primary), Yahoo fallback | **Verified live.** Filtered to company-named headlines (NVDA 44 of 249 per week). |
| Stretch 9: Gemini briefing panel | **Verified live** (gemini-3.5-flash): complete, grounded, no advice; browser test passes. |
| Stretch 10: ElevenLabs read-aloud | Built, error paths verified. **Live check blocked: no key saved.** |
| Modal deployment | Code written, never deployed. |

## Blockers (need a human)

1. **One API key still missing:** `ELEVENLABS_API_KEY` is empty in `~/poc1/terminal/.env`. Gemini and Finnhub keys
   were pasted in chat and saved (both work). Keys are re-read on every request; no restart needed. Both keys were shared
   in chat, so they should be rotated after the hackathon.
2. **Hand labels not back yet.** `~/poc1/specialist/labeling/NVDA_labeled.csv` and `DDOG_labeled.csv` do not exist.
   Until they do, the specialist panel shows "NO HUMAN TEST LABELS YET" instead of a score (by design).

## Main results so far

| Model (2,388 held-out tweets) | Accuracy | Macro F1 |
|---|---|---|
| FinBERT, zero-shot | 0.725 | 0.668 |
| **Qwen3.5-2B QLoRA (ours, serves the dashboard)** | **0.919** | **0.895** |
| Qwen3.5-9B QLoRA (ours, used as teacher) | 0.924 | 0.904 |

Backtest (Dec 2022 to Dec 2023): sentiment strategy NVDA +96% vs buy and hold +190%; DDOG +18% vs +57%.
Headlines track yesterday's move (corr +0.33), not tomorrow's (about 0).

**Pitch the evidence supports:** our model reads financial news better than FinBERT, and we used it to show news
sentiment lags price. Never claim it makes money.

## Stretch 8 in brief (details: `~/poc1/specialist/PROGRESS_STRETCH8.md`)

- TRAIN on NVDA fine-tunes from the general 2B adapter on 600 9B-labeled headlines + 600 general examples:
  **about 2 minutes click to DONE** (115 to 125 s warm on an RTX 3090), live progress and loss chart.
- Before/after is scored only against teammates' hand labels (accuracy and macro F1 with 95% CIs, per-class F1 with n,
  McNemar). Verdict rule fixed in advance: "better/worse" only if the CI of the difference excludes 0.
- Early signal without human labels: the specialist changes very little (6 of 120 NVDA test tags, 1 of 100 DDOG;
  agreement with the 9B teacher 92.4% to 93.2%). Likely outcome: "no clear difference". Report it as is; the user's
  rule is no tuning until it wins.

## News, briefing, read-aloud in brief (this session)

- **Finnhub first** (7-day company news), Yahoo fallback on missing key, error or empty result; the feed shows the
  provider. Fallback relevance today: only 6 of 38 NVDA headlines mention Nvidia, which is why Finnhub matters.
- **Gemini briefing:** one paragraph (max 90 words) from today's model-tagged headlines only (falls back to last
  24 h, then most recent, and says which). We pass our own tag counts. Output checked for prediction/advice phrases:
  regenerate once, else a plain non-AI summary. Disclaimer always shown. Cached per headline set.
- **ElevenLabs read-aloud:** only for briefings this server generated; MP3 cached; bad or unknown IDs rejected.
- Verified without keys: fallback and invalid-key paths (no key text leaks), every briefing branch with Gemini stubbed,
  guard caught 4/4 advice sentences with 0/4 false alarms, browser test passes in no-key mode, regression test passes.
- **Gemini live (verified by 20:10):** NVDA and DDOG briefings of 65 and 73 words in about 4 s, tag counts quoted exactly, every
  number and name traceable to the given headlines, no advice phrases. NVDA's briefing honestly says the (Yahoo fallback)
  headlines are mostly not about Nvidia. Fixed on the way: `gemini-2.5-flash` is closed to new keys (now `gemini-3.5-flash`),
  and thinking tokens truncated answers mid-sentence (budget raised to 4096, low thinking, and any answer that did not
  finish normally is retried, then replaced by the plain summary; never shown cut off).
- **Finnhub live:** switching provider alone did not fix relevance: only 6 of the latest 40 NVDA headlines (15%) named
  Nvidia, because Finnhub's feed for large caps includes general market stories. A fixed rule (same as for FNSPID) now keeps
  headlines naming the company (from Finnhub's profile) or ticker when at least 8 exist in 7 days: NVDA 44 of 249,
  DDOG 13 of 24, TSLA 117 of 243. The NVDA briefing is now about Nvidia (AI demand, Taiwan Semi earnings, $1 billion
  science commitment), every claim traceable to its headlines. Browser test with Finnhub + Gemini: all pass.
- **Unverified until the key exists:** ElevenLabs
  voice `JBFqnCBsd6RMkjVDRZzb` and model `eleven_flash_v2_5` (all overridable in `.env`).

## Bugs found and fixed today

- Concurrent first requests (feed + briefing on page load) loaded the model twice at once and both crashed
  ("Cannot copy out of meta tensor"). Fixed with a GPU lock; 4 simultaneous cold requests all succeed.
- Training subprocess survived a server stop and held 7.5 GB of GPU memory. Fixed (dies with the server); verified with SIGKILL.
- Several test-only races fixed; app behavior unchanged.

## Next steps (in order)

1. When keys are saved: start the backend and run `terminal/scripts/briefing_smoke_test.py` (adapts to keys; with
   keys it requires Finnhub as provider, at least 60% of NVDA titles naming Nvidia, no advice phrases, a real MP3).
2. When hand labels arrive: open the specialist panel or run `python ~/poc1/specialist/eval_specialist.py NVDA`
   (and DDOG); report the verdict exactly. Expect wide intervals (about ±7 points at n=100).
3. Optional: deploy `terminal/backend/modal_app.py` so the demo runs without Oscar (needs a Modal account).

## Environment

- Oscar GPU session 7245878 on gpu2109 (RTX 3090), about 4 h 26 min left at 19:31.
- Run the dashboard: `~/poc1/terminal/run_backend.sh`, then on a laptop
  `ssh -N -L 8000:gpu2109:8000 brrodrig@ssh.ccv.brown.edu` and open http://localhost:8000.
- Site rules: no squeue polling, show any sbatch to the user before submitting, single-threaded agent work.

## Key files

| What | Where |
|---|---|
| Technical handoff | `~/poc1/HANDOFF.md` |
| Stretch 8 detail | `~/poc1/specialist/PROGRESS_STRETCH8.md` |
| Dashboard README (run, tunnel, API, tests) | `~/poc1/terminal/README.md` |
| Keys (gitignored) | `~/poc1/terminal/.env` (template `.env.example`) |
| Backtest write-up | `~/poc1/backtest/RESULTS.md` |
| Training commands and versions | `~/poc1/NOTES.md` |
