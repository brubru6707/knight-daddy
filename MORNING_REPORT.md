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

### Pre-registered plan (written 01:12, before any scoring)

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

### Results (verified 01:37)

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
