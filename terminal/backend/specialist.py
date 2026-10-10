"""Specialist training: launch ~/poc1/specialist/train_specialist.py as a subprocess on this GPU, report progress.

One run at a time. Progress comes from <run_dir>/progress.json written by the trainer (no Slurm, no squeue).
A short warmup run at server start fills the on-disk Triton kernel cache (first step: 116 s cold vs 2 s warm).
"""
import asyncio, ctypes, json, os, signal, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

POC = Path(os.path.expanduser(os.getenv("POC_DIR", "~/poc1")))
TRAINER = POC / "specialist" / "train_specialist.py"
DATA = Path(os.path.expanduser(os.getenv("SPECIALIST_DATA", "~/scratch/poc1/specialist")))
RUNS = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/scratch/poc1/terminal"))) / "specialists"
CRYPTO_DATA = Path(os.path.expanduser(os.getenv("CRYPTO_DATA", "~/scratch/poc1/crypto/spec")))
HAND_LABELED = ["NVDA", "DDOG"]  # test set hand-labeled by teammates (the only real score)
TEACHER_ONLY = ["AAPL", "MSFT", "AMZN", "TSLA", "CELH", "PTON", "ENPH", "SMCI", "WING"]  # 9B labels only: agreement, no score
SUPPORTED = HAND_LABELED + TEACHER_ONLY + ["CRYPTO"]  # CRYPTO: StockTwits posts with author tags (Bullish/Bearish only)
TEST_SET = {**{t: "hand" for t in HAND_LABELED}, **{t: "teacher" for t in TEACHER_ONLY}, "CRYPTO": "author_tags"}
NOTES = {"teacher": "No human test set: shows agreement with the 9B model, which is NOT accuracy.",
         "author_tags": "No Neutral class: StockTwits authors tag posts Bullish or Bearish only, so the score is "
                        "binary (P(Bullish) vs P(Bearish)). Reads crypto posts; not a trading signal."}


def _data_dir(t):
    return CRYPTO_DATA if t == "CRYPTO" else DATA
router = APIRouter(prefix="/api/specialist")
_proc = {"p": None, "ticker": None, "run_dir": None, "kind": None}
_standby = {"p": None, "log": None}  # trainer with libraries imported and model loaded, waiting for a run
_standby_lock = threading.Lock()
STANDBY = os.getenv("SPECIALIST_STANDBY", "1") != "0"


def _env():
    e = dict(os.environ, HF_HUB_OFFLINE="1", HF_DATASETS_OFFLINE="1", PYTHONUNBUFFERED="1")
    return e


# PR_SET_PDEATHSIG fires when the *thread* that forked the child exits, not the process. Request threads and
# short-lived helper threads come and go, which silently killed trainers. All children are forked from this one
# long-lived thread instead, so they die only with the server.
_SPAWNER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="spawner")


def _popen(*a, **kw):
    return _SPAWNER.submit(subprocess.Popen, *a, **kw).result()


def _die_with_parent():
    """Runs in the child before exec: Linux sends it SIGTERM if the server process dies (no orphan GPU jobs)."""
    ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, signal.SIGTERM)  # 1 = PR_SET_PDEATHSIG


def stop_training():
    """Called on server shutdown: stop any running trainer (and the standby) so they do not hold the GPU."""
    s = _standby["p"]
    if s is not None and s.poll() is None:
        s.kill()
    p = _proc["p"]
    if p is not None and p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()


def _launch(args, run_dir, ticker, kind):
    run_dir.mkdir(parents=True, exist_ok=True)
    log = open(run_dir / "train.log", "w")
    p = _popen([sys.executable, str(TRAINER), "--run_dir", str(run_dir), *args],
                         stdout=log, stderr=subprocess.STDOUT, env=_env(), cwd=str(TRAINER.parent),
                         preexec_fn=_die_with_parent)
    _proc.update(p=p, ticker=ticker, run_dir=run_dir, kind=kind)
    _respawn_after(p)
    return p


def _respawn_after(p):
    """When a trainer exits, start the next standby right away (no waiting for a status poll)."""
    threading.Thread(target=lambda: (p.wait(), _ensure_standby()), daemon=True).start()


def _running():
    return _proc["p"] is not None and _proc["p"].poll() is None


def _ensure_standby():
    """Keep one preloaded trainer waiting (only while nothing else trains, so it never slows a run)."""
    with _standby_lock:
        if not STANDBY or _running() or (_standby["p"] is not None and _standby["p"].poll() is None):
            return
        d = RUNS / "_standby"
        d.mkdir(parents=True, exist_ok=True)
        for old in sorted(d.glob("standby-*.log"))[:-5]:  # keep the last few logs
            old.unlink(missing_ok=True)
        log = d / time.strftime("standby-%Y%m%d-%H%M%S.log")
        _standby["log"] = log
        _standby["p"] = _popen([sys.executable, str(TRAINER), "--standby", "--run_dir", str(d)],
                                         stdin=subprocess.PIPE, stdout=open(log, "w"), stderr=subprocess.STDOUT,
                                         env=_env(), cwd=str(TRAINER.parent), preexec_fn=_die_with_parent, text=True)


def _launch_run(args, run_dir, ticker, kind):
    """Hand a run to the standby trainer if one exists (model already loaded; same code path otherwise),
    else start a fresh process. Never runs two trainers at once."""
    s = _standby["p"]
    if s is None or s.poll() is not None:
        return _launch(args, run_dir, ticker, kind)
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "train.log").write_text(f"handed to standby trainer pid {s.pid}; its log: {_standby['log']}\n")
    s.stdin.write(json.dumps(["--run_dir", str(run_dir), *args]) + "\n"); s.stdin.flush(); s.stdin.close()
    _standby["p"] = None
    _proc.update(p=s, ticker=ticker, run_dir=run_dir, kind=kind)
    _respawn_after(s)
    return s


