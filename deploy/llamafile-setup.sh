#!/usr/bin/env bash
# Stand up a local LLM entirely on the CRC JupyterHub container — no root, no
# cmake, no git-lfs, no uploads. Downloads a single self-contained "llamafile"
# straight from Hugging Face (the one egress channel confirmed working on this
# container) and runs it as an OpenAI-compatible server on 127.0.0.1:8080, which
# is exactly what the REU chatbot's LLM_BASE_URL expects.
#
# Usage:   bash ~/reu/deploy/llamafile-setup.sh
# Log:     ~/llm/llamafile.log     Stop:  pkill -f llamafile
set -euo pipefail

LLM_DIR="$HOME/llm"
FILE="Llama-3.2-3B-Instruct-Q4_K_M.llamafile"
URL="https://huggingface.co/mozilla-ai/Llama-3.2-3B-Instruct-llamafile/resolve/main/${FILE}?download=true"
PORT=8080

mkdir -p "$LLM_DIR/tmp"
cd "$LLM_DIR"
export TMPDIR="$LLM_DIR/tmp"    # APE self-extracts here; keep it on the roomy $HOME disk

echo "==> Downloading $FILE (~2 GB) from Hugging Face (resumable)..."
wget -c -O "$FILE" "$URL"
echo "    downloaded bytes: $(wc -c < "$FILE")"
chmod +x "$FILE"

# Stop any previous instance, then start the server headless on CPU.
pkill -f "$FILE" 2>/dev/null || true
sleep 1
echo "==> Starting llamafile server on 127.0.0.1:${PORT} (CPU, 16 cores)..."
nohup ./"$FILE" --server --nobrowser --host 127.0.0.1 --port "$PORT" \
  -c 4096 -t "$(nproc)" > "$LLM_DIR/llamafile.log" 2>&1 &

echo "==> Waiting for the model to load (first load reads ~2 GB into RAM)..."
for i in $(seq 1 60); do
  if curl -s "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1; then
    echo "    server is up."
    break
  fi
  sleep 2
done

echo "==> Smoke test:"
curl -s "http://127.0.0.1:${PORT}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"llama","messages":[{"role":"user","content":"Reply with the single word: ready"}],"max_tokens":8}' \
  || echo "  (no response yet — check $LLM_DIR/llamafile.log)"
echo
echo "==> If the APE binary refuses to run ('cannot execute' / run-detectors),"
echo "    run it via the shell loader instead:"
echo "    sh ./$FILE --server --nobrowser --host 127.0.0.1 --port $PORT -c 4096"
echo
echo "Next: point the REU app at it (see deploy/llamafile-setup.md)."
