#!/usr/bin/env bash
# Record a real Studio session for the demo: the brief being typed, then a screenshot of the Studio page
# every few seconds while the harness runs, until the job is done. Frames land in $OUT/frames.
#   scripts/record-studio.sh "<brief>" [out-dir]
set -uo pipefail
cd "$(dirname "$0")/.."
BRIEF="$1"
OUT="${2:-$HOME/cinefoundry-demo/studio-rec}"
URL=http://127.0.0.1:3090/
PROFILE="$HOME/cinefoundry-demo/ffprofile"
rm -rf "$OUT"; mkdir -p "$OUT/frames"
n=0
shot() { # url
  n=$((n+1))
  timeout 60 firefox --headless --profile "$PROFILE" --screenshot "$OUT/frames/$(printf %05d $n).png" --window-size=1920,1080 "$1" >/dev/null 2>&1
}
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

# 1. The brief appears in the box, a few characters at a time.
len=$(python3 -c "import sys;print(len(sys.argv[1]))" "$BRIEF")
step=$(( (len + 11) / 12 ))
for i in $(seq $step $step $len) $len; do
  part=$(python3 -c "import sys;print(sys.argv[1][:int(sys.argv[2])])" "$BRIEF" "$i")
  shot "${URL}#$(enc "$part")"
done
echo "typed $n" > "$OUT/marks.txt"

# 2. Submit, exactly as the 开拍 button does.
curl -s -X POST "${URL}api/harness" -H 'content-type: application/json' \
  -d "$(python3 -c "import json,sys;print(json.dumps({'brief':sys.argv[1]}))" "$BRIEF")" > "$OUT/submit.json"
echo "submitted $(date +%s)" >> "$OUT/marks.txt"

# 3. Watch until the job leaves 'running'.
while :; do
  shot "$URL"
  status=$(curl -s "${URL}api/job" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('status') if d else 'none')")
  [ "$status" = running ] || break
  sleep 4
done
shot "$URL"
echo "finished $(date +%s) $status frames $n" >> "$OUT/marks.txt"
echo RECORD_DONE >> "$OUT/marks.txt"
