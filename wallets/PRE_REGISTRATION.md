# Pre-registration: do profitable crypto wallets keep winning, and can you copy them?

Committed before any return, PnL, or price series is computed. Any later change is listed under
"Deviations" in EXPERIMENT_RESULTS.md with the reason. Nothing is changed silently.

## Questions

1. **Persistence.** Does a wallet's formation-window rank predict its test-window performance?
2. **Copy-trading.** Does copying the formation winners' test-window buys, with realistic delay and costs,
   beat simple baselines?

## Data

- Source: Google BigQuery public dataset `bigquery-public-data.crypto_ethereum` (`logs`, `transactions`,
  `blocks`), free sandbox. ETH and BTC prices: Binance public minute klines (ETHUSDT, BTCUSDT) from
  data.binance.vision. No paid sources.
- Budget guard: every query is dry-run first and run with `maximum_bytes_billed`. Stop and ask if a single
  query exceeds 100 GB or the running total exceeds 500 GB.
- Addresses stay pseudonymous. No ENS lookups, labeling services, or attempts to identify owners.
- All times UTC.

## Windows

- **Formation:** 2023-01-01 00:00:00 to 2023-06-30 23:59:59. Used only to filter and rank wallets.
- **Test:** 2023-07-01 00:00:00 to 2023-12-31 23:59:59. Never used to choose, filter, or rank wallets.

## Trades

- Venues (topic hashes computed as Keccak-256 of the event signatures):
  - Uniswap V2: `Swap(address,uint256,uint256,uint256,uint256,address)` =
    `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822`. Pools come from factory
    `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` `PairCreated(address,address,address,uint256)` =
    `0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9`. Fee 0.30%.
  - Uniswap V3: `Swap(address,address,int256,int256,uint160,uint128,int24)` =
    `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`. Pools come from factory
    `0x1F98431c8aD98523631AE4a59f267346ea31F984` `PoolCreated(address,address,uint24,int24,address)` =
    `0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118`. Fee tier from that event.
  - Swaps are counted only from pools created by these two factories.
- Quote assets: WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, USDC
  `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`,
  DAI `0x6B175474E89094C44Da98b954EedeAC495271d0F`. A pool qualifies if at least one leg is a quote asset. The other leg
  is the traded token; in WETH/stablecoin pools the traded token is WETH. Pools with two stablecoins are
  excluded. Stablecoins are valued at $1; WETH at the Binance ETHUSDT close of that minute.
- Trader: the transaction's `from_address`, kept only when the transaction's `to_address` is one of these
  public routers: Uniswap V2 Router02 `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`, V3 SwapRouter
  `0xE592427A0AEce92De3Edee1F18E0157C05861564`, SwapRouter02 `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`,
  Universal Router `0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B` and `0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD`.
  Transaction senders are externally owned accounts, so contracts are excluded by construction, and bots
  that call their own contracts are excluded by the router rule.
- One trade = one transaction with exactly one qualifying swap event. Transactions with two or more swap
  events (multi-hop routes, arbitrage) are dropped. Known limitation: this also drops legitimate multi-hop
  trades.
- Direction: **buy** if the trader received the token and paid the quote asset; **sell** otherwise.
- Token price at time t: the execution price of the most recent qualifying swap in the same pool at or
  before t. A token whose pool has had no swap for more than 7 days at a valuation time is valued at **0**
  (conservative treatment of rugs and dead pools).

## Wallet filter (formation window only)

A wallet is eligible if all of these hold:
1. At least **10** trades in formation.
2. At least **$1,000** total buy volume in formation (removes dust).
3. No **same-block round trip**: never bought and sold the same token in the same block.
4. Never more than **50 trades in one UTC day**.

## Ranking

- Accounting: average cost per (wallet, token), starting from zero inventory at the window start. Sells
  beyond inventory held from that window are ignored.
- **Formation ROI** = (realized PnL + unrealized PnL marked at the window end) / total USD buy volume in
  the window. This is the ranking metric.
