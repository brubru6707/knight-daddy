"""KNIGHTWATCH terminal backend (FastAPI).

Endpoints (all under /api): health, prices, headlines, classify, sentiment, backtest, benchmarks, replay, replay/available.
Classification runs on the local GPU, or on a remote endpoint (e.g. Modal) if MODEL_ENDPOINT_URL is set.
If neither is available, live headlines come back unlabeled and cached labels are still served.
"""
import glob, json, os, sys, threading, time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent / ".env")
POC = Path(os.path.expanduser(os.getenv("POC_DIR", "~/poc1")))
CACHE = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/scratch/poc1/terminal")))
BT_CACHE = Path(os.path.expanduser(os.getenv("BACKTEST_CACHE", "~/scratch/poc1/backtest")))
ADAPTER = os.path.expanduser(os.getenv("ADAPTER_DIR", "~/poc1/adapters/qwen35-2b"))
MODEL_URL = os.getenv("MODEL_ENDPOINT_URL", "").rstrip("/")
MODEL_TOKEN = os.getenv("MODEL_ENDPOINT_TOKEN", "")
CACHE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(POC / "backtest"))
import backtest as bt  # noqa: E402  (our existing backtest engine)
import news  # noqa: E402  (Finnhub first, yfinance fallback)

app = FastAPI(title="Knight-Daddy")
from specialist import router as specialist_router, start_warmup, stop_training  # noqa: E402
app.include_router(specialist_router)


@app.on_event("startup")
def _warmup_specialist_kernels():
    start_warmup()  # fills the Triton cache so the first Train click does not pay a 2 minute compile


@app.on_event("shutdown")
def _stop_specialist_training():
    stop_training()
_model = None
_label_cache_path = CACHE / "labels.json"
_label_cache = json.loads(_label_cache_path.read_text()) if _label_cache_path.exists() else {}


def _gpu_available():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


_spec_models = {}  # adapter dir -> SentimentModel (specialists, loaded on demand)
# One GPU model operation at a time. Two concurrent from_pretrained calls (e.g. the feed and the briefing on page
# load) corrupt each other ("Cannot copy out of meta tensor"), so creation and use are serialized.
_gpu_lock = threading.Lock()


def classify_specialist(texts, adapter_dir):
    """Labels from a specialist adapter; cached separately from the general model (key: adapter dir + text)."""
    if MODEL_URL or not _gpu_available():
        return [None] * len(texts)
    key = str(adapter_dir)
    with _gpu_lock:
        todo = sorted({t for t in texts if f"{key}::{t}" not in _label_cache})
        if todo:
            if key not in _spec_models:
                from classifier import SentimentModel
                _spec_models.clear()  # keep at most one specialist on the GPU
                _spec_models[key] = SentimentModel(key)
            _label_cache.update({f"{key}::{t}": r for t, r in zip(todo, _spec_models[key].classify(todo))})
            _label_cache_path.write_text(json.dumps(_label_cache))
    return [_label_cache.get(f"{key}::{t}") for t in texts]


def classify(texts):
    """Labels for texts, using the on-disk cache first, then remote endpoint or local GPU."""
    global _model
    todo = sorted({t for t in texts if t not in _label_cache})
    if todo:
        if MODEL_URL:
            h = {"Authorization": f"Bearer {MODEL_TOKEN}"} if MODEL_TOKEN else {}
            r = requests.post(f"{MODEL_URL}/classify", json={"texts": todo}, headers=h, timeout=120)
            r.raise_for_status()
            res = r.json()["results"]
        elif _gpu_available():
            with _gpu_lock:
                todo = sorted({t for t in todo if t not in _label_cache})  # another request may have done them
                if _model is None:
                    from classifier import SentimentModel
                    _model = SentimentModel(ADAPTER)
                res = _model.classify(todo) if todo else []
        else:
            return [_label_cache.get(t) for t in texts]
        _label_cache.update(dict(zip(todo, res)))
        _label_cache_path.write_text(json.dumps(_label_cache))
    return [_label_cache.get(t) for t in texts]


def _ticker(t):
    t = t.strip().upper()
    if not t or len(t) > 10 or not all(c.isalnum() or c in ".-" for c in t):
        raise HTTPException(400, "bad ticker")
    return t


