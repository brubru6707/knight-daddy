"""Freeze the top 150 qualifying pools by formation (Q1 2023) USD swap volume (PRE_REGISTRATION Amendment 2).

Inputs: $WALLETS_DATA/q1_pool_day_volume.parquet (BigQuery), pools.parquet (factory events), Binance ETHUSDT 1d.
Output: wallets/top150_pools.csv (committed before any test-window data is pulled).
"""
import glob
from pathlib import Path
import pandas as pd
from bq import DATA

WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
STABLES = {"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, "0xdac17f958d2ee523a2206206994597c13d831ec7": 6,
           "0x6b175474e89094c44da98b954eedeac495271d0f": 18}
N = 150


def eth_daily():
    cols = ["open_time", "o", "h", "l", "close"]
    d = pd.concat(pd.read_csv(f, header=None, usecols=range(5), names=cols)
                  for f in sorted(glob.glob(str(DATA / "binance" / "ETHUSDT-1d-2023-0*.csv"))))
    d["day"] = pd.to_datetime(d.open_time, unit="ms").dt.date
    return d.set_index("day").close


def quote_leg(r):
    """Which leg (0 or 1) is the quote asset, its decimals, and whether it is WETH; None if the pool does not qualify."""
    s0, s1 = r.token0 in STABLES, r.token1 in STABLES
    if s0 and s1:
        return None                                  # stablecoin/stablecoin: excluded
    if s0 or s1:                                     # a stablecoin leg is the quote (WETH/stable pools trade WETH)
        leg = 0 if s0 else 1
        return leg, STABLES[r.token0 if s0 else r.token1], False
    if WETH in (r.token0, r.token1):
        return (0 if r.token0 == WETH else 1), 18, True
    return None


if __name__ == "__main__":
    vol = pd.read_parquet(DATA / "q1_pool_day_volume.parquet")
    pools = pd.read_parquet(DATA / "pools.parquet")
    n_all = vol.pool.nunique()
    v = vol.merge(pools, on="pool", how="inner")
    print(f"pools with Q1 swaps: {n_all}; created by the Uniswap factories: {v.pool.nunique()} "
          f"(the rest are forks such as Sushiswap that emit the same event)")
    meta = pools.set_index("pool")
    q = {p: quote_leg(meta.loc[p]) for p in v.pool.unique()}
    v = v[v.pool.map(lambda p: q[p] is not None)].copy()
    print(f"qualifying (quote leg, not stable/stable): {v.pool.nunique()}")
    px = eth_daily()
    v["day"] = pd.to_datetime(v.day).dt.date
    leg = v.pool.map(lambda p: q[p][0]); dec = v.pool.map(lambda p: q[p][1]); is_weth = v.pool.map(lambda p: q[p][2])
    amt = v.abs0.where(leg == 0, v.abs1) / (10.0 ** dec)
    v["usd"] = amt * v.day.map(px).where(is_weth, 1.0)
    assert v.loc[is_weth, "usd"].notna().all(), "missing ETH price for some day"
    agg = v.groupby("pool").agg(usd_volume=("usd", "sum"), n_swaps=("n_swaps", "sum")).reset_index()
    agg = agg.sort_values(["usd_volume", "pool"], ascending=[False, True]).reset_index(drop=True)
    top = agg.head(N).merge(pools, on="pool")
    top["quote_is_weth"] = top.pool.map(lambda p: q[p][2])
    top["traded_token"] = [r.token1 if q[r.pool][0] == 0 else r.token0 for r in top.itertuples()]
    top.insert(0, "rank", range(1, len(top) + 1))
    out = Path(__file__).with_name("top150_pools.csv")
    top[["rank", "pool", "version", "fee_bps", "token0", "token1", "traded_token", "quote_is_weth", "usd_volume",
         "n_swaps", "created_block"]].to_csv(out, index=False)
    share = top.usd_volume.sum() / agg.usd_volume.sum()
    print(f"top {N}: ${top.usd_volume.sum() / 1e9:.1f}B of ${agg.usd_volume.sum() / 1e9:.1f}B qualifying Q1 volume ({share:.1%}); "
          f"{int(top.n_swaps.sum()):,} swaps; cutoff #{N} = ${top.usd_volume.iloc[-1] / 1e6:.1f}M")
    print(top[["rank", "pool", "version", "fee_bps", "traded_token", "usd_volume", "n_swaps"]].head(8).to_string(index=False))