def start_warmup():
    """Fill the Triton cache once at server start (3 steps on general data, nothing saved)."""
    if os.getenv("SPECIALIST_WARMUP", "1") == "0" or _running():
        return
    try:
        import torch
        if not torch.cuda.is_available():
            return
    except Exception:
        return
    _launch(["--general_only", "--max_steps", "3", "--no_save"], RUNS / "_warmup", None, "warmup")


def _read_progress(run_dir):
    f = Path(run_dir) / "progress.json"
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text())
    except json.JSONDecodeError:  # mid-replace; caller retries
        return None


def _latest_run(ticker, need_preds=False, include_quick=False):
    """Newest run dir. Quick demo runs (quick-*) are never served or scored, only shown while/after they run."""
    d = RUNS / ticker
    runs = [r for g in (("run-*", "quick-*") if include_quick else ("run-*",)) for r in d.glob(g)
            if not need_preds or (r / "preds_gold.parquet").exists()] if d.exists() else []
    return max(runs, key=lambda r: r.stat().st_mtime) if runs else None


class TrainIn(BaseModel):
    ticker: str
    dry_run: bool = False  # general data only, 20 steps: for testing before teacher labels exist
    quick: bool = False  # QUICK DEMO RUN, not scored: small run for live demos; full mode stays the default


@router.get("/info")
def info():
    rows = {}
    for t in SUPPORTED:
        rows[t] = {"teacher_labels": (_data_dir(t) / f"{t}_train_teacher.parquet").exists(),
                   "test_set": TEST_SET[t], "note": NOTES.get(TEST_SET[t]),
                   "hand_labels": (POC / "specialist" / "labeling" / f"{t}_labeled.csv").exists(),
                   "latest_run": str(_latest_run(t) or "") or None}
    sb = _standby["p"]
    ready = None
    if sb is not None and sb.poll() is None:
        try:
            ready = "ready" if "standby ready" in _standby["log"].read_text() else "loading"
        except OSError:
            ready = "loading"
    return {"supported": SUPPORTED, "tickers": rows, "busy": _running(), "busy_with": _proc["kind"] if _running() else None,
            "standby": ready}


@router.post("/train")
def train(body: TrainIn):
    t = body.ticker.strip().upper()
    if t not in SUPPORTED:
        raise HTTPException(400, f"specialists need prepared training data; available for {SUPPORTED}")
    if _running() and (_read_progress(_proc["run_dir"]) or {}).get("phase") in ("done", "failed"):
        try:  # the last run already wrote its result and is just exiting: give it a moment
            _proc["p"].wait(timeout=15)
        except subprocess.TimeoutExpired:
            pass
    if _running():
        what = "the startup warmup" if _proc["kind"] == "warmup" else f"a {_proc['ticker']} run"
        raise HTTPException(409, f"GPU busy with {what}; try again when it finishes")
    if not body.dry_run and not (_data_dir(t) / f"{t}_train_teacher.parquet").exists():
        raise HTTPException(409, f"no 9B teacher labels for {t} yet (batch job not finished)")
    run_dir = RUNS / t / time.strftime(("quick-" if body.quick else "run-") + "%Y%m%d-%H%M%S")
    args = (["--general_only", "--max_steps", "20", "--no_save"] if body.dry_run
            else ["--ticker", t, "--data_dir", str(_data_dir(t))] + (["--quick"] if body.quick else []))
    if body.dry_run:
        _launch(args, run_dir, t, "dry_run")
    else:
        _launch_run(args, run_dir, t, "quick" if body.quick else "train")
    return {"ticker": t, "run_dir": str(run_dir), "dry_run": body.dry_run, "quick": body.quick}


def _status(ticker):
    _ensure_standby()
    t = ticker.strip().upper()
    run = _proc["run_dir"] if _proc["ticker"] == t and _proc["run_dir"] else _latest_run(t, include_quick=True)
    if not run:
        return {"ticker": t, "phase": "none"}
    prog = _read_progress(run) or {"phase": "starting"}
    alive = _proc["run_dir"] == run and _running()
    if not alive and prog.get("phase") not in ("done", "failed"):
        code = _proc["p"].poll() if _proc["run_dir"] == run and _proc["p"] else None
        prog = {**prog, "phase": "failed", "error": prog.get("error") or f"trainer exited (code {code}); see train.log"}
    quick = Path(run).name.startswith("quick-")
    return {**prog, "run_dir": str(run), "running": alive, "quick": quick,
            "run_label": "QUICK DEMO RUN, not scored" if quick else None}


@router.get("/status")
def status(ticker: str):
    return _status(ticker)


@router.get("/eval")
def eval_run(ticker: str):
    """Before/after scores vs the teammates' hand labels; 'no_human_labels' until the CSV exists."""
    t = ticker.strip().upper()
    run = _latest_run(t, need_preds=True)
    if not run:
        return {"ticker": t, "status": "no_run", "message": "No finished specialist run yet. Press TRAIN."}
    sys.path.insert(0, str(POC / "specialist"))
    from eval_specialist import evaluate
    return evaluate(t, run)


@router.get("/stream")
async def stream(ticker: str):
    """Server-sent events: one JSON status per second until the run is done or failed."""
    async def gen():
        last = None
        for _ in range(60 * 30):
            s = _status(ticker)
            msg = json.dumps(s)
            if msg != last:
                yield f"data: {msg}\n\n"
                last = msg
            if s.get("phase") in ("done", "failed", "none"):
                break
            await asyncio.sleep(1)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
