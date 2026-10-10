#!/bin/bash
#SBATCH --job-name=kw-teacher-9b
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --constraint=ampere
#SBATCH --mem=32G
#SBATCH --cpus-per-task=4
#SBATCH --time=01:00:00
#SBATCH --output=/users/brrodrig/poc1/logs/%x-%j.out
#SBATCH --error=/users/brrodrig/poc1/logs/%x-%j.err

# Label NVDA/DDOG specialist pools with the Qwen3.5-9B teacher adapter. Runs offline from cached weights.
# Independent of any interactive session. Expected runtime about 5 to 10 min (about 4,500 headlines at about 29/s + load).
set -euo pipefail
source ~/poc1/env.sh
export HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1
echo "job $SLURM_JOB_ID on $(hostname) at $(date)"
nvidia-smi --query-gpu=name,memory.total --format=csv
python ~/poc1/specialist/label_teacher.py
echo "finished at $(date)"
