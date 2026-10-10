"""Specialist training: launch ~/poc1/specialist/train_specialist.py as a subprocess on this GPU, report progress.

One run at a time. Progress comes from <run_dir>/progress.json written by the trainer (no Slurm, no squeue).
A short warmup run at server start fills the on-disk Triton kernel cache (first step: 116 s cold vs 2 s warm).
"""
import asyncio, ctypes, json, os, signal, subprocess, sys, time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

POC = Path(os.path.expanduser(os.getenv("POC_DIR", "~/poc1")))
TRAINER = POC / "specialist" / "train_specialist.py"
DATA = Path(os.path.expanduser(os.getenv("SPECIALIST_DATA", "~/scratch/poc1/specialist")))
RUNS = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/scratch/poc1/terminal"))) / "specialists"
SUPPORTED = ["NVDA", "DDOG"]  # tickers with a hand-label test set prepared
router = APIRouter(prefix="/api/specialist")
_proc = {"p": None, "ticker": None, "run_dir": None, "kind": None}


def _env():
    e = dict(os.environ, HF_HUB_OFFLINE="1", HF_DATASETS_OFFLINE="1", PYTHONUNBUFFERED="1")
    return e


def _die_with_parent():
    """Runs in the child before exec: Linux sends it SIGTERM if the server process dies (no orphan GPU jobs)."""
    ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, signal.SIGTERM)  # 1 = PR_SET_PDEATHSIG


def stop_training():
    """Called on server shutdown: stop any running trainer so it does not hold the GPU."""
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
    p = subprocess.Popen([sys.executable, str(TRAINER), "--run_dir", str(run_dir), *args],
                         stdout=log, stderr=subprocess.STDOUT, env=_env(), cwd=str(TRAINER.parent),
                         preexec_fn=_die_with_parent)
    _proc.update(p=p, ticker=ticker, run_dir=run_dir, kind=kind)
    return p


def _running():
    return _proc["p"] is not None and _proc["p"].poll() is None


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


def _latest_run(ticker, need_preds=False):
    d = RUNS / ticker
    runs = [r for r in d.glob("run-*") if not need_preds or (r / "preds_gold.parquet").exists()] if d.exists() else []
    return max(runs, key=lambda r: r.stat().st_mtime) if runs else None


class TrainIn(BaseModel):
    ticker: str
    dry_run: bool = False  # general data only, 20 steps: for testing before teacher labels exist


@router.get("/info")
def info():
    rows = {}
    for t in SUPPORTED:
        rows[t] = {"teacher_labels": (DATA / f"{t}_train_teacher.parquet").exists(),
                   "hand_labels": (POC / "specialist" / "labeling" / f"{t}_labeled.csv").exists(),
                   "latest_run": str(_latest_run(t) or "") or None}
    return {"supported": SUPPORTED, "tickers": rows, "busy": _running(), "busy_with": _proc["kind"] if _running() else None}


@router.post("/train")
def train(body: TrainIn):
    t = body.ticker.strip().upper()
    if t not in SUPPORTED:
        raise HTTPException(400, f"specialists need a hand-labeled test set; available for {SUPPORTED}")
    if _running():
        what = "the startup warmup" if _proc["kind"] == "warmup" else f"a {_proc['ticker']} run"
        raise HTTPException(409, f"GPU busy with {what}; try again when it finishes")
    if not body.dry_run and not (DATA / f"{t}_train_teacher.parquet").exists():
        raise HTTPException(409, f"no 9B teacher labels for {t} yet (batch job not finished)")
    run_dir = RUNS / t / time.strftime("run-%Y%m%d-%H%M%S")
    args = ["--general_only", "--max_steps", "20", "--no_save"] if body.dry_run else ["--ticker", t]
    _launch(args, run_dir, t, "dry_run" if body.dry_run else "train")
    return {"ticker": t, "run_dir": str(run_dir), "dry_run": body.dry_run}


def _status(ticker):
    t = ticker.strip().upper()
    run = _proc["run_dir"] if _proc["ticker"] == t and _proc["run_dir"] else _latest_run(t)
    if not run:
        return {"ticker": t, "phase": "none"}
    prog = _read_progress(run) or {"phase": "starting"}
    alive = _proc["run_dir"] == run and _running()
    if not alive and prog.get("phase") not in ("done", "failed"):
        code = _proc["p"].poll() if _proc["run_dir"] == run and _proc["p"] else None
        prog = {**prog, "phase": "failed", "error": prog.get("error") or f"trainer exited (code {code}); see train.log"}
    return {**prog, "run_dir": str(run), "running": alive}


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
