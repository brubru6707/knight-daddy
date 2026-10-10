# Stretch 8 progress: "Train a specialist" (stock-specific news analyst)

Updated 2026-10-09 18:36 EDT, written for the managing Claude model. Project-wide context: `~/poc1/HANDOFF.md`.

## Status in one paragraph

Built and browser-tested end to end on NVDA (the demo ticker): the TRAIN button fine-tunes a per-ticker
specialist from the general 2B adapter in **about 2 minutes (115 to 125 s click to DONE, warm GPU)**, streams
progress and a readable loss chart, scores the model before and after, and switches the headline feed to the
specialist's tags. **The only missing piece is the human test labels.** Until teammates return
`NVDA_labeled.csv` / `DDOG_labeled.csv`, the panel shows "NO HUMAN TEST LABELS YET" instead of a score. When they
land, the UI scores automatically; nothing needs retraining. Early signal (no human labels involved): the specialist
**changes very little** (6 of 120 NVDA test tags, 1 of 100 DDOG), so expect "no clear difference" as a likely outcome.

## Approved plan (by the user, 2026-10-09)

1. Labels: 9B teacher labels pre-2023-07 headlines for **training**; teammates hand-label ~100 Jul-Dec 2023
   headlines per ticker for **testing**; template duplicates removed. Never train on 2B labels or on hand labels.
2. Teammates do the hand-labeling.
3. 9B labeling ran as a Slurm batch job (shown to the user before submitting).
4. Training runs as a subprocess on the dashboard's own GPU, continuing from the general 2B adapter,
   with progress written to a JSON file and streamed to the UI (no squeue polling).
5. If the specialist does not beat the general model, show that honestly; no tuning until it wins.

## Done and verified

| Step | Result |
|---|---|
| Data split (`prep_data.py`) | NVDA: 3,132 training headlines (pre-Jul), 120 to hand-label, 725 held-out. DDOG: 348 training, 100 to hand-label, 0 held-out. Zero template and zero text overlap between test rows and training pools. |
| Labeling files | `labeling/NVDA_to_label.csv` (120), `DDOG_to_label.csv` (100), `LABELING.md`. Sent to the user. |
| 9B teacher job 7245352 | COMPLETED 17:45 to 17:49, exit 0, no stderr errors, sanity check passed. Label balance below. |
| Warmup at server start | 3 unsaved training steps + one fixed-shape inference pass; about 24 s; Train is refused (409) until done. |
| Training endpoint | `POST /api/specialist/train`, `GET /status`, `GET /info`, SSE `GET /stream`. Curl-tested on NVDA on gpu2109: 409 while busy, 400 for AAPL, 409 without teacher labels, stream through all 7 phases. |
| Eval gate + scoring (`eval_specialist.py`, `GET /api/specialist/eval`) | Without a labeled CSV: status `no_human_labels`, no score. With one: accuracy and macro F1 with 95% paired bootstrap CIs, per-class F1 with n, exact McNemar, verdict rule fixed in advance. Code-tested on a **fake** label file (teacher labels as stand-in, in the scratchpad, nothing written to `~/poc1/results`): validation counted 111 of 120 (5 Skip, 3 blank, 1 invalid), teacher scored 1.000 as it must, McNemar matched a hand-computed value. |
| Specialist headline feed | `/api/headlines?model=specialist`, separate label cache per adapter, `general_label` kept so the UI marks changed tags ("was NEUT"). |
| Frontend (SPC panel) | `frontend/src/specialist.jsx`: TRAIN button, phase + step + ETA, progress bar, loss chart, before/after box, caption "It reads news; it is not a trading signal." General/Specialist toggle in the NWS panel. Layout key bumped to `kw.layouts.v2`. |
| Smoke test (`terminal/scripts/specialist_smoke_test.py`) | **ALL 10 PASS**: panel renders, framing, bar moves during training, **click to DONE 125 s**, eval gate, agreement labeled as agreement, loss chart drawn, y-axis 0 with round ticks [0.0 to 0.4], feed switches (38 headlines, 2 changed), no console errors. Regression `ui_smoke_test.py` also passes. |
| DDOG path | Trained once directly: 316 + 316 examples, 40 steps, 65 s, eval gate works. |

### Teacher label balance

| Pool | n | Bearish | Bullish | Neutral |
|---|---|---|---|---|
| NVDA train (pre-Jul) | 3,132 | 14.8% | 34.0% | 51.2% |
| NVDA held-out (Jul-Dec) | 725 | 7.2% | 24.1% | 68.7% |
| NVDA test rows | 120 | 5.0% (6) | 20.8% | 74.2% |
| DDOG train | 348 | 15.2% | 26.4% | 58.3% |
| DDOG test rows | 100 | 10.0% | 42.0% | 48.0% |

