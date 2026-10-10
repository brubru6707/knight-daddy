# Labeling guide: NVDA and DDOG headlines

These labels are the **test set** for the "stock-specific news analyst". They are the only human ground truth
we have, so careful labels matter more than fast ones.

## Files

- `NVDA_to_label.csv` (120 rows) and `DDOG_to_label.csv` (100 rows)
- Fill in the `label` column only. Do not edit, sort, or delete rows. Save as CSV.
- NVDA has 120 rows so that about 100 remain after Skips. Label all of them.

## Labels (type exactly one of these)

| Label | Meaning |
|---|---|
| **Bearish** | Reads as bad news for this company's stock: downgrade, miss, price drop, lawsuit, lost customer, export ban. |
| **Bullish** | Reads as good news for this company's stock: upgrade, beat, price rise, new customer, product win, raised target. |
| **Neutral** | Factual or mixed, with no clear lean: event announcements, lists of stocks, questions, how-to articles. |
| **Skip** | Not really about this company (it is only mentioned in passing), or you cannot tell what it means. |

## Examples (made up, not from the files)

| Headline | Label |
|---|---|
| Nvidia shares slide after report of new chip export limits | Bearish |
| Datadog cut to Underperform at Big Bank on slowing cloud spend | Bearish |
| Nvidia beats estimates and raises guidance on data center demand | Bullish |
| Datadog wins multi-year contract with major airline | Bullish |
| Nvidia to present at investor conference next Tuesday | Neutral |
| 3 Software Stocks to Watch This Week: Datadog, Okta and Zscaler | Neutral |

## Rules

1. **Judge the headline for the named company only** (Nvidia in the NVDA file, Datadog in the DDOG file).
   If it is about another company and ours only appears in a list, use Neutral, or Skip if ours is barely relevant.
2. **Use only the headline.** Do not look up the article, the date's price move, or what happened next.
3. **Questions and opinion pieces:** label the lean if it is clear ("Is Nvidia's rally just getting started?" is Bullish),
   otherwise Neutral.
4. **When torn between Neutral and a direction, pick Neutral.**
5. **Label alone, and do not compare answers until everyone is done.** If two people label the same file, keep both
   copies (e.g. `NVDA_labeled_alex.csv`, `NVDA_labeled_sam.csv`); disagreement tells us how hard the task is.

When done, put the files back in `~/poc1/specialist/labeling/` named `NVDA_labeled.csv` and `DDOG_labeled.csv`.
