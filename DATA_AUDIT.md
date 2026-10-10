# Data audit (2026-10-10, PARTIAL)

**What a judge should hear**
1. Our headline test set is clean: no exact or templated overlap between specialist training data and the hand-label test set, and only 39 of 2,388 tweet test rows (1.6%) also appear verbatim in training.
2. Crypto labels are the authors' own Bullish/Bearish tags, and many posts don't show that stance in the text (roughly 4 of 10 in a small sample), so no model can score near 100% there; that's why we report it separately and binary only.
3. The 9B "teacher" labels are model output, not ground truth; tickers without hand labels show agreement with the teacher, never accuracy.

Status: the statistics below were computed by `audit/audit_stats.py` (output `results/data_audit_stats.json`). The
label-quality review is **not finished**: the GPU session ended at about 06:00, so I read only about 10 examples per
dataset, not 20 per class. Random samples (20 per class, seed 0) are saved in `audit/samples_*.csv` for a human pass.

## 1. twitter-financial-news-sentiment (general model training and the main benchmark)

- **Source / license:** Hugging Face `zeroshot/twitter-financial-news-sentiment`, MIT license per its dataset card (not re-verified tonight).
- **Size:** 9,543 train, 2,388 validation (validation is our test set for every model).
- **Balance:** train Neutral 6,178 / Bullish 1,923 / Bearish 1,442; test 1,566 / 475 / 347 (65% Neutral, so macro F1 is reported next to accuracy).
- **How labels were made:** human-annotated finance tweets (per the dataset card); 3 classes.
- **Dates:** not provided in the dataset; tweets look like 2019 to 2020 (COVID-era text in samples).
- **Duplicates:** 109 exact duplicate rows in train, 11 in test (after lowercasing and removing URLs); 3 texts appear with conflicting labels.
- **Train/test leakage:** 39 test rows (1.6%) have exact text in train; 59 (2.5%) share a template (numbers masked). Small; it could inflate every model's score by at most about 1.6 points, and it affects FinBERT fine-tuned and ours equally.
- **Label quality (10 sampled):** 9 of 10 clearly right; 1 debatable ("U.S. retail sales rise slightly, cast shadow on Q4 economic growth" tagged Bearish). Rough error rate: about 5 to 10% (from 10 samples; wide uncertainty).

## 2. 9B teacher labels (specialist training data)

- **Source:** FNSPID headlines (below), labeled by our Qwen3.5-9B QLoRA (0.924 accuracy on the tweet test set).
- **How labels were made:** model output (logit comparison over Negative/Positive/Neutral). So the label error rate is roughly the 9B's error rate, about 8% on tweets and unknown on headlines.
- **Sizes:** NVDA train 3,132 / held-out 725 / gold 120; DDOG train 348 / gold 100 (no held-out pool); new tonight: AAPL 1,500, MSFT 1,083, AMZN 588, TSLA 1,500, CELH 178, PTON 948, ENPH 893, SMCI 200, WING 179 training headlines (caps in `specialist/prep_more.py`).
- **Balance:** mostly Neutral (about 51 to 77% depending on ticker); Bearish is the smallest class everywhere (MSFT gold has 1 Bearish of 100).
- **Dates:** training headlines before 2023-07-01; held-out and gold from 2023-07-01 to 2023-12-16 (time split).
- **Duplicates:** 0 duplicate texts inside any pool.
- **Leakage (train vs hand-label test set):** NVDA 0 exact and 0 template overlaps; DDOG 0 and 0 (templated rows dropped by design in `prep_data.py`).
- **Label quality:** not reviewed tonight (samples in `audit/samples_teacher.csv`). The hand labels will measure it.

## 3. StockTwits crypto (crypto specialist)

- **Source / license:** Hugging Face `ElKulako/stocktwits-crypto` (license not re-verified tonight; see `crypto/DATA_REVIEW.md`).
- **Size used:** train 239,192, held-out 1,000, test 4,000 (all balanced 50/50 Bullish/Bearish after dropping untagged posts).
- **How labels were made:** the post's author picks Bullish or Bearish when posting (no Neutral option).
- **Dates:** none in the data, so the split is random, not time-based.
- **Duplicates:** exact normalized duplicates and conflicting-label texts were removed before splitting.
- **Leakage:** 0 exact overlaps (asserted); **80 of 4,000 test posts (2%) share a template with training posts**. Same users can appear in train and test (no user IDs), which may flatter the specialist slightly.
- **Label quality (10 sampled):** about 4 of 10 tags do not match the text (for example "let's drop a zero !" tagged Bullish, "doge is dead" tagged Bullish, "here we go fresh 150x" tagged Bearish; some are sarcasm). Rough tag-vs-text mismatch: 30 to 50%. This is why absolute accuracy tops out near 0.69.

## 4. FNSPID (news for the backtest, history panels, and specialist pools)

- **Source / license:** FNSPID Nasdaq news file (`nasdaq_exteral_data.csv`, 21.6 GB); license not re-verified tonight.
- **How used:** headlines filtered to ones that name the company (regex), deduplicated per day.
- **Dates:** ends 2023-12-16; timestamps carry the date only (no time of day), so trades use the next open after the headline date.
- **Sizes (name-matched, broadened backtest set):** NVDA 4,640, TSLA 4,348, AAPL 2,784, MSFT 2,162, AMZN 1,616, DDOG 601.
- **Overlap with the backtest (2022-12-16 to 2023-12-15):** the backtest itself uses the general 2B, which never saw FNSPID, so there's no leakage into the backtest. But the specialist training period (before 2023-07-01) overlaps the backtest year for Dec 2022 to Jun 2023 (for example NVDA 851 headlines, TSLA 1,201). **Never backtest with a specialist on that window.**
- **Coverage gaps:** AMZN has no headlines in the 2022 window (excluded from the broadened backtest). Niche candidates SOFI, UPST, AFRM, ETSY, HOOD, LCID, MRNA, TTD and RIVN have 0 rows in this file (see `results/niche_candidates.json`).

## Not done (needs a follow-up session)

- 20 examples per class with a written judgment for each dataset (samples are saved, judgment covers about 10 per dataset).
- License lines checked against each dataset card tonight.
- Near-duplicate detection beyond the number-masked template rule (for example embedding similarity).
