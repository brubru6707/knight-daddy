# KNIGHTWATCH

A terminal-style stock research dashboard built for Hack Knight (finance track). It tags financial news with our
own fine-tuned sentiment model (Qwen3.5-2B, QLoRA), shows that sentiment next to price, and tests honestly whether
news sentiment can be traded. Short answer: our model reads financial news much better than FinBERT, but news
sentiment lags price, so it is not a free trading signal.

## Benchmark

Held-out validation split of `zeroshot/twitter-financial-news-sentiment` (2,388 tweets, 3 classes).

| Model | Accuracy | Macro F1 | Speed (headlines/s) |
|---|---|---|---|
| FinBERT (ProsusAI/finbert), zero-shot | 0.725 | 0.668 | 1063 |
| Qwen3.5-2B base, zero-shot | 0.391 | 0.400 | 154 |
| **Qwen3.5-2B QLoRA, 1 epoch (ours, serves the dashboard)** | **0.919** | **0.895** | 106 |
| Qwen3.5-9B QLoRA, 1 epoch (ours) | 0.924 | 0.904 | 29 |

Training the 2B takes about 8 minutes on one RTX 3090. Speeds are GPU eval throughput (the 9B ran on an A5000).

## Backtest finding

$10,000 per stock, 2022-12-16 to 2023-12-15, long when daily headline sentiment is bullish, cash when bearish,
trades at the next open with 0.05% slippage, no lookahead.

| | NVDA return | DDOG return |
|---|---|---|
| Sentiment strategy | +96.5% | +18.0% |
| Buy and hold | **+189.9%** | **+57.3%** |
| Random timing (mean of 100) | +89.6% | +33.2% |

The strategy lost to buy and hold on both stocks and beat only 57 and 41 of 100 random-timing runs. Daily sentiment
correlates +0.33 with the previous day's return and about 0 with any later day: headlines describe moves that
already happened. Details: `backtest/RESULTS.md`.

## Dashboard panels

Price chart, live headline feed tagged by our model (Finnhub company news, Yahoo fallback), Gemini news briefing
with ElevenLabs read-aloud, sentiment vs price with the lead/lag finding, backtest, model benchmark, and a
"stock-specific news analyst" that fine-tunes a per-ticker specialist in about 2 minutes. Panels are draggable.
The dashboard describes news; it never predicts prices or gives advice.

## Live demo

https://knightwatch-plum.vercel.app (data and Train work while the Oscar GPU worker is running; Train needs the team's password).

## How to run

Built for Brown's Oscar cluster (needs an Ampere GPU for the model). Full details: `terminal/README.md`.

```bash
source env.sh                       # modules, venv (~/venvs/fin), HF cache paths
cp terminal/.env.example terminal/.env   # add FINNHUB_API_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY (optional)
cd terminal/frontend && npm install && npm run build && cd ../..
terminal/run_backend.sh             # API + UI on port 8000
# from a laptop: ssh -N -L 8000:<gpu-node>:8000 <user>@ssh.ccv.brown.edu, then open http://localhost:8000
```

**Model weights are not in this repo** (LoRA adapters are 64 MB and 165 MB). Recreate the 2B adapter with
`python train_qlora.py --model Qwen/Qwen3.5-2B --out ~/scratch/poc1/qwen35-2b` (about 8 minutes), which copies it to
`adapters/qwen35-2b/`.

## Repository layout

| Path | What |
|---|---|
| `train_qlora.py`, `finbert_eval.py`, `common.py` | training and evaluation |
| `results/` | metrics per model (JSON) |
| `backtest/` | backtest code, chart, write-up |
| `terminal/` | dashboard: FastAPI backend, React frontend, browser tests |
| `specialist/` | per-ticker specialist: data prep, teacher labeling, trainer, eval, labeling guide |
| `crypto/` | crypto news specialist experiment (data review done, paused) |
| `HANDOFF.md`, `PROGRESS.md`, `NOTES.md` | detailed status, decisions, commands that worked |

## Status

- Specialist before/after scores are waiting on teammates' hand labels (`specialist/labeling/`).
- Crypto specialist: dataset review done (`crypto/DATA_REVIEW.md`), paused before the gate test.
