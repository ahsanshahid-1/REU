# Running Ollama on the CRC JupyterHub container (offline / upload method)

This container blocks binary CDN downloads, so the normal
`curl https://ollama.com/install.sh | sh` and `ollama pull ...` both fail
(they return tiny stub files instead of the real binary/model). It also has no
reliable root/systemd. So we install Ollama **in userspace** and bring both the
binary and the model in through the **Jupyter file-upload UI**, which uses your
browser session and is not affected by the container's egress block.

Nothing here needs sudo.

---

## Step 1 — Download on your Mac (internet works there)

1. **Ollama Linux binary** (~1.5 GB):
   https://ollama.com/download/ollama-linux-amd64.tgz
   (If your `uname -m` said `aarch64`, use `ollama-linux-arm64.tgz` instead.)

2. **A small instruct model in GGUF format.** Pick ONE quantized file, e.g.:
   - Llama 3.2 3B Instruct (Q4_K_M, ~2 GB):
     https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF
     → download `Llama-3.2-3B-Instruct-Q4_K_M.gguf`
   - Or Qwen2.5 3B Instruct, Phi-3.5-mini, etc. Anything ~2–4 GB Q4 works on CPU.

   A 3B Q4 model answers this chatbot's short, grounded questions fine on CPU.
   Go bigger (7–8B) only if the container has a GPU (`nvidia-smi` shows one).

## Step 2 — Upload both files into the container

In JupyterHub, open the file browser (Jupyter home / Lab), navigate to your home
directory, and use the **Upload** button to upload:
- `ollama-linux-amd64.tgz`
- the `.gguf` model file

Large uploads can be slow; let them finish. They land in `~/` (or wherever you
upload). Adjust paths below if you put them elsewhere.

## Step 3 — Install + run (on the container terminal)

```bash
# extract the userspace install
mkdir -p ~/ollama
tar -C ~/ollama -xzf ~/ollama-linux-amd64.tgz     # -> ~/ollama/bin/ollama, ~/ollama/lib/

# keep models inside home so nothing needs root
export OLLAMA_MODELS=$HOME/ollama/models
export OLLAMA_HOST=127.0.0.1:11434
export LD_LIBRARY_PATH=$HOME/ollama/lib:$LD_LIBRARY_PATH

# start the server (background)
nohup ~/ollama/bin/ollama serve > ~/ollama/serve.log 2>&1 &
sleep 2 && curl -s http://127.0.0.1:11434/api/version   # should print a version
```

## Step 4 — Import the local GGUF (no network pull needed)

```bash
# point the Modelfile at the GGUF you uploaded (edit the filename)
cat > ~/Modelfile <<'EOF'
FROM /home/YOUR_USER/Llama-3.2-3B-Instruct-Q4_K_M.gguf
PARAMETER temperature 0.3
EOF

~/ollama/bin/ollama create reu -f ~/Modelfile     # imports the file, offline
~/ollama/bin/ollama run reu "Say hello in one sentence."   # smoke test
```

## Step 5 — Point the REU app at it

Ollama exposes an OpenAI-compatible API at `/v1`, which is exactly what the
chatbot's `LLM_BASE_URL` expects. Restart the Node server with:

```bash
cd ~/reu
pkill -f "node server.js" 2>/dev/null
NODE_ENV=production ADMIN_TOKEN="your-long-token" \
LLM_BASE_URL=http://127.0.0.1:11434/v1 \
CHAT_MODEL=reu \
nohup node server.js > ~/reu-server.log 2>&1 &
```

Now the "REU Assistant" generates real answers grounded in the site content,
fully on-server — nothing leaves the container.

---

## Reality checks

- **Durability:** both `ollama serve` and `node server.js` run inside your
  JupyterHub singleuser container. If JupyterHub culls/restarts your server,
  both die and must be restarted. This is fine for a demo, not for production.
- **Lighter alternative:** if the 1.5 GB Ollama upload is painful, a single
  `llamafile` (Mozilla) or a llama.cpp `llama-server` binary is much smaller,
  runs the same GGUF, and also serves an OpenAI-compatible `/v1` endpoint. Set
  `LLM_BASE_URL` to its port (e.g. `http://127.0.0.1:8080/v1`).
- **Zero-install option:** set `HF_TOKEN` (a free Hugging Face read token) and
  the chatbot uses Hugging Face's hosted inference — no local model at all.
  Only works if the container can reach `router.huggingface.co`.
