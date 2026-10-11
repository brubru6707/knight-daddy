#!/bin/bash
#SBATCH --job-name=crypto3-qlora
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --constraint=ampere
#SBATCH --mem=32G
#SBATCH --cpus-per-task=4
#SBATCH --time=00:30:00
#SBATCH --output=/users/brrodrig/scratch/poc1/crypto/logs/%x-%j.out
#SBATCH --error=/users/brrodrig/scratch/poc1/crypto/logs/%x-%j.err

# 3-class crypto QLoRA adapter from the general Qwen3.5-2B adapter, same recipe as the stock specialists
# (specialist/train_specialist.py: same prompt, 1:1 replay of general tweets, lr 5e-5, bs 16, 1 pass).
# Data: 1,499 Claude-labeled StockTwits posts (crypto/prep_3class.py). Then scores both test sets.
# Expected runtime: about 10 minutes. Offline: weights are cached in ~/scratch/hf.
set -euo pipefail
source ~/poc1/env.sh
export HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1
cd ~/poc1-crypto
RUN=~/scratch/poc1/crypto/runs3/run-$SLURM_JOB_ID

echo "job $SLURM_JOB_ID on $(hostname) at $(date)"
nvidia-smi --query-gpu=name,memory.total --format=csv
python -c "import torch; assert torch.cuda.is_available() and torch.cuda.is_bf16_supported(), 'need Ampere GPU'"

python specialist/train_specialist.py --ticker CRYPTO3 --data_dir ~/scratch/poc1/crypto/spec3 \
  --run_dir "$RUN" --max_ticker 1500 --replay_ratio 1.0 --bs 16 --lr 5e-5 --seed 0
python crypto/predict_3class.py "$RUN/adapter" both
python crypto/score_3class.py
echo "$RUN" > ~/scratch/poc1/crypto/runs3_latest.txt
echo "done at $(date)"
