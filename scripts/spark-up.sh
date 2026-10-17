#!/usr/bin/env bash
# Bring up the local inference stack and check it end to end.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname -m)" = "aarch64" ] || echo "warning: not aarch64; this stack targets DGX Spark." >&2
[ -f deploy/spark/spark.env ] || sed "s|^SPARK_MODEL_DIR=.*|SPARK_MODEL_DIR=${SPARK_MODEL_DIR:-$HOME/models}|" deploy/spark/spark.env.example > deploy/spark/spark.env

# One memory pool for CPU and GPU: refuse to start on a full machine rather than
# letting a model load die halfway.
available_gb=$(awk '/MemAvailable/ {printf "%d", $2/1048576}' /proc/meminfo)
required_gb="${SPARK_REQUIRED_FREE_GB:-95}"
if [ "$available_gb" -lt "$required_gb" ]; then
  echo "Only ${available_gb} GB unified memory available, need ~${required_gb} GB. Stop other GPU services first." >&2
  exit 1
fi

# The ComfyUI image is built from a local checkout (see deploy/spark/comfyui/Dockerfile).
if [ ! -d runtime-data/ComfyUI/.git ]; then
  mkdir -p runtime-data
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI runtime-data/ComfyUI
fi
mkdir -p runtime-data/comfyui/output runtime-data/comfyui/input

compose=(docker compose -f deploy/spark/compose.yaml --env-file deploy/spark/spark.env)
"${compose[@]}" up -d --build "$@"

wait_for() { # name url
  printf 'waiting for %s ' "$1"
  for _ in $(seq 1 180); do
    if curl -sf --noproxy '*' "$2" >/dev/null; then echo ok; return 0; fi
    printf '.'; sleep 5
  done
  echo " timed out"; "${compose[@]}" logs --tail 40 "$1"; return 1
}
wait_for nemotron http://127.0.0.1:8001/health
wait_for stepvl   http://127.0.0.1:8002/health
wait_for comfyui  http://127.0.0.1:8188/system_stats

[ -f dist/cli.js ] || npm run build
node dist/cli.js doctor
node dist/cli.js mem status
