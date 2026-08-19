#!/usr/bin/env bash
# Probe what the CRC JupyterHub container can actually do, so we can choose an
# all-on-container path for running a local LLM. Read-only + tiny downloads.
# Run:  bash ~/reu/deploy/container-capabilities-check.sh
set +e
echo "==== system ===="
uname -m; echo "cores: $(nproc 2>/dev/null)"; free -h 2>/dev/null | head -2
echo "free disk in \$HOME:"; df -h "$HOME" 2>/dev/null | tail -1
echo "GPU:"; nvidia-smi -L 2>/dev/null || echo "  none"

echo; echo "==== toolchains present? ===="
for t in git git-lfs node npm python3 gcc g++ cc make cmake curl wget; do
  p=$(command -v "$t" 2>/dev/null) && echo "  $t -> $p" || echo "  $t -> MISSING"
done
echo "node version: $(node -v 2>/dev/null)"

echo; echo "==== can we reach Hugging Face and pull a real file? ===="
# A small (~1 MB) GGUF used purely as a reachability/byte-count probe.
PROBE="https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf"
curl -sSL --max-time 40 -o /tmp/hf_probe.gguf "$PROBE"
echo "  huggingface probe bytes: $(wc -c </tmp/hf_probe.gguf 2>/dev/null)"
file /tmp/hf_probe.gguf 2>/dev/null

echo; echo "==== can we reach GitHub release assets? (Ollama tgz, HEAD only) ===="
curl -sIL --max-time 40 https://ollama.com/download/ollama-linux-amd64.tgz \
  | grep -iE "^HTTP|content-length|location" | head -12

echo; echo "==== git-lfs smudge test (clone a tiny LFS repo, check real bytes) ===="
rm -rf /tmp/lfs_test
GIT_LFS_SKIP_SMUDGE=0 git clone --depth 1 \
  https://huggingface.co/ggml-org/models /tmp/lfs_test 2>&1 | tail -4
ls -l /tmp/lfs_test/tinyllamas/stories15M-q4_0.gguf 2>/dev/null \
  || echo "  (repo layout differs; check /tmp/lfs_test)"

echo; echo "==== done ===="
