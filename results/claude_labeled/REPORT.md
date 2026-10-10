# Specialist vs general 2B, scored against a Claude-labeled answer key

**Claude-labeled, not human-labeled.** Claude labeled the answer keys by reading each headline in an interactive session (no API, no external model), using the headline text only. No prediction or pre-label columns were read. The `label` column in the *_to_label.csv inputs was empty. Treat these results as provisional until the human spot check is done (`specialist/labeling/answerkey/spotcheck.csv`).

Answer keys: `specialist/labeling/answerkey/{NVDA,DDOG}_answerkey.csv`
- NVDA (120): 70 Neutral, 35 Bullish, 15 Bearish
- DDOG (100): 47 Bullish, 44 Neutral, 9 Bearish

Scored with `specialist/eval_specialist.py`: 2000 paired bootstrap resamples, seed 0, verdict rule fixed in advance.

| Ticker | Model | Accuracy [95% CI] | Macro F1 [95% CI] |
|---|---|---|---|
| NVDA | General 2B | 0.733 [0.650, 0.808] | 0.610 [0.492, 0.713] |
| NVDA | Specialist 2B | 0.758 [0.683, 0.833] | 0.652 [0.537, 0.759] |
| NVDA | 9B teacher | 0.800 [0.725, 0.867] | 0.699 [0.582, 0.805] |
| DDOG | General 2B | 0.900 [0.840, 0.950] | 0.897 [0.814, 0.957] |
| DDOG | Specialist 2B | 0.910 [0.850, 0.960] | 0.904 [0.820, 0.963] |
| DDOG | 9B teacher | 0.920 [0.860, 0.970] | 0.927 [0.861, 0.972] |

Specialist minus general accuracy:
- NVDA: +0.025, 95% CI [-0.008, +0.067]. McNemar 4 vs 1, p=0.375. **No clear difference.**
- DDOG: +0.010, 95% CI [0.000, +0.030]. McNemar 1 vs 0, p=1.0. **No clear difference.** The CI touches 0.

Runs: NVDA run-20261010-054141 and DDOG run-20261009-183354 (the script's default: newest run with predictions). All 16 NVDA runs with predictions, and the other DDOG run, give identical numbers.

Caveat: Claude and the 9B teacher are both LLMs. Their judgments may be correlated, which could favor the teacher and its distilled specialist. Only human labels remove this bias.
