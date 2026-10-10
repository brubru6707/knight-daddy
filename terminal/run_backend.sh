#!/bin/bash
# Start the KNIGHTWATCH API (and the built UI, if frontend/dist exists) on $PORT (default 8000).
set -e
cd "$(dirname "$0")"
source ~/poc1/env.sh
set -a; [ -f .env ] && source .env; set +a
exec uvicorn app:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8000}"
