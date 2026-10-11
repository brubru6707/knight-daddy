# Headline test set: pre-registration amendments

## Amendment 1, 2026-10-11 02:03 UTC (before any new headline is fetched, labeled, or any model is scored)

- Original plan: 150 Finnhub general-news headlines, crypto category, mentioning BTC/ETH/SOL.
- Amendment A (approved by the user earlier): widen to any Finnhub crypto-category headline about crypto markets.
  Reason: only 35 BTC/ETH/SOL headlines were available.
- Amendment B (this entry, requested by the user): add the public RSS feeds of CoinDesk, Cointelegraph and Decrypt
  next to Finnhub, to reach 150 faster. Same rules for all sources: one headline per story (exact and near-duplicates
  removed across sources, earliest kept), off-topic items excluded, labels Bullish/Bearish/Neutral from the headline
  text only, by Claude, before any model output is seen.
- Unchanged: the decision rule (new model must beat the general 2B on the headline set with the accuracy-difference
  95% CI excluding 0), the minimum of 150 headlines, the metrics, and the post test set.
- No model has been scored on any headline at the time of this entry.

## Amendment 2, 2026-10-11 02:04 UTC (before fetching these sources; no model scored on any headline yet)

- After Amendment 1 the set had 81 headlines (Finnhub had nothing new; most CoinDesk/Cointelegraph RSS items repeat
  Finnhub stories). To reach 150, add more free crypto news RSS feeds: The Block, Bitcoin Magazine, CryptoSlate,
  CryptoPotato, NewsBTC, Bitcoinist, U.Today, crypto.news. Same rules as Amendment 1.
- Recency window: items published in the 7 days before the newest item in the pool (keeps the set current).
- Dedupe rule clarified: a story already in the set keeps its existing row; later copies from any source are excluded.
- Some of these outlets publish price-prediction and promotional pieces; those are labeled like any other headline
  (from the text), and sponsored/press-release items are excluded as off-topic.

## Freeze, 2026-10-11 02:07 UTC (before the training job is submitted; no model scored on any headline)

- Headline test set frozen at 231 rows (all labeled, kept headlines; none dropped to hit exactly 150).
  Labels: Neutral 92, Bullish 76, Bearish 63. Sources: UToday 81, CoinDesk 37, Cointelegraph 32, crypto.news 23,
  CryptoPotato 21, Decrypt 12, The Block 7, CryptoSlate 6, Bitcoinist 5, NewsBTC 4, Bitcoin Magazine 3.
- Files: crypto/headlines/labels_round{1,2,3}.txt, headlines_test.csv. Decision rule unchanged.
