# Crypto 3-class model: results (2026-10-11)

**Every number in this file is Claude-labeled, needs human spot-check.** No human has reviewed any label yet.
Branch `experiment/crypto-clean`. Nothing is wired into the apps.

## Verdict: negative under the pre-registered rule. Stop.

The rule, fixed before training: prepare a worker change only if the new crypto model beats the general 2B on the
**headline** test set with the 95% CI of the accuracy difference excluding 0.

| Headline test set, n = 231 (Claude-labeled, needs human spot-check) | Value |
|---|---|
| New crypto 3-class model minus general 2B, accuracy | **-0.9 pts, 95% CI [-5.6, +3.5]** |
| McNemar (new right and general wrong / general right and new wrong) | 14 / 16, p = 0.86 |
| Rule passes? | **No.** No worker change prepared. |

The new model is much better on StockTwits posts, the kind of text it was trained on, but no better than the general 2B on
news headlines, which is what the app shows. So it does not earn a place in the app.

## Results (Claude-labeled, needs human spot-check)

3-class accuracy and macro F1 with 95% bootstrap CIs (2,000 resamples, paired across models), exact McNemar.
Scripts: `crypto/predict_3class.py`, `crypto/score_3class.py`. Output: `crypto/results_3class/benchmark.json`.

### Headlines, n = 231 (Neutral 92, Bullish 76, Bearish 63). Claude-labeled, needs human spot-check.

| Model | Accuracy | Macro F1 | F1 Bearish / Bullish / Neutral | Predicts Neutral |
|---|---|---|---|---|
| Crypto 3-class (new) | 0.649 [0.584, 0.710] | 0.649 [0.582, 0.709] | 0.70 / 0.59 / 0.65 | 55% |
| General 2B | 0.658 [0.597, 0.719] | 0.654 [0.584, 0.714] | 0.69 / 0.60 / 0.68 | 60% |
| FinBERT (zero-shot) | 0.580 [0.515, 0.641] | 0.577 [0.509, 0.641] | 0.62 / 0.51 / 0.60 | 52% |

- New vs general 2B: -0.9 pts [-5.6, +3.5], p = 0.86, no clear difference. (Claude-labeled, needs human spot-check.)
- New vs FinBERT: +6.9 pts [-0.4, +14.3], p = 0.085, no clear difference. (Claude-labeled, needs human spot-check.)

### StockTwits posts, n = 400 held out (Bearish 141, Neutral 138, Bullish 121). Claude-labeled, needs human spot-check.

| Model | Accuracy | Macro F1 | F1 Bearish / Bullish / Neutral | Predicts Neutral |
|---|---|---|---|---|
| Crypto 3-class (new) | **0.723** [0.678, 0.763] | **0.719** [0.674, 0.760] | 0.79 / 0.72 / 0.65 | 29% |
| General 2B | 0.520 [0.475, 0.570] | 0.486 [0.434, 0.539] | 0.48 / 0.39 / 0.58 | 75% |
| FinBERT (zero-shot) | 0.432 [0.385, 0.478] | 0.368 [0.318, 0.416] | 0.38 / 0.20 / 0.53 | 80% |

- New vs general 2B: +20.2 pts [+14.5, +26.2], p = 6e-10, better. (Claude-labeled, needs human spot-check.)
- New vs FinBERT: +29.0 pts [+22.2, +35.8], p = 3e-15, better. (Claude-labeled, needs human spot-check.)
- The general 2B calls 75% of posts Neutral, against about 35% in the labels. That over-Neutral habit is most of its gap on
  posts, and the new model fixes it. (Claude-labeled, needs human spot-check.)

## What was done

1. **Labels (Claude-labeled, needs human spot-check).** 2,000 StockTwits crypto posts labeled Bullish / Bearish / Neutral from
   the text only, without seeing the author's tag: Bearish 704, Neutral 692, Bullish 604. Neutral rate 34.6%, consistent
   between the first 800 (36.8%) and the next 1,200 (33.2%).
2. **Headline test set (Claude-labeled, needs human spot-check).** 231 crypto news headlines dated Oct 5 to 10, 2026: Finnhub
   crypto news plus public RSS feeds (sources and rules in `crypto/headlines/PREREG_AMENDMENTS.md`, all logged before any
   model was scored on a headline). One row per story, off-topic and sponsored items excluded.
   Sources: UToday 81, CoinDesk 37, Cointelegraph 32, crypto.news 23, CryptoPotato 21, Decrypt 12, others 25.
3. **Split before training.** Posts: train 1,499 / probe 100 / test 400, stratified, seed 0. Near-duplicate check (exact,
   numbers-masked template, char TF-IDF cosine >= 0.8) across all splits and against the headlines: 1 training post dropped
   (an emoji-only match), none otherwise, no duplicates inside either test set (`crypto/results_3class/split_check.json`).
4. **Training.** Same recipe as the stock specialists (`specialist/train_specialist.py`): from the general Qwen3.5-2B QLoRA
   adapter, 1,499 crypto posts mixed 1:1 with general finance tweets, lr 5e-5, batch 16, 188 steps. Slurm job 7280265
   (gpu partition, 1 A40): 4 min training and scoring, 5 min 15 s total.

## Caveats

- **One annotator, and it is Claude.** Train labels, post test labels and headline labels all come from the same
  annotator, so the post result partly measures agreement with Claude's own reading of posts. A human pass would change
  every number here.
- **Headline set changed after planning.** The plan said 150 Finnhub BTC/ETH/SOL headlines. The set was widened twice,
  to any crypto-market headline and then to public RSS feeds, then frozen at 231 rows before training. The amendments
  file says the RSS widening was requested by the user. Both amendments were logged before any headline was scored,
  and the decision rule was not changed.
- **UToday is 35% of the headlines**, and many of its items are price-prediction pieces. A different source mix could move
  the headline numbers.
- **Posts and headlines are different domains.** The model learned StockTwits slang and stance, which do not carry over to
  news headlines, where the general 2B is already about as good.

## Human spot-check

`crypto/headlines/SPOTCHECK_50_headlines.csv`: 50 headline rows with Claude's label and an empty `your_label` column. If
your labels disagree with Claude's often, treat every number above as unreliable. A post spot-check can be drawn the same
way from `crypto/audit/sample_blind*.csv` and `blind_labels.txt`.

## Not done (by the rule)

No worker change, no UI caption, no deployment. The adapter stays in
`~/scratch/poc1/crypto/runs3/run-7280265/adapter` for reference only.
