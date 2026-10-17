#!/usr/bin/env bash
# Download and verify every model weight the default configuration needs (deploy/models.json): resumable, each file
# checked by sha256 against the Hugging Face lfs.oid. Same as `scripts/install.sh --models-only`; see docs/install.md.
#   HF_ENDPOINT=https://hf-mirror.com scripts/download-models.sh     # mainland mirror
#   scripts/download-models.sh --with wan22-14b                      # plus an optional model
exec "$(dirname "$0")/install.sh" --models-only "$@"
