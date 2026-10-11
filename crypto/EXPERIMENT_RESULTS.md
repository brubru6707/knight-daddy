# Crypto sentiment: data integrity experiment (2026-10-10)

Branch `experiment/crypto-clean` (worktree `~/poc1-crypto`, from `origin/main`). Nothing wired into the apps.
No GPU used: every model number below re-scores predictions already saved by the earlier gate and specialist runs
(`~/scratch/poc1/crypto/gate_preds.parquet`, `runs/run-20261010-011058/preds_gold.parquet`).

## Bottom line

1. **The real tag-vs-text mismatch is 41.6% (95% CI 38.3 to 45.1), but it is almost all "no stance", not "wrong".**
   Only 4.9% of tags contradict the text. 36.7% of posts have no readable stance at all, so their tags can't be
   recovered from the text. When a post does take a stance, the author's tag agrees with it 92.3% of the time.
2. **The noisy test set hides real performance.** On posts with no stance, every model scores at chance (0.49 to 0.54).
   On the 467-post clean set (two annotators agree), the existing crypto specialist scores **0.805 accuracy, 0.802 macro F1**,
   against 0.771 for the general 2B and 0.662 for FinBERT. The specialist's gain over the general 2B holds: +3.4 pts,
   CI [+1.1, +5.8], McNemar p = 0.007.
3. **I did not train a new model.** The clean *test* set is defensible once a human spot-checks it (see caveats). The
   *training* data is not cleaner than before, and I found no way to clean it at scale that I'd defend (details below).
   Another QLoRA run would train on the same noisy labels and tell us little.

## 1. Audit: how many labels mismatch the text

**Method.** 800 posts drawn at random from the existing 4,000-post crypto test set (400 tagged Bullish, 400 Bearish;
seeds 2026 and 7), shuffled. Each post was labeled **blind** (tag hidden) as Bullish, Bearish, or No-stance (neutral,
off-topic, spam, a question, a price target with the direction lost to cashtag stripping, or ambiguous sarcasm). The
labels were then compared with the authors' tags. Wilson 95% CIs.

| 800 posts | Count | Rate | 95% CI |
|---|---|---|---|
| Text agrees with the tag | 467 | 58.4% | 54.9 to 61.7 |
| Text has no stance (tag can't be recovered) | 294 | 36.7% | 33.5 to 40.1 |
| Text contradicts the tag | 39 | 4.9% | 3.6 to 6.6 |
| **Total mismatch** | 333 | **41.6%** | 38.3 to 45.1 |
| Tag agrees, among posts that take a stance | 467 / 506 | 92.3% | 89.6 to 94.3 |

By tag: Bullish-tagged posts are noisier (40.3% no stance, 5.8% contradict) than Bearish-tagged ones (33.3% and 4.0%).
This matches the earlier "about 4 of 10" estimate in `DATA_AUDIT.md`, which was based on 10 posts. The new finding is the
split: the mismatch comes from posts with no stance, not from authors tagging the wrong way.

**The general 2B as a second annotator.** On the same 800 posts, its three-way output agrees with the blind labels only
49.1% of the time. It calls 362 of the 506 stance-bearing posts Neutral (on all 4,000 it says Neutral 79% of the time).
**Relabeling with the general model as weak labels was therefore rejected:** it would replace one kind of noise with a
larger one.

## 2. A cleaner labeled set

**Clean test set** = the 467 audited posts where the blind label and the author's tag agree (216 Bullish, 251 Bearish).
Each label has two independent annotators. Leakage check (`audit/dedupe_clean.json`): 0 exact overlaps with the training
or held-out pools, 6 template overlaps (numbers masked), 0 duplicates within the set. Dropping the 6 changes accuracy by
under 0.2 pts.

**Clean training data: not achieved.** The 239k training posts carry the same about 42% unlearnable or wrong tags. Options
considered:

- Hand-label at scale: not feasible here.
- Filter with the general 2B: 49% agreement with careful reading (above), so it is not a valid filter.
- Filter with the crypto specialist's confidence: circular, because it would keep the posts the model already gets right
  and inflate any later score.
- Headline sources (`Myashka/CryptoNews`, `flowfree/crypto-news-headlines`): labeling method undocumented (see
  `DATA_REVIEW.md`), about 1k rows each, and not on disk (`raw/flowfree` is empty). They can't serve as training data I'd
  defend either.

## 3. Benchmark on the clean set (same metrics as stocks; no new training)

Binary Bullish vs Bearish from P(Bullish) vs P(Bearish); 95% bootstrap CIs (2,000 resamples, paired across models);
exact McNemar. Script `audit/eval_clean.py`, output `audit/clean_eval.json`.

| Set | n | General 2B acc / macro F1 | Crypto specialist (600 ex.) acc / macro F1 | FinBERT acc / macro F1 |
|---|---|---|---|---|
| **Clean (double-annotated)** | 467 | 0.771 [0.732, 0.809] / 0.769 | **0.805 [0.769, 0.842] / 0.802** | 0.662 [0.617, 0.705] / 0.661 |
| No stance in text | 294 | 0.503 / 0.497 | 0.541 / 0.538 | 0.486 / 0.485 |
| All 800 audited (author tags, old metric) | 800 | 0.646 / 0.643 | 0.677 / 0.675 | 0.580 / 0.580 |

Specialist vs general 2B on the clean set: +3.4 pts, CI [+1.1, +5.8], p = 0.007, **better**.
Specialist vs FinBERT: +14.3 pts, CI [+9.6, +19.1], p = 2e-8, **better**.
On no-stance posts no comparison is significant, and all three models are near 0.5, as expected when the text carries no signal.

The "all 800" row reproduces the original 4,000-post results (0.660 / 0.692 / 0.613) within noise, so the audit sample
is representative.

## Caveats (read before citing any of this)

- **The blind annotator was Claude (this session), not a human.** One annotator, blind to the tag but not independent
  of LLM judgment. The 467 clean posts should get a human spot-check before they're called gold: for example, 100 posts
  from `audit/sample_blind.csv` / `sample_blind_2.csv`, compared with `audit/blind_labels.txt`. If a human disagrees often,
  every number here moves.
- The clean set keeps posts whose stance is readable, so it is **easier than real traffic**. About 37% of real posts have
  no stance, and a deployed model should call those Neutral. This data has no human Neutral class, so that behavior is
  untested.
- The test split is random, not by date (the data has no dates), and the same authors can appear in train and test.
- "No stance" was judged generously: a bare price target like "going to .25" counts as no stance, because the
  dataset strips cashtags and often the direction with them.

## If you want to go further

1. Human spot-check of the clean set (above). Cheapest step that most increases trust.
2. Only after that: a larger specialist run (for example, 6,000 crypto posts instead of 600), scored on the clean set.
   The labels would still be noisy, so expect a modest gain at best. That needs an sbatch, which I'd show you before
   submitting.

## Files (all under `crypto/audit/`)

`draw_sample.py`, `draw_more.py` (sampling) · `sample_blind.csv`, `sample_blind_2.csv` (texts shown to the annotator,
no tags) · `sample_key.csv` (sid → test id, tag) · `blind_labels.txt` (the 800 blind labels) · `score_audit.py` →
`audit_result.json` · `eval_clean.py` → `clean_eval.json` · `dedupe_clean.py` → `dedupe_clean.json`.