@app.get("/api/health")
def health():
    return {"ok": True, "gpu": _gpu_available(), "model_loaded": _model is not None and _model.loaded,
            "model_endpoint": MODEL_URL or None, "historical_tickers": _historical_tickers(),
            "keys": {k: bool(news.key(k)) for k in ("FINNHUB_API_KEY", "GEMINI_API_KEY", "ELEVENLABS_API_KEY")}}


def _historical_tickers():
    return sorted(Path(p).stem.split("_")[1] for p in glob.glob(str(BT_CACHE / "sentiment_*.parquet")))


@app.get("/api/prices")
def prices(ticker: str, period: str = "1y"):
    t = _ticker(ticker)
    if period not in {"1mo", "3mo", "6mo", "1y", "2y", "5y"}:
        raise HTTPException(400, "bad period")
    f = CACHE / f"prices_{t}_{period}_{datetime.now():%Y%m%d}.parquet"
    if f.exists():
        df = pd.read_parquet(f)
    else:
        import yfinance as yf
        df = yf.download(t, period=period, auto_adjust=True, progress=False)
        if df.empty:
            raise HTTPException(404, f"no price data for {t}")
        df.columns = df.columns.get_level_values(0)
        df.to_parquet(f)
    bars = [{"time": d.strftime("%Y-%m-%d"), "open": r.Open, "high": r.High, "low": r.Low,
             "close": r.Close, "volume": float(r.Volume)} for d, r in df.iterrows()]
    last, first = bars[-1]["close"], bars[0]["close"]
    prev = bars[-2]["close"] if len(bars) > 1 else last
    return {"ticker": t, "period": period, "bars": bars,
            "last": last, "change_1d": last / prev - 1, "change_period": last / first - 1,
            "high": max(b["high"] for b in bars), "low": min(b["low"] for b in bars)}


@app.get("/api/headlines")
def headlines(ticker: str, source: str = "live", limit: int = 60, model: str = "general"):
    t = _ticker(ticker)
    if model not in ("general", "specialist"):
        raise HTTPException(400, "model must be general or specialist")
    if source == "live":
        f = CACHE / f"news2_{t}_{datetime.now():%Y%m%d%H}.json"  # news2: Finnhub results are name-filtered
        cached = json.loads(f.read_text()) if f.exists() else None
        # re-fetch if there is no cache, an old-format cache, or a fallback cache while a Finnhub key now exists
        if not isinstance(cached, dict) or (cached["provider"] != "Finnhub" and news.key("FINNHUB_API_KEY")):
            provider, items, note, fnote = news.live_news(t)
            cached = {"provider": provider, "items": items, "note": note, "filter_note": fnote}
            f.write_text(json.dumps(cached))
        provider, items, note = cached["provider"], cached["items"], cached["note"]
        fnote = cached.get("filter_note")
    elif source == "historical":
        provider, note, fnote = "FNSPID", None, None
        p = BT_CACHE / f"sentiment_{t}.parquet"
        if not p.exists():
            raise HTTPException(404, f"no cached historical headlines for {t}; cached: {_historical_tickers()}")
        df = pd.read_parquet(p).sort_values("ts", ascending=False).head(limit)
        items = [{"title": r.Article_title, "time": r.date_utc, "source": "FNSPID", "url": "",
                  "label": r.label, "p_bear": r.p_bear, "p_bull": r.p_bull, "p_neut": r.p_neut}
                 for r in df.itertuples()]
        if model == "general":
            return {"ticker": t, "source": source, "provider": provider, "model": model, "items": items, "labeled": True}
    else:
        raise HTTPException(400, "source must be live or historical")
    items = items[:limit]
    titles = [i["title"] for i in items]
    general = [{k: i[k] for k in ("label", "p_bear", "p_bull", "p_neut")} for i in items] \
        if items and "label" in items[0] else (classify(titles) if items else [])
    labels, adapter = general, None
    if model == "specialist":
        from specialist import _latest_run
        run = _latest_run(t, need_preds=True)
        if not run or not (run / "adapter").exists():
            raise HTTPException(404, f"no trained specialist for {t} yet")
        adapter = run / "adapter"
        labels = classify_specialist(titles, adapter) if items else []
    for i, lab, gen in zip(items, labels, general):
        if lab:
            i.update(lab)
        if model == "specialist":
            i["general_label"] = gen["label"] if gen else None
    return {"ticker": t, "source": source, "provider": provider, "provider_note": note, "filter_note": fnote, "model": model,
            "items": items, "labeled": all(labels),
            "specialist_run": adapter.parent.name if adapter else None}


