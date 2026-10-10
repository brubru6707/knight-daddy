# source ~/poc1/env.sh  -- sets up modules, venv, caches for the poc1 project
module load python/3.12.8-zr3c cuda cudnn
export HF_HOME=~/scratch/hf
export PIP_CACHE_DIR=~/scratch/pip-cache
export POC_OUT=~/scratch/poc1
export TOKENIZERS_PARALLELISM=false
mkdir -p "$HF_HOME" "$PIP_CACHE_DIR" "$POC_OUT" ~/poc1/logs ~/poc1/adapters
[ -d ~/venvs/fin ] && source ~/venvs/fin/bin/activate
