"""Uniswap V2 pairs and V3 pools created through 2023, from factory events via a keyless public RPC.

Resumable: each factory's logs are appended to $WALLETS_DATA/pools_<v>.jsonl with a checkpoint of the last
block done. Ranges halve on errors. Output: $WALLETS_DATA/pools.parquet
(pool, version, token0, token1, fee_bps, created_block).
Usage: python fetch_pools.py [v2|v3|both]
"""
import json, sys, time
import pandas as pd, requests
from bq import DATA, log_failure

RPC = "https://rpc.mevblocker.io"
END_BLOCK = 18_910_000  # just past the last 2023 block; pools are filtered by swap activity later
FACTORIES = {
    "v2": ("0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9", 10_000_835),
    "v3": ("0x1f98431c8ad98523631ae4a59f267346ea31f984", "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118", 12_369_621),
}
addr = lambda word: "0x" + word[-40:]


def get_logs(address, topic, a, b):
    j = requests.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
                                 "params": [{"address": address, "topics": [topic], "fromBlock": hex(a), "toBlock": hex(b)}]},
                      timeout=60).json()
    if "result" not in j:
        raise RuntimeError(str(j.get("error"))[:200])
    return j["result"]


def fetch(v):
    address, topic, start = FACTORIES[v]
    out, ckpt = DATA / f"pools_{v}.jsonl", DATA / f"pools_{v}.ckpt"
    a = int(ckpt.read_text()) + 1 if ckpt.exists() else start
    span, fails = 20_000, 0
    while a <= END_BLOCK:
        b = min(a + span - 1, END_BLOCK)
        try:
            logs = get_logs(address, topic, a, b)
        except Exception as e:
            fails += 1
            if fails > 8:
                log_failure(f"RPC getLogs {v} blocks {a}-{b}", e)
                raise
            span = max(500, span // 2); time.sleep(2 * fails); continue
        with out.open("a") as f:
            for l in logs:
                t, d = l["topics"], l["data"][2:]
                rec = {"version": v, "token0": addr(t[1]), "token1": addr(t[2]), "created_block": int(l["blockNumber"], 16)}
                if v == "v2":
                    rec.update(pool=addr(d[:64]), fee_bps=30)
                else:
                    rec.update(pool=addr(d[64:128]), fee_bps=int(t[3], 16) // 100)
                f.write(json.dumps(rec) + "\n")
        ckpt.write_text(str(b))
        a, fails = b + 1, 0
        span = min(20_000, span * 2)
        time.sleep(0.25)
    print(v, "done:", sum(1 for _ in out.open()), "pools")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    for v in (["v2", "v3"] if which == "both" else [which]):
        fetch(v)
    frames = [pd.read_json(DATA / f"pools_{v}.jsonl", lines=True) for v in FACTORIES if (DATA / f"pools_{v}.jsonl").exists()]
    df = pd.concat(frames).drop_duplicates("pool")
    df.to_parquet(DATA / "pools.parquet")
    print("pools.parquet:", len(df), "rows;", df.version.value_counts().to_dict())
