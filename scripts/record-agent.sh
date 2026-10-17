#!/usr/bin/env bash
# Record an agent (Claude Code) producing an ad through the spotfoundry-ad-film skill, for the demo video.
# The session runs in tmux, may use only the Skill tool, file reading and Spotfoundry's own commands
# (dontAsk mode: anything else is refused without a prompt), and its terminal is rendered to an image
# every few seconds until the film is finished and the agent has reported.
#   scripts/record-agent.sh "<request in plain words>" [out-dir]
set -uo pipefail
cd "$(dirname "$0")/.."
REQUEST="$1"
OUT="${2:-$HOME/spotfoundry-demo/agent-rec}"
SESSION=spotfoundry-agent
COLS=112; ROWS=34
rm -rf "$OUT"; mkdir -p "$OUT/ansi" "$OUT/frames"
tmux kill-session -t $SESSION 2>/dev/null

ALLOWED=(Skill Read Glob Grep "Bash(node dist/cli.js:*)" "Bash(curl:*)" "Bash(pgrep:*)" "Bash(cat:*)" "Bash(tail:*)" "Bash(ls:*)" "Bash(sleep:*)")
tmux new-session -d -s $SESSION -x $COLS -y $ROWS \
  "cd '$PWD' && claude --permission-mode dontAsk --allowedTools ${ALLOWED[*]@Q}"

n=0
shot() {
  n=$((n+1)); local id; id=$(printf %05d $n)
  tmux capture-pane -p -e -t $SESSION > "$OUT/ansi/$id.ansi" 2>/dev/null || return 1
  python3 - "$OUT/ansi/$id.ansi" "$OUT/ansi/$id.svg" $COLS <<'PY'
import sys
from rich.console import Console
from rich.text import Text
src, dst, cols = sys.argv[1], sys.argv[2], int(sys.argv[3])
console = Console(record=True, width=cols, file=open('/dev/null', 'w'))
console.print(Text.from_ansi(open(src, encoding='utf8', errors='replace').read()), end='')
console.save_svg(dst, title='Claude Code · ~/spotfoundry')
PY
  timeout 60 firefox --headless --profile "$HOME/spotfoundry-demo/ffprofile" --screenshot "$OUT/frames/$id.png" \
    --window-size=1600,1000 "file://$OUT/ansi/$id.svg" >/dev/null 2>&1
}

sleep 12; shot
# A trust prompt for the folder, if any, is accepted once.
if tmux capture-pane -p -t $SESSION | grep -qi "trust"; then tmux send-keys -t $SESSION Enter; sleep 5; fi
shot
tmux send-keys -t $SESSION -l "$REQUEST"; shot; sleep 1; shot
tmux send-keys -t $SESSION Enter
echo "sent $(date +%s)" > "$OUT/marks.txt"

started=$(date +%s); harness_seen=0; finished_at=0
while :; do
  shot; sleep 3
  now=$(date +%s)
  if pgrep -f "dist/cli.js harness" >/dev/null; then harness_seen=1; finished_at=0
  elif [ $harness_seen = 1 ] && [ $finished_at = 0 ]; then finished_at=$now; echo "harness-done $now" >> "$OUT/marks.txt"; fi
  # After the film: give the agent time to read the delivery report and answer, then stop once it is idle.
  if [ $finished_at != 0 ] && [ $((now - finished_at)) -gt 60 ] && ! tmux capture-pane -p -t $SESSION | grep -q "esc to interrupt"; then break; fi
  [ $((now - started)) -gt 5400 ] && { echo "timeout" >> "$OUT/marks.txt"; break; }
done
for _ in 1 2 3; do shot; sleep 2; done
tmux send-keys -t $SESSION "/exit" Enter; sleep 3; tmux kill-session -t $SESSION 2>/dev/null
echo "RECORD_DONE $(date +%s) frames $n" >> "$OUT/marks.txt"
