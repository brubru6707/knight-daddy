# Crypto sentiment data review (Step 1)

Searched Hugging Face on 2026-10-09 (queries: crypto/cryptocurrency/bitcoin sentiment, news, tweets, stocktwits,
cryptobert). Read every candidate's card; streamed rows or downloaded files to check columns, labels and dates.
Raw copies: `~/scratch/poc1/crypto/raw/`, cards: `~/scratch/poc1/crypto/cards/`.

## Top 3

| | ElKulako/stocktwits-crypto | Myashka/CryptoNews | flowfree/crypto-news-headlines |
|---|---|---|---|
| Text | StockTwits posts (short, slangy, cashtags stripped) | Telegram 696, Reddit 258, news aggregators 197 | news headline + first sentence |
| Size | 1,331,697 posts (5.7% repeated texts; 4,435 texts with conflicting labels) | 1,151 | 1,035 (518 / 260 / 257 given splits) |
| Labels | 0 Bearish 124,451 / 1 Neutral 530,545 / 2 Bullish 676,701 | Bearish 309 / Neutral 232 / Bullish 610 (+ "complexity" 1 to 3) | negative 350 / neutral 335 / positive 350 |
| How labeled | **Human, by the post's author**: StockTwits users tag their own posts Bullish or Bearish (CryptoBERT card confirms the scheme). "Neutral" is not defined anywhere; samples suggest it means **untagged** (e.g. "just bought 1,350 i'm accumulating" is label 1). | **Unknown.** Empty card; author's other work gives no hint. Could be hand or LLM labels. | **Unknown.** Minimal card, no paper; perfectly balanced classes suggest curated sampling. |
| Lexicon or price-derived? | Neither | Not stated | Not stated |
| Dates | Nov 2021 to Jun 2022 overall; **no per-post dates** (no time split possible) | **Jan 24 to Feb 25, 2024 per post** (time split possible) | none |
| License | MIT (content is StockTwits posts) | MIT | not stated |
| Map to ours | 0 Bearish, 2 Bullish, 1 Neutral (= untagged) | direct | negative Bearish, neutral Neutral, positive Bullish |

## Rejected

| Dataset | Reason |
|---|---|
| cvnberk/bitcoin_tweets_sentiment_kaggle (and hira98607 copy) | "automated sentiment analysis tools" |
| Andyrasika/alpaca-bitcoin-sentiment-dataset | no card; labels look lexicon-made ("Bitcoin wasn't built to live on exchanges" = Positive) |
| cogneolabs/Cogneo-Crypto-Sentiment | model-predicted labels with confidence scores ("Bullish (77.9%)") |
| StephanAkkerman/financial-tweets-crypto | sentiment source undocumented; same bot format as Cogneo's model labels |
| StephanAkkerman/crypto-stock-tweets | unlabeled pretraining corpus |
| maryamfakhari/CryptoNewsImpact | LLM-annotated, and labels are expected price impact |
| HiyawErtiro/bitcoin-news-sentiments(-latest) | relabeled by "likely effect on price" with an LLM |
| SahandNZ/cryptonews-articles-with-price-momentum-labels | labels from price momentum |
| danilocorsi/LLMs-Sentiment-Augmented-Bitcoin-Dataset | LLM annotations for trading |
| aaurelions/cryptocurrency-tweets-sentiment | synthetic (distilabel / LLM) |

## Caveats that affect the gate test

- StockTwits labels are the author's stance, not the text's tone, and "Neutral" likely means "no tag". A general
  model judging text tone will disagree with "untagged" often, which would look like a gap but is really a label
  definition mismatch. A fairer human-label test uses only tagged posts (Bullish vs Bearish).
- Myashka and flowfree have the right 3-class scheme but undocumented labels; treat any result on them as secondary.
