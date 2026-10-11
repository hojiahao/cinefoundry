#!/usr/bin/env bash
# Host-side OOM guard for the Spark: kill the worst process before swap thrash freezes the box.
# The kernel OOM killer acts too late here (2026-10-10: swap full, tailscaled watchdog panic,
# hard reboot) and ranks by RSS, which misses GPU allocations in unified memory.
#   sudo bash deploy/spark/setup-earlyoom.sh
set -euo pipefail

apt-get install -y earlyoom

# Act at <5% available RAM with <20% swap free (SIGTERM), SIGKILL at 3%/10%.
# earlyoom ranks by oom_score, so the comfyui container (oom_score_adj 1000) goes first.
# Never kill remote access, the desktop session or the container runtime.
cat > /etc/default/earlyoom <<'EOF'
EARLYOOM_ARGS="-m 5,3 -s 20,10 -r 60 --avoid '(^|/)(sshd|tailscaled|mosh-server|systemd|systemd-.*|Xorg|gnome-shell|dockerd|containerd)$'"
EOF

systemctl enable --now earlyoom
systemctl restart earlyoom
systemctl --no-pager status earlyoom | head -15