- **Winners:** top 10% of eligible wallets by formation ROI. **Losers:** bottom 10%. Deciles are used for
  Test A.
- Secondary, reported but never used for decisions: formation PnL in USD.

## Survivorship

Every eligible wallet stays in the test sample whatever it does next. A wallet with no test-window trades
has test ROI 0 (it held cash). Blow-ups count at marked value, including the 7-day dead-pool rule. No
wallet is dropped for poor or missing test-window activity.

## Test A: persistence

- **Test ROI** uses the same accounting on test-window trades only, starting from zero inventory at
  2023-07-01 and marked at 2023-12-31.
- Spearman rank correlation of formation ROI vs test ROI over all eligible wallets, with a 95% CI from
  2,000 wallet bootstrap resamples (seed 0).
- Top-decile minus bottom-decile mean test ROI, with a 95% bootstrap CI (same resamples). The median is
  also reported.
- **Persistence holds** if both the Spearman CI and the top-minus-bottom CI are entirely above 0.

## Test B: copy-trading

- Signals: every buy by a winner in the test window.
- **Entry:** the copier sees the winner's transaction and buys the same token in the same pool at the
  execution price of the first swap in that pool at least **1 block later** (primary). Robustness check:
  the first swap at least **60 seconds** later. If no swap occurs within 1 hour, the signal is skipped.
- **Exit:** at the first swap in that pool at least 1 block after the winner's next sell of that token;
  otherwise after 30 days; otherwise at 2023-12-31 23:59:59, whichever comes first. The 7-day dead-pool
  rule applies at exit.