@app.get("/api/briefing")
def briefing_endpoint(ticker: str, refresh: bool = False):
    """One-paragraph Gemini summary of today's model-tagged live headlines (no predictions, no advice)."""
    import briefing
    t = _ticker(ticker)
    feed = headlines(t, source="live", limit=60, model="general")
    try:
        res = briefing.generate(t, feed["items"], refresh=refresh)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {**res, "provider": feed["provider"]}


@app.get("/api/briefing/audio")
def briefing_audio(id: str):
    """MP3 of a briefing this server generated (ElevenLabs)."""
    import briefing
    try:
        return FileResponse(briefing.speak(id), media_type="audio/mpeg")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


class ClassifyIn(BaseModel):
    texts: list[str]


@app.post("/api/classify")
def classify_endpoint(body: ClassifyIn):
    if not body.texts or len(body.texts) > 256:
        raise HTTPException(400, "send 1 to 256 texts")
    t0 = time.time()
    res = classify(body.texts)
    if any(r is None for r in res):
        raise HTTPException(503, "no GPU here and no MODEL_ENDPOINT_URL set")
    return {"results": res, "seconds": time.time() - t0}


# ------------------------------------------------------------------------------------------- historical replay
# Real cached FNSPID headlines for one ticker and one UTC date, re-scored by the general model on every request.
# Never uses the label cache or the stored backtest probabilities, never invents a day: dates come only from the
# cached headline files, and a date without headlines returns status "no_data".
REPLAY_DIR = Path(os.path.expanduser(os.getenv("REPLAY_DIR", "~/scratch/poc1/backtest_broad")))
_replay_news = {}


def _replay_frame(t):
    if t not in _replay_news:
        f = REPLAY_DIR / f"news_{t}.parquet"
        if not f.exists():
            return None
        df = pd.read_parquet(f).dropna(subset=["date_utc", "Article_title"])
        df["date"] = pd.to_datetime(df.date_utc).dt.strftime("%Y-%m-%d")
        _replay_news[t] = df
    return _replay_news[t]


def _replay_prices(t):
    f = REPLAY_DIR / f"prices_{t}.parquet"
    return pd.read_parquet(f) if f.exists() else None


def _replay_tickers():
    return sorted(Path(p).stem.split("_", 1)[1] for p in glob.glob(str(REPLAY_DIR / "news_*.parquet")))


def classify_fresh(texts):
    """Model output computed now, bypassing the label cache. Returns (results, device) or (None, reason)."""
    if MODEL_URL:
        h = {"Authorization": f"Bearer {MODEL_TOKEN}"} if MODEL_TOKEN else {}
        r = requests.post(f"{MODEL_URL}/classify", json={"texts": texts}, headers=h, timeout=120)
        r.raise_for_status()
        return r.json()["results"], "remote endpoint"
    if not _gpu_available():
        return None, "no GPU here and no MODEL_ENDPOINT_URL set"
    global _model
    import torch
    with _gpu_lock:
        if _model is None:
            from classifier import SentimentModel
            _model = SentimentModel(ADAPTER)
        return _model.classify(texts), torch.cuda.get_device_name(0)


@app.get("/api/replay/available")
def replay_available(ticker: str | None = None):
    """Every (ticker, date) with at least one real cached headline, with headline counts and price availability."""
    tickers = [_ticker(ticker)] if ticker else _replay_tickers()
    out = {}
    for t in tickers:
        df = _replay_frame(t)
        if df is None:
            continue
        px = _replay_prices(t)
        trading = set(px.index.strftime("%Y-%m-%d")) if px is not None else set()
        counts = df.groupby("date").size().sort_index()
        out[t] = {"n_days": int(len(counts)), "first_date": counts.index[0], "last_date": counts.index[-1],
                  "n_days_with_price": int(sum(d in trading for d in counts.index)),
                  "dates": [{"date": d, "n_headlines": int(n), "has_price": d in trading} for d, n in counts.items()]}
    return {"mode": "historical", "is_live": False, "source": "FNSPID (cached)", "tickers": out}


