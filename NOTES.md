# poc1: QLoRA financial tweet sentiment vs FinBERT

Session date: 2026-10-09, Brown Oscar, interactive job 7231140 on gpu2101 (RTX 3090, 24 GB).

## Status

- FinBERT baseline: done.
- Qwen3.5-2B QLoRA, 1 epoch: done. Beats FinBERT by about 19 accuracy points and 23 macro F1 points.
- Qwen3.5-9B full run: **Slurm job 7236264, COMPLETED** on gpu2259 (RTX A5000), 15:09 to 15:38, exit 0.
  Training 1496 s (6.4 samples/s, peak 17.2 GiB). Adapter in `~/poc1/adapters/qwen35-9b`, metrics in
  `~/poc1/results/qwen35-9b-qlora.json`, log `~/poc1/logs/qlora-qwen35-9b-7236264.out`.

## Results (validation split, 2388 tweets, RTX 3090)

| Model | Accuracy | Macro F1 | F1 Bearish | F1 Bullish | F1 Neutral | Speed (ex/s) |
|---|---|---|---|---|---|---|
| ProsusAI/finbert, zero-shot (fp32, bs 64) | 0.7253 | 0.6682 | 0.5986 | 0.6043 | 0.8016 | 1063 |
| Qwen3.5-2B base, zero-shot (nf4, bs 32) | 0.3907 | 0.3999 | 0.4548 | 0.5424 | 0.2024 | 154 |
| **Qwen3.5-2B QLoRA, 1 epoch (nf4, bs 32)** | **0.9188** | **0.8951** | 0.8621 | 0.8800 | 0.9431 | 106 |
| Qwen3.5-9B QLoRA, 1 epoch (nf4, bs 16, **RTX A5000**) | 0.9238 | 0.9040 | 0.8722 | 0.8959 | 0.9439 | 29 |

Not in the table: the 9B smoke test (128 train, 128 val examples) got 0.922 accuracy and 0.908 macro F1 at 31.8 ex/s. The sample is too small to compare with the full results.

Speed is eval throughput only (forward pass, GPU timed with synchronize, warmup batch excluded for Qwen).
FinBERT is about 10x faster; the fine-tuned 2B is much more accurate. Raw JSON: `~/poc1/results/`.

## Layout

| Path | What |
|---|---|
| `~/poc1/env.sh` | `source` this first: modules, venv, HF_HOME, cache dirs |
| `~/poc1/common.py` | label names, dataset id, metrics (writes `results/*.json`) |
| `~/poc1/finbert_eval.py` | FinBERT baseline |
| `~/poc1/train_qlora.py` | QLoRA train + eval for any decoder model (resumes from checkpoints) |
| `~/poc1/sbatch_train.sh` | batch job for the Qwen3.5-9B run |
| `~/poc1/logs/` | all run logs |
| `~/poc1/adapters/qwen35-2b/` | final 2B LoRA adapter (copy) |
| `~/scratch/poc1/<run>/` | checkpoints + `final_adapter/` |
| `~/scratch/hf/` | HF_HOME: model and dataset cache (2B, 9B, FinBERT, dataset) |

## Commands that worked (in order)

```bash
# Step 0: GPU. Already on a GPU node from an Open OnDemand session, so no interact needed.
nvidia-smi                                   # RTX 3090, driver 575.57.08, CUDA 12.9
module load cuda cudnn                       # cuda/12.9.0-cinr, cudnn/9.8.0.87-12-y7fu

# Step 1: environment (python 3.9 system default is too old for transformers 5)
module load python/3.12.8-zr3c
export HF_HOME=~/scratch/hf PIP_CACHE_DIR=~/scratch/pip-cache
python3 -m venv ~/venvs/fin && source ~/venvs/fin/bin/activate
pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install transformers peft bitsandbytes datasets accelerate scikit-learn
pip install flash-linear-attention
MAX_JOBS=4 TORCH_CUDA_ARCH_LIST="8.0;8.6" pip install --no-build-isolation causal-conv1d   # compiles, ~10 min
curl -I https://huggingface.co               # HTTP/2 200: compute node has internet

# From now on:
source ~/poc1/env.sh
cd ~/poc1

# Step 3: FinBERT baseline
python finbert_eval.py | tee logs/finbert_eval.log

# Step 4: 2B smoke test, then full run (about 10 min total, includes base zero-shot eval)
python train_qlora.py --model Qwen/Qwen3.5-2B --out ~/scratch/poc1/smoke-2b --adapter_copy "" --max_train 256 --max_eval 200 --save_steps 1000
python train_qlora.py --model Qwen/Qwen3.5-2B --out ~/scratch/poc1/qwen35-2b --eval_base --save_steps 200 > logs/train_qwen35_2b.log 2>&1

# Step 5: pre-download 9B, offline smoke test, submit
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3.5-9B')"
HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 python train_qlora.py --model Qwen/Qwen3.5-9B --out ~/scratch/poc1/smoke-9b \
    --adapter_copy "" --max_train 128 --max_eval 128 --bs 8 --grad_accum 2 --eval_bs 16 --save_steps 1000
sbatch --test-only sbatch_train.sh && sbatch sbatch_train.sh      # -> job 7236264
```

