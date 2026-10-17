#!/usr/bin/env bash
# Cinefoundry installer for NVIDIA DGX Spark: from a fresh clone to a running studio in one command.
#
#   scripts/install.sh                 install everything, start the stack, run cinefoundry doctor
#   scripts/install.sh --check         report what is installed and what is missing; change nothing
#   scripts/install.sh --dry-run       print every download, build and command it would run; change nothing
#   scripts/install.sh --models-only   only download and verify the model weights
#   scripts/install.sh --no-start      install everything but do not start the stack
#
# Options passed on to `cinefoundry setup`:
#   --formats ad,short,drama   which formats to install weights for (default: all three)
#   --with wan22-14b,...       optional extras: kokoro, ltx-int8, wan22-14b, wan22-5b, super-vl
#   --proxy URL | none         proxy for every download (default: the http(s)_proxy environment)
# Environment: SPARK_MODEL_DIR (default ~/models), HF_ENDPOINT (e.g. https://hf-mirror.com), HF_TOKEN (gated LTX-2.5),
#   CINEFOUNDRY_REGISTRY_MIRRORS, CINEFOUNDRY_GITHUB_MIRROR, PIP_INDEX_URL, NODE_MIRROR, npm_config_registry.
#
# Idempotent and resumable: every step checks its result first, partial downloads resume, and a re-run after any
# failure continues where it stopped. Everything is logged to runtime-data/install.log.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

MODE=install
PROXY="${CINEFOUNDRY_PROXY:-}"
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --check) MODE=check ;;
    --dry-run) MODE=dry-run ;;
    --proxy) PROXY="${args[$((i + 1))]:-}" ;;
    --proxy=*) PROXY="${args[$i]#--proxy=}" ;;
  esac
done

mkdir -p runtime-data
LOG="$REPO/runtime-data/install.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -Iseconds) scripts/install.sh $*"

say() { printf '%s\n' "$*"; }
fail() { say "$*"; say "Log: $LOG"; exit 1; }

# curl and npm through the configured proxy (`none` disables a proxy set in the environment).
curl_proxy=()
if [ "$PROXY" = none ]; then
  curl_proxy=(--noproxy '*')
  unset npm_config_proxy npm_config_https_proxy
  export npm_config_noproxy='*'
elif [ -n "$PROXY" ]; then
  curl_proxy=(--proxy "$PROXY")
  export npm_config_proxy="$PROXY" npm_config_https_proxy="$PROXY"
fi

# 1. Hardware. Cinefoundry supports one platform; anything else stops here, before a byte is downloaded.
say "[hardware]"
machine="$(uname -m)"
gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)"
missing=()
[ "$machine" = aarch64 ] || missing+=("CPU is $machine; a DGX Spark is aarch64")
if [ -z "$gpu" ]; then missing+=("no NVIDIA GPU visible (nvidia-smi missing or failing); a DGX Spark runs DGX OS with the NVIDIA driver")
elif ! grep -q GB10 <<<"$gpu"; then missing+=("GPU is $gpu; Cinefoundry needs the NVIDIA GB10 of a DGX Spark"); fi
if [ ${#missing[@]} -gt 0 ]; then
  say "This machine is not an NVIDIA DGX Spark, the only platform Cinefoundry supports:"
  for item in "${missing[@]}"; do say "  - $item"; done
  fail "Nothing was changed."
fi
say "  ok    $machine, $gpu"

# 2. Node.js 22+: the one on PATH, else the repo-local copy in .tools/node, else download it there (no root needed).
NODE_VERSION="${CINEFOUNDRY_NODE_VERSION:-22.23.3}"
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
node_major() { "$1" -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
NODE=""
for candidate in "$REPO/.tools/node/bin/node" "$(command -v node 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && [ "$(node_major "$candidate")" -ge 22 ]; then NODE="$candidate"; break; fi
done
say "[node]"
if [ -z "$NODE" ]; then
  dist="node-v${NODE_VERSION}-linux-arm64"
  url="$NODE_MIRROR/v${NODE_VERSION}/${dist}.tar.xz"
  if [ "$MODE" != install ]; then
    fail "  missing  Node.js 22+; scripts/install.sh downloads $url into .tools/ (the rest of the report needs it)"
  fi
  say "  installing Node.js v$NODE_VERSION into .tools/$dist"
  mkdir -p .tools/download
  curl -fL --retry 4 "${curl_proxy[@]}" -o ".tools/download/${dist}.tar.xz" "$url" || fail "  could not download $url (set NODE_MIRROR, e.g. https://npmmirror.com/mirrors/node, or --proxy)"
  curl -fsSL --retry 4 "${curl_proxy[@]}" -o .tools/download/SHASUMS256.txt "$NODE_MIRROR/v${NODE_VERSION}/SHASUMS256.txt" || fail "  could not download the Node.js checksums"
  if ! (cd .tools/download && grep " ${dist}.tar.xz\$" SHASUMS256.txt | sha256sum -c --status); then
    rm -f ".tools/download/${dist}.tar.xz"
    fail "  the Node.js archive does not match its published sha256; removed it, run again"
  fi
  tar -xJf ".tools/download/${dist}.tar.xz" -C .tools && ln -sfn "$dist" .tools/node && rm -rf .tools/download
  NODE="$REPO/.tools/node/bin/node"
fi
export PATH="$(dirname "$NODE"):$PATH"
say "  ok    node $("$NODE" --version) ($NODE)"

# 3. npm dependencies and the build.
say "[build]"
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  if [ "$MODE" != install ]; then fail "  missing  npm dependencies (npm ci); run scripts/install.sh"; fi
  npm ci --no-audit --no-fund || fail "  npm ci failed (set npm_config_registry, e.g. https://registry.npmmirror.com, or --proxy)"
fi
if [ "$MODE" = install ]; then
  npm run --silent build || fail "  build failed"
elif [ ! -f dist/cli.js ]; then
  fail "  missing  dist/ (npm run build); run scripts/install.sh"
fi
say "  ok    dist/cli.js"

# 4-7. Platform checks, model weights, images, voice library, stack and doctor: cinefoundry setup (src/setup).
"$NODE" dist/cli.js setup "$@"
status=$?
say "Log: $LOG"
exit $status
