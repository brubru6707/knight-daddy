-- Per (pool, UTC day) absolute token0/token1 flow and swap count, Uniswap V2 + V3 Swap events, formation window (Q1 2023).
-- Quote-leg selection and USD conversion are done locally against pools.parquet and Binance daily ETHUSDT.
SELECT
  address AS pool,
  DATE(block_timestamp) AS day,
  COUNT(*) AS n_swaps,
  SUM(IF(event_hash = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
         SAFE_CAST(JSON_VALUE(args, '$[1]') AS FLOAT64) + SAFE_CAST(JSON_VALUE(args, '$[3]') AS FLOAT64),
         ABS(SAFE_CAST(JSON_VALUE(args, '$[2]') AS FLOAT64)))) AS abs0,
  SUM(IF(event_hash = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
         SAFE_CAST(JSON_VALUE(args, '$[2]') AS FLOAT64) + SAFE_CAST(JSON_VALUE(args, '$[4]') AS FLOAT64),
         ABS(SAFE_CAST(JSON_VALUE(args, '$[3]') AS FLOAT64)))) AS abs1
FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.decoded_events`
WHERE block_timestamp >= '2023-01-01' AND block_timestamp < '2023-04-01'
  AND event_hash IN ('0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
                     '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67')
  AND NOT removed
GROUP BY pool, day