## Versions

Python 3.12.8, torch 2.11.0+cu128, transformers 5.19.0, peft 0.21.2, bitsandbytes 0.50.2,
datasets 5.1.0, accelerate 1.15.0, scikit-learn 1.9.1, flash-linear-attention (fla) 0.5.2,
causal-conv1d 1.7.0. Driver 575.57.08, CUDA module 12.9.0, cuDNN 9.8.0.

## Method details

- Data: `zeroshot/twitter-financial-news-sentiment`, train 9543, validation 2388 (used as test for every model).
  Labels are ints with no names in the dataset; per the dataset card and checked on examples: 0 Bearish, 1 Bullish, 2 Neutral.
  Validation is imbalanced: 347 / 475 / 1566.
- FinBERT label mapping: its `id2label` is {0 positive, 1 negative, 2 neutral}, so indices 0 and 1 are swapped
  relative to the dataset. Mapped by name: positive -> Bullish, negative -> Bearish, neutral -> Neutral.
- Qwen as classifier: chat template with `enable_thinking=False` (renders an empty `<think></think>` block),
  system prompt asks for one word. Target words are `Negative` / `Positive` / `Neutral` (one Qwen token each).
  Loss is only on the target tokens. Eval does not generate: it takes the next-token logits at the answer
  position and argmaxes over the three target token ids, so every example gets a valid label.
- QLoRA: nf4 4-bit, double quant, bf16 compute, LoRA r 16, alpha 32, dropout 0.05, all linear layers
  (16.8M trainable params for 2B), paged AdamW 8-bit, lr 2e-4 cosine, 3% warmup, gradient checkpointing,
  max length 256, 1 epoch, bs 16 (2B) or 8 x grad_accum 2 (9B).
- 2B training: 597 steps, 486 s, 19.6 samples/s, peak 11.2 GiB. 9B smoke: peak 16.5 GiB at bs 8.

## What failed or needed workarounds

- **`~/data/poc1` could not be created.** `~/data` links to `/oscar/data/nopi`, a shared group directory where
  this user has no write permission and no personal subfolder. Adapters are copied to `~/poc1/adapters/`
  instead (small, home has about 60 GB free). Ask CCV for a data directory if one is needed.
- `~/poc1` did not exist; the folder from earlier was `~/POC1` (uppercase). Renamed to `~/poc1`.
- System `python3` is 3.9; used `module load python/3.12.8-zr3c`.
- Qwen3.5 is a hybrid model (18 Gated DeltaNet linear attention layers + 6 full attention layers) and wants
  `fla` and `causal-conv1d` for the fast path. Both installed in about 11 min, so no fallback model was needed.
- transformers 5.x removed `TrainingArguments(warmup_ratio=...)` and `group_by_length`. Script computes
  integer `warmup_steps` and no longer groups by length.
- `Bullish` tokenizes as `B`,`ull`,`ish` in Qwen, so scoring its first token means scoring the generic `B`.
  Switched target words to Negative/Positive/Neutral (single tokens).
- Eval at first ran at 4.2 ex/s, because Triton autotunes for every new sequence length. Sorting by length,
  padding to a multiple of 16, and one untimed warmup batch brought it to about 155 ex/s. Training batches are
  padded to a multiple of 32 for the same reason. The first training step still takes about 2 min (compile).
- `du` on a model folder in `~/scratch/hf/hub` shows only about 10 MB: this huggingface_hub stores weight blobs
  as symlinks into a shared store `~/scratch/hf/hub/blobs/`. The 9B weights (18 GiB) are really there.
- The `causal-conv1d` install ran past the agent tool timeout (10 min) and finished in the background; no harm.

## Resume / next steps

- Check the 9B job: `squeue --me` or `sacct -j 7236264 --format=JobID,State,Elapsed,MaxRSS`.
- If it dies or times out, `sbatch ~/poc1/sbatch_train.sh` again: it resumes from the last checkpoint in
  `~/scratch/poc1/qwen35-9b`. If training finished but eval did not, add `--skip_train` to the python line.
- Ideas: 2 to 3 epochs, class weighting for Bearish, compare against a fine-tuned FinBERT (fairer baseline),
  try `--eval_bs 64` for higher throughput.
- Scratch is purged periodically; copy anything important (adapters, results) out of `~/scratch`.
