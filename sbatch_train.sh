#!/bin/bash
#SBATCH --job-name=qlora-qwen35-9b
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --constraint=ampere
#SBATCH --mem=32G
#SBATCH --cpus-per-task=4
#SBATCH --time=12:00:00
#SBATCH --output=/users/brrodrig/poc1/logs/%x-%j.out
#SBATCH --error=/users/brrodrig/poc1/logs/%x-%j.err

# Full 1-epoch QLoRA run of Qwen/Qwen3.5-9B on zeroshot/twitter-financial-news-sentiment,
# then eval on the validation split. Weights and dataset are pre-cached in ~/scratch/hf,
# so the job runs fully offline. Re-submitting resumes from the latest checkpoint in
# ~/scratch/poc1/qwen35-9b (saved every 50 steps, last 2 kept).
set -euo pipefail
source ~/poc1/env.sh
export HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1
cd ~/poc1

echo "job $SLURM_JOB_ID on $(hostname) at $(date)"
nvidia-smi --query-gpu=name,memory.total --format=csv
python -c "import torch; assert torch.cuda.is_available() and torch.cuda.is_bf16_supported(), 'need Ampere GPU'"

python train_qlora.py \
  --model Qwen/Qwen3.5-9B \
  --out ~/scratch/poc1/qwen35-9b \
  --adapter_copy ~/poc1/adapters \
  --bs 8 --grad_accum 2 --eval_bs 16 \
  --epochs 1 --save_steps 50

echo "done at $(date); metrics in ~/poc1/results/qwen35-9b-qlora.json"
