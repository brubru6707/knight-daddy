"""KNIGHTWATCH Oscar worker: pushes snapshots to the public (Vercel) API and runs Train jobs from it.

Oscar cannot accept inbound connections, so this process only makes outbound HTTPS calls:
  - every --snapshot-every seconds: fetch every URL the frontend uses from our backend (in-process, no server)
    and POST the responses to <api>/api/snapshot
  - every --poll seconds: POST <api>/api/jobs/claim; if a Train job is waiting, run it on this GPU and push
    progress every 3 s, then push fresh snapshots for that ticker.

Runs in the FOREGROUND (Oscar AGENTS.md: no background jobs). Stop it with Ctrl-C.
Config (env or terminal/.env, never committed): KW_API_URL (e.g. https://your-app.vercel.app), KW_PUSH_SECRET.

  python terminal/worker/kw_worker.py                 # run until Ctrl-C
  python terminal/worker/kw_worker.py --once          # push one round of snapshots and exit
  python terminal/worker/kw_worker.py --minutes 30    # stop after 30 minutes
"""
import argparse, os, sys, time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
ENV = {**dotenv_values(HERE.parent / ".env"), **os.environ}

p = argparse.ArgumentParser()
p.add_argument("--api", default=ENV.get("KW_API_URL", ""), help="public site base URL")
p.add_argument("--tickers", default="NVDA,DDOG")
p.add_argument("--snapshot-every", type=int, default=900, help="seconds between snapshot rounds")
p.add_argument("--poll", type=int, default=20, help="seconds between job checks (each check costs ~2 Upstash commands)")
p.add_argument("--once", action="store_true", help="push one round of snapshots and exit")
p.add_argument("--minutes", type=float, default=None, help="stop after this many minutes")
args = p.parse_args()
API = args.api.rstrip("/")
SECRET = ENV.get("KW_PUSH_SECRET", "")
if not API or not SECRET:
    sys.exit("Set KW_API_URL and KW_PUSH_SECRET (env or terminal/.env).")
TICKERS = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
HDR = {"x-kw-secret": SECRET, "content-type": "application/json"}


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def remote(path, payload):
    r = requests.post(f"{API}/api/{path}", json=payload, headers=HDR, timeout=60)
    if r.status_code == 401:
        sys.exit("Public API rejected the push secret (401). Check KW_PUSH_SECRET matches the Vercel env var.")
    r.raise_for_status()
    return r.json()


def urls_for(client, t):
    u = [f"prices?ticker={t}&period={per}" for per in ("3mo", "6mo", "1y", "2y")]
    models = ["general"]
    if client.get(f"/api/specialist/status?ticker={t}").json().get("phase") == "done":
        models.append("specialist")
    u += [f"headlines?ticker={t}&source={s}&limit=40&model={m}" for s in ("live", "historical") for m in models]
    u += [f"sentiment?ticker={t}", f"backtest?ticker={t}", f"briefing?ticker={t}",
          f"specialist/status?ticker={t}", f"specialist/eval?ticker={t}"]
    return u


def push_snapshots(client, tickers, include_global=True):
    t0 = time.time()
    groups = ([("global", ["health", "benchmarks", "specialist/info"])] if include_global else []) + \
             [(t, urls_for(client, t)) for t in tickers]
    total = 0
    for name, urls in groups:
        items = []
        for u in urls:
            try:
                r = client.get(f"/api/{u}")
                items.append({"path": u, "status": r.status_code, "body": r.json()})
            except Exception as e:  # one bad endpoint should not stop the round
                items.append({"path": u, "status": 500, "body": {"detail": f"worker error: {e}"}})
        res = remote("snapshot", {"items": items, "tickers": TICKERS,
                                  "pushed_at": datetime.now(timezone.utc).isoformat()})
        total += res["stored"]
        bad = [f"{i['path']} {i['status']}" for i in items if i["status"] >= 400]
        log(f"pushed {name}: {res['stored']} snapshots (store: {res['store']})" + (f"; non-200: {bad}" if bad else ""))
    log(f"snapshot round done: {total} items in {time.time() - t0:.0f}s")


def run_job(client, job):
    t = job["ticker"]
    log(f"job {job['id'][:8]}: train {t}")
    deadline = time.time() + 120
    while True:  # the local GPU can be briefly busy (e.g. startup warmup); wait up to 2 min before giving up
        r = client.post("/api/specialist/train", json={"ticker": t})
        if r.status_code != 409 or time.time() > deadline:
            break
        remote("jobs/progress", {"id": job["id"], "progress": {"phase": "waiting for GPU", "step": 0, "losses": []}})
        time.sleep(5)
    if r.status_code != 200:
        detail = r.json().get("detail", r.text)
        log(f"job refused locally: {detail}")
        return remote("jobs/finish", {"id": job["id"], "status": "failed", "error": detail})
    last = None
    while True:
        st = client.get(f"/api/specialist/status?ticker={t}").json()
        if st != last:
            remote("jobs/progress", {"id": job["id"], "progress": st})
            last = st
        if st.get("phase") in ("done", "failed"):
            break
        time.sleep(3)
    remote("jobs/finish", {"id": job["id"], "status": st["phase"], "error": st.get("error"), "progress": st})
    log(f"job {job['id'][:8]}: {st['phase']} in {st.get('elapsed_s')}s")
    push_snapshots(client, [t])


def main():
    from fastapi.testclient import TestClient
    import app as backend
    stop_at = time.time() + args.minutes * 60 if args.minutes else None
    log(f"worker starting: api={API} tickers={TICKERS}")
    with TestClient(backend.app) as client:   # runs the backend's startup (kernel warmup) in this process
        push_snapshots(client, TICKERS)
        if args.once:
            return
        next_snap = time.time() + args.snapshot_every
        while not stop_at or time.time() < stop_at:
            try:
                # never claim a job while our own GPU is busy (startup warmup or another run)
                if not client.get("/api/specialist/info").json().get("busy"):
                    job = remote("jobs/claim", {}).get("job")
                    if job:
                        run_job(client, job)
                if time.time() >= next_snap:
                    push_snapshots(client, TICKERS)
                    next_snap = time.time() + args.snapshot_every
            except requests.RequestException as e:
                log(f"network error (will retry): {e}")
            time.sleep(args.poll)
        log("time limit reached, exiting")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped")
