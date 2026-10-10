-- Median base fee per UTC day, Q1 + Q2 2023 (gas cost rule: 150,000 x (median base fee + 1 gwei)).
SELECT DATE(block_timestamp) AS day, APPROX_QUANTILES(base_fee_per_gas, 2)[OFFSET(1)] AS median_base_fee_wei, COUNT(*) AS n_blocks
FROM `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.blocks`
WHERE block_timestamp >= '2023-01-01' AND block_timestamp < '2023-07-01'
GROUP BY day
