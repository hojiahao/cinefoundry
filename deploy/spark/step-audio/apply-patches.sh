#!/usr/bin/env bash
# Local patches to the Step-Audio-EditX checkout (runtime-data/Step-Audio-EditX). Idempotent; run by scripts/step-audio.sh.
set -euo pipefail
cd "$(dirname "$0")/../../.."
f=runtime-data/Step-Audio-EditX/model_loader.py
if ! grep -q STEP_AUDIO_ATTENTION_BACKEND "$f"; then
  python3 - "$f" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
marker = '            llm_kwargs.update(kwargs)\n'
patch = marker + '            # Spotfoundry: vLLM >= 0.11 ignores VLLM_ATTENTION_BACKEND; the model\'s alibi attention needs a backend other than FLASH_ATTN.\n            llm_kwargs.setdefault("attention_backend", os.environ.get("STEP_AUDIO_ATTENTION_BACKEND", "TRITON_ATTN"))\n'
assert marker in s
s = s.replace(marker, patch, 1)
if '\nimport os' not in s and not s.startswith('import os'): s = 'import os\n' + s
open(p, 'w').write(s)
PY
  echo "patched $f"
fi

# transformers >= 5 returns a BatchEncoding from apply_chat_template(tokenize=True); the code expects a list of ids.
f=runtime-data/Step-Audio-EditX/tts.py
if ! grep -q "return_dict=False" "$f"; then
  sed -i 's#return self.tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True)#return list(self.tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_dict=False))#' "$f"
  echo "patched $f"
fi