NVDA's class mix shifts between periods (Bearish 15% before July vs 5 to 7% after).

### Timing (RTX 3090, 600 ticker + 600 general examples, 75 steps)

| Condition | Click / request to DONE |
|---|---|
| Warm (after server warmup) | 115 s via API, 119 to 125 s via UI. Load 4 s, score before 12 s, train 59 s, score after 11 s. |
| First run on a fresh node (model not in page cache, inference shape not compiled) | 185 s. The warmup now compiles the inference shape too. |
| Empty Triton cache (e.g. fresh Modal container) | first step alone 116 s; warmup at start is required. |

### What the specialist did (no human labels involved; NOT accuracy)

| | NVDA | DDOG |
|---|---|---|
| Test tags changed (general to specialist) | 6 of 120 | 1 of 100 |
| Agreement with 9B teacher, held-out | 92.4% to 93.2% (n=725) | n/a (no held-out pool) |
| Held-out loss, step 0 to end | about 0.065 to 0.070 (flat) | 0.161 to 0.053, but the probe comes from the same pre-Jul pool as training (labeled "weaker test" in the UI) |
| Live feed tags changed | 2 of 38 (Neutral to Bullish) | not checked |

Agreement with the teacher is expected to rise a little by construction (the specialist learns from the teacher),
so it is not evidence of being more correct. Only the human-labeled score can say that.

### Loss chart (user request: readable without faking a drop)

- Y-axis always starts at 0 and uses round steps (1, 2, 2.5 or 5 x 10^k); max just above the largest shown value.
- Bold amber line: held-out loss every 5 steps, on headlines never trained on; legend states the probe source.
- Thin blue line: ticker-only training loss (5-step average), split per example from mixed batches.
- Hover shows exact values; end labels are pushed apart so they never overlap.
- Caption: "Loss starts low because training begins from our already-trained general model. The held-out line is the honest one."

## Bugs found and fixed this session

- **Orphan trainer:** stopping the server left the training subprocess on the GPU (7.5 GB). Fixed with
  `PR_SET_PDEATHSIG` (child gets SIGTERM if the server dies) plus a shutdown hook. Verified with SIGKILL of the server.
- **Latest run chosen by name** (a manual `run-test-*` folder sorted last). Now by modification time.
- **Inference compile on first scoring** (30 s). Warmup now runs one fixed-shape inference pass.
- Test-only races (previous run's DONE state, a refetch right after training, SVG text access); tests fixed, app unchanged.

## When the hand labels arrive

1. Teammates put `NVDA_labeled.csv` and `DDOG_labeled.csv` in `~/poc1/specialist/labeling/` (columns `id,...,label`).
2. Either open the SPC panel (scores load automatically for the latest run) or run
   `source ~/poc1/env.sh; python ~/poc1/specialist/eval_specialist.py NVDA` (and `DDOG`).
3. Results are saved to `~/poc1/results/specialist_<T>_<run>.json`. Report the verdict as is. The rule:
   "better" or "worse" only if the 95% CI of the accuracy difference excludes 0; otherwise "no clear difference".
4. Expect wide intervals: about ±7 points on accuracy at n=100, and Bearish F1 rests on very few rows (NVDA may have about 6).
5. If several people labeled the same file, compute their agreement too; it bounds how well any model can score.

## Not done

- The human-labeled eval itself (waiting on teammates).
- Modal version of training (needs a warmup or baked kernel cache in the image).

## Files

| Path | What |
|---|---|
| `~/poc1/specialist/prep_data.py` | splits, dedupe, labeling CSVs |
| `~/poc1/specialist/labeling/` | CSVs to label, `LABELING.md`; labeled files go here |
| `~/poc1/specialist/label_teacher.py`, `sbatch_teacher.sh` | 9B teacher labeling (job 7245352) |
| `~/poc1/specialist/teacher_labels/` | teacher outputs (copies) |
| `~/poc1/specialist/train_specialist.py` | trainer: progress file, split losses, probe loss, before/after predictions |
| `~/poc1/specialist/eval_specialist.py` | scoring vs hand labels (CLI and imported by the server) |
| `~/poc1/terminal/backend/specialist.py` | endpoints, warmup, SSE, orphan protection |
| `~/poc1/terminal/frontend/src/specialist.jsx` | SPC panel and loss chart |
| `~/poc1/terminal/scripts/specialist_smoke_test.py` | headless test (10 checks) |
| `~/poc1/terminal/screenshot_specialist.png` | SPC panel after a test run |
| `~/scratch/poc1/terminal/specialists/<T>/run-*/` | each run: `progress.json`, `train.log`, `preds_*.parquet`, `adapter/` |
