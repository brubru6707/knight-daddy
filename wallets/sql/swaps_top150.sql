-- All Uniswap V2/V3 swaps in the frozen top-150 pools for one window ({start} to {end}), with:
--   n_swaps_tx: number of Uniswap Swap events (any pool) in the same transaction (single-swap rule)
--   trader: tx from_address if the tx was sent to a public router, else NULL (router-only trader rule)
-- amount0/amount1 follow the V3 sign convention for both versions: positive = the pool received the token.
WITH sw AS (
  SELECT transaction_hash, block_number, block_timestamp, log_index, address AS pool, event_hash, args
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.decoded_events`
  WHERE block_timestamp >= '{start}' AND block_timestamp < '{end}' AND NOT removed
    AND event_hash IN ('0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
                       '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67')
),
per_tx AS (SELECT transaction_hash, COUNT(*) AS n_swaps_tx FROM sw GROUP BY transaction_hash),
rtx AS (
  SELECT transaction_hash, from_address
  FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions_by_to_address`
  WHERE block_timestamp >= '{start}' AND block_timestamp < '{end}'
    AND to_address IN ('0x7a250d5630b4cf539739df2c5dacb4c659f2488d', '0xe592427a0aece92de3edee1f18e0157c05861564',
                       '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b',
                       '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad')
)
SELECT sw.pool, sw.block_number, sw.block_timestamp, sw.log_index, sw.transaction_hash,
  IF(sw.event_hash = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
     SAFE_CAST(JSON_VALUE(sw.args, '$[1]') AS FLOAT64) - SAFE_CAST(JSON_VALUE(sw.args, '$[3]') AS FLOAT64),
     SAFE_CAST(JSON_VALUE(sw.args, '$[2]') AS FLOAT64)) AS amount0,
  IF(sw.event_hash = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
     SAFE_CAST(JSON_VALUE(sw.args, '$[2]') AS FLOAT64) - SAFE_CAST(JSON_VALUE(sw.args, '$[4]') AS FLOAT64),
     SAFE_CAST(JSON_VALUE(sw.args, '$[3]') AS FLOAT64)) AS amount1,
  per_tx.n_swaps_tx,
  rtx.from_address AS trader
FROM sw JOIN per_tx USING (transaction_hash) LEFT JOIN rtx USING (transaction_hash)
WHERE sw.pool IN ({pools})