- **Size:** $1,000 per copied buy.
- **Costs per side:** pool fee (0.30% for V2, the fee tier for V3), plus slippage of **0.3% (primary)**
  or **1% (stress)**, plus gas of 150,000 × (that day's median base fee + 1 gwei) priced at ETH/USD.
- **Bankroll:** $1,000 × the peak number of concurrent open positions. Idle cash earns 0. The daily
  strategy return is that day's marked-to-market P&L divided by the bankroll.
- Benchmarks: buy-and-hold ETH and BTC with the same bankroll, 2023-07-01 to 2023-12-31, one entry and
  one exit, each paying 0.1% fee plus the same slippage scenario.

### Baselines

- **Random wallets (100 draws, seeds 0-99):** for each winner, draw a random eligible non-winner whose
  test-window buy count is within ±20% of the winner's (closest match if none qualify). Copy them with
  identical rules.
- **Random direction (100 seeds, seeds 0-99):** same signals, timing and costs, but each copied trade is
  long or short with probability 0.5. A short earns the negative of the long's price move and pays the
  same costs.

### Win rule (all must hold, primary scenario: next block, 0.3% slippage)

1. Total net return beats buy-and-hold ETH **and** buy-and-hold BTC over the test window.
2. Beats at least 95 of the 100 random-wallet baselines on total net return.
3. Beats at least 95 of the 100 random-direction seeds on total net return.
4. The 95% CI of the mean daily net return, from a bootstrap clustered by ISO week (2,000 resamples,
   seed 0), is entirely above 0.
5. Total net return is still positive at **1% slippage**.

If any condition fails, the copy strategy is reported as **not beating the baselines**. Partial passes are
reported as they are and never upgraded.

## Stress tests (only if the win rule passes)

The result is called robust only if total net return stays positive and above buy-and-hold ETH after each
of these:
- dropping the single winner wallet that contributes the most P&L
- dropping the single token that contributes the most P&L
- dropping the single best week
- the 60-second-delay entry

## Amendment 1 (2026-10-10, before any data pull or return computation): whales and scams

Added at the requester's instruction ("also look at whales and scams"). Committed before any swap, price, or
return data was downloaded.

### Scams (these change which trades and holdings count, in both windows)
- **Unsellable tokens (honeypots):** a holding is marked at the pool price only if some other wallet made a
  successful sell of that token in that pool within the previous 7 days. Otherwise it is valued at **0**.
  This applies to formation ranking and to test-window valuation, so paper gains in tokens nobody can sell
  never make a wallet a winner.
- **Thin or manipulable pools:** trades in pools with fewer than **10 distinct traders** in that window are
  excluded. Formation counts decide formation, test counts decide test; test data never picks wallets.
- **Look-alike tokens:** tokens are identified by contract address only, never by symbol, so a fake token
  with a famous name is a separate token.
- **Rugs, reported:** a token is flagged *rug* if its price falls at least 90% within any 24 hours. The
  report gives the share of winners' formation PnL and of copy-strategy PnL that comes from rug-flagged
  tokens. The 7-day dead-pool rule above still applies.
- **New launches, reported:** a copied buy is a *new launch* if its pool was created less than 7 days
  earlier. The report gives the share of copy PnL from new launches.

### Whales (reported; the win rule above is unchanged)
- **Whale** = top 1% of eligible wallets by formation USD buy volume.
- Concentration: share of winners' test PnL and of copy-strategy PnL from the top 1 and top 5 wallets.
- Test A repeated within formation buy-volume terciles (small, mid, large), plus whales only.
- Copy strategy also reported with whales excluded and with whales only.
- The copier always trades $1,000 per signal, whatever the whale traded, and cannot reproduce a whale's own
  market impact. The slippage scenarios are the only cost adjustment for this.

### Added stress tests (if the win rule passes)
In addition to the stress tests above, the result is robust only if total net return stays positive and above
buy-and-hold ETH after each of these: excluding all whales, excluding rug-flagged tokens, and excluding
new-launch buys.

## Amendment 2 (2026-10-10, before any swap data pull or return computation): narrower scope

Requested to save sandbox budget. No swap, price, or return data had been pulled or computed when this was
committed; only the factory pool list (no prices or trades) existed. Everything above stays, except:

1. **Windows.** Formation = **Q1 2023** (2023-01-01 00:00:00 to 2023-03-31 23:59:59 UTC). Test = **Q2 2023**
   (2023-04-01 00:00:00 to 2023-06-30 23:59:59 UTC). The H2 2023 window is dropped. Every rule that names the
   formation or test window, or the test-window end, uses these dates. Buy-and-hold ETH and BTC run over Q2 2023.
2. **Pools.** Only the **top 150 qualifying pools by formation-window swap volume** are used for everything
   downstream: trades, prices, the sellability and dead-pool checks, wallet filters, ranking, both tests, and
   baselines.
   - A qualifying pool is one created by the two factories, with at least one quote-asset leg, and not
     stablecoin/stablecoin, exactly as in "Trades".
   - **Volume** = the sum over formation-window swaps of the USD value of the quote leg. Stablecoins count at
     $1; WETH counts at that UTC day's Binance ETHUSDT daily close. Ties are broken by pool address.
   - The list is chosen from formation data only and frozen before any test-window swap is pulled.
3. **Unchanged:** the router-only trader rule, the single-swap rule and bot filters, at least 10 formation
   trades, at least $1,000 formation buy volume, top 10% by formation ROI, survivorship, Amendment 1 (whales,
   scams), Tests A and B with their costs and baselines, the five-part win rule, and the stress tests.

**Effect on interpretation (stated before seeing data):** the universe is now the most liquid pools only,
mostly ETH, stablecoins and large tokens. Trades and copy returns in long-tail, new-launch and scam tokens are
outside this test; the scam rules from Amendment 1 will rarely trigger. Tokens launched after Q1 (for example
in April 2023) cannot be in the pool list. A negative result therefore says "no edge in copying wallets in
liquid Uniswap pools in Q2 2023", not "no edge anywhere". Shorter windows mean fewer trades per wallet and less
statistical power.

## Reporting

EXPERIMENT_RESULTS.md reports all numbers above, with sample sizes at each filter stage, the bytes
scanned per query, any deviations, and negatives stated plainly.