@app.get("/api/replay")
def replay(ticker: str, date: str):
    """Re-run the general model on the real cached headlines for ticker on date (UTC); historical, never live."""
    t = _ticker(ticker)
    try:
        d = datetime.strptime(date, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    base = {"mode": "historical", "is_live": False, "ticker": t, "date": d, "source": "FNSPID (cached)",
            "date_basis": "headline publication date (UTC); FNSPID has no time of day"}
    df = _replay_frame(t)
    if df is None:
        return {**base, "status": "no_data", "message": f"no cached headlines for {t}; available: {_replay_tickers()}",
                "n_headlines": 0, "items": [], "day": None, "price": None, "price_note": None}
    # price for that trading session (split-adjusted, as cached); null when the market was closed or outside the cache
    px, price, price_note = _replay_prices(t), None, None
    if px is None:
        price_note = "no cached prices for this ticker"
    else:
        idx = list(px.index.strftime("%Y-%m-%d"))
        if d in idx:
            i = idx.index(d); r = px.iloc[i]
            prev = float(px.Close.iloc[i - 1]) if i > 0 else None
            price = {"date": d, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close),
                     "volume": float(r.Volume), "change_1d": (float(r.Close) / prev - 1) if prev else None,
                     "adjusted": True}
        elif idx[0] <= d <= idx[-1]:
            price_note = "no trading session on this date (weekend or market holiday)"
        else:
            price_note = f"outside cached price range {idx[0]} to {idx[-1]}"
    rows = df[df.date == d]
    if rows.empty:
        return {**base, "status": "no_data", "message": f"no cached headlines for {t} on {d}",
                "n_headlines": 0, "items": [], "day": None, "price": price, "price_note": price_note}
    titles = rows.Article_title.tolist()
    t0 = time.time()
    res, device = classify_fresh(titles)
    if res is None:
        return {**base, "status": "model_unavailable", "message": device, "n_headlines": len(titles),
                "items": [{"title": x, "label": None, "p_bearish": None, "p_neutral": None, "p_bullish": None} for x in titles],
                "day": None, "price": price, "price_note": price_note}
    items = [{"title": x, "label": r["label"], "p_bearish": r["p_bear"], "p_neutral": r["p_neut"], "p_bullish": r["p_bull"]}
             for x, r in zip(titles, res)]
    n = len(items)
    counts = {l: sum(i["label"] == l for i in items) for l in ("Bullish", "Bearish", "Neutral")}
    day = {"p_bearish": sum(i["p_bearish"] for i in items) / n, "p_neutral": sum(i["p_neutral"] for i in items) / n,
           "p_bullish": sum(i["p_bullish"] for i in items) / n, "counts": counts,
           "score": (counts["Bullish"] - counts["Bearish"]) / n,
           "aggregation": "p_* are the mean of per-headline probabilities; score = (bullish - bearish) / headlines"}
    return {**base, "status": "ok", "n_headlines": n, "items": items, "day": day, "price": price, "price_note": price_note,
            "model": {"name": "Qwen3.5-2B QLoRA (general)", "adapter": Path(ADAPTER).name, "device": device,
                      "recomputed": True, "label_cache_used": False, "seconds": round(time.time() - t0, 2),
                      "computed_at": datetime.now(timezone.utc).isoformat()}}


