# Deviations from PRE_REGISTRATION.md

Each entry: what changed, why, when, and whether it could bias results. Copied into EXPERIMENT_RESULTS.md.

1. **Swap source: `goog_blockchain_ethereum_mainnet_us.decoded_events` instead of `crypto_ethereum.logs`**
   (2026-10-10, before any pull). Why: a dry run of 2023 swap logs was 395 GB in `crypto_ethereum.logs` and
   207.5 GB in `decoded_events`. Same on-chain events, decoded by Google. Bias: none expected; event
   selection is by the same topic hashes.
2. **Quarterly query chunks** (approved by the requester 2026-10-10). Why: the budget rule allows at most
   100 GB per query. Four quarterly swap queries of about 52 GB each, plus router transactions (28.8 GB) and
   block base fees (0.5 GB): about 237 GB planned against the 500 GB cap. Bias: none; the chunks are merged
   before any analysis.
3. **Pool list from the public Ethereum RPC** (`eth_getLogs` on the two factories, no API key) instead of
   BigQuery (approved 2026-10-10). Why: the factory-event scan was 524 to 1,160 GB in BigQuery. Same events,
   same factory addresses and topic hashes. Bias: none expected; checked by confirming that 2023 swap pools
   are found in the list.
4. **Clarification of "qualifying swap" for prices** (2026-10-10, before any pull). Token prices and the
   sellability and dead-pool checks use **every** swap in a qualifying pool, not only router single-swap
   trades, because bots and aggregators keep prices current. Only the trades that rank and judge wallets
   are restricted to router single-swap transactions.