@app.get("/api/sentiment")
def sentiment(ticker: str):
    """Daily sentiment score vs price over the backtest window, plus lead/lag correlations."""
    t = _ticker(ticker)
    if not (BT_CACHE / f"sentiment_{t}.parquet").exists():
        raise HTTPException(404, f"historical sentiment only cached for {_historical_tickers()}")
    px = pd.read_parquet(BT_CACHE / f"prices_{t}.parquet").loc[bt.START:bt.END]
    sc = bt.daily_scores(t, list(px.index))
    fwd = px.Open.shift(-1) / px.Open - 1
    prev = px.Close.shift(1) / px.Close.shift(2) - 1
    rows = [{"time": d.strftime("%Y-%m-%d"), "close": float(px.Close[d]),
             "score": None if np.isnan(s) else float(s), "n": int(n)}
            for d, n, s in zip(sc.index, sc.n_headlines, sc.score)]
    # correlation of today's score with returns k days away (negative k = past)
    lags = {k: float(sc.score.corr((px.Close.shift(-k) / px.Close.shift(-k + 1) - 1)))
            for k in range(-3, 4)}
    return {"ticker": t, "start": bt.START, "end": bt.END, "rows": rows,
            "corr_prev_session": float(sc.score.corr(prev)), "corr_next_open_to_open": float(sc.score.corr(fwd)),
            "corr_by_lag": lags}


@app.get("/api/backtest")
def backtest(ticker: str):
    t = _ticker(ticker)
    if not (BT_CACHE / f"sentiment_{t}.parquet").exists():
        raise HTTPException(404, f"backtest needs cached headlines; available: {_historical_tickers()}")
    px, res, curves, rand_eq, diag = bt.run(t)
    days = [d.strftime("%Y-%m-%d") for d in px.index]
    clean = lambda d: {k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in d.items()}
    return {"ticker": t, "start": bt.START, "end": bt.END, "capital": bt.CAPITAL, "slippage": bt.SLIP,
            "threshold": bt.THRESH, "seeds": bt.SEEDS,
            "metrics": {k: clean({kk: float(vv) for kk, vv in v.items()}) for k, v in res.items()},
            "curves": {k: [{"time": d, "value": float(x)} for d, x in zip(days, v)] for k, v in curves.items()},
            "random_band": {"p5": [{"time": d, "value": float(x)} for d, x in zip(days, np.percentile(rand_eq, 5, 0))],
                            "p95": [{"time": d, "value": float(x)} for d, x in zip(days, np.percentile(rand_eq, 95, 0))]},
            "diagnostics": json.loads(json.dumps(diag, default=float))}


@app.get("/api/benchmarks")
def benchmarks():
    keep = {"ProsusAI_finbert": "FinBERT (zero-shot)", "finbert-finetuned": "FinBERT fine-tuned (fair baseline)",
            "qwen35-2b-base-zeroshot": "Qwen3.5-2B base (zero-shot)",
            "qwen35-2b-qlora": "Qwen3.5-2B QLoRA (ours)", "qwen35-9b-qlora": "Qwen3.5-9B QLoRA (ours)"}
    rows = []
    for stem, name in keep.items():
        f = POC / "results" / f"{stem}.json"
        if f.exists():
            m = json.loads(f.read_text())
            rows.append({"model": name, "accuracy": m["accuracy"], "macro_f1": m["macro_f1"],
                         "per_class_f1": m["per_class_f1"], "examples_per_sec": m["examples_per_sec"],
                         "gpu": m.get("gpu", ""), "n": m["n"]})
    crypto = None
    f = POC / "results" / "crypto_specialist.json"
    if f.exists():  # separate test set: StockTwits author tags, Bullish/Bearish only (no Neutral class)
        c = json.loads(f.read_text())
        crypto = {"dataset": c["test_set"], "note": "No Neutral class: binary accuracy, P(Bullish) vs P(Bearish).",
                  "rows": [{"model": m["name"], "binary_accuracy": m["binary_accuracy"], "ci95": m["binary_accuracy_ci95"],
                            "macro_f1": m["binary_macro_f1"], "neutral_rate": m["neutral_rate"]} for m in c["models"].values()]}
    return {"dataset": "zeroshot/twitter-financial-news-sentiment (validation, 2388 tweets)", "rows": rows, "crypto": crypto}


# Serve the built frontend (frontend/dist) on the same port, if it exists.
DIST = HERE.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = (DIST / path).resolve()  # top-level files such as favicon.svg; everything else is the SPA
        if path and f.is_file() and f.is_relative_to(DIST.resolve()):
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
