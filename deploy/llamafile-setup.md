# Local LLM for the REU Assistant — entirely on the CRC container

Confirmed container facts (from `deploy/container-capabilities-check.sh`):
x86_64, 16 cores, 14 GB RAM, 14 GB free disk, **no GPU**; `gcc/g++/make` present
but **no cmake, no git-lfs**; GitHub release downloads blocked; **Hugging Face
downloads work**. Given that, a single-file **llamafile** is the path of least
resistance: one HF download, `chmod +x`, run. No build, no root, no uploads.

## 1. Download + start the model server (one command)

```bash
cd ~/reu && git pull
bash deploy/llamafile-setup.sh
```

This downloads `Llama-3.2-3B-Instruct-Q4_K_M.llamafile` (~2 GB) into `~/llm/`,
starts it headless as an OpenAI-compatible server on `127.0.0.1:8080`, and runs
a smoke test. Logs: `~/llm/llamafile.log`.

A 3B Q4 model on 16 CPU cores is a good fit for this chatbot's short, grounded
answers. (Bigger models exist in the same repo — Q6/Q8/8B — but 3B keeps
first-token latency reasonable on CPU.)

## 2. Point the REU app at it

The chatbot already speaks the OpenAI chat protocol; just give it the endpoint.

```bash
cd ~/reu
pkill -f "node server.js" 2>/dev/null || true
NODE_ENV=production ADMIN_TOKEN="your-long-token" \
RATE_LIMIT_ENABLED=1 TRUST_PROXY=true \
LLM_BASE_URL=http://127.0.0.1:8080/v1 \
CHAT_MODEL=llama-3.2-3b \
nohup node server.js > ~/reu-server.log 2>&1 &

curl -s http://127.0.0.1:3000/api/health         # {"ok":true}
# real end-to-end test through the app's own chat route:
curl -s http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"When does the program run and what is the stipend?"}'
```

If the answer comes back phrased in full sentences (not a raw snippet), the
model is doing the generation. The REU Assistant is now fully local — no data
leaves the container.

## 3. Startup order after a container restart

Because both processes live in your JupyterHub container, after any cull/restart
you re-run two things:

```bash
bash ~/reu/deploy/llamafile-setup.sh     # model server (skips re-download; file is cached)
# then the node start command from step 2
```

The `wget -c` in the script resumes rather than re-downloads, and once the
`.llamafile` is on disk it just restarts instantly.

## Notes / troubleshooting

- **Port:** 8080 was free on this container (8000/8001/8081 were taken). If 8080
  is ever busy, change `PORT` in the script and the `LLM_BASE_URL` port to match.
- **APE won't execute** ("cannot execute binary file" / run-detectors): run it
  through the shell loader — `sh ./Llama-3.2-3B-Instruct-Q4_K_M.llamafile
  --server --nobrowser --host 127.0.0.1 --port 8080 -c 4096`.
- **RAM:** the 3B Q4 uses ~3–4 GB resident; you have 14 GB, so it coexists with
  the Node app fine.
- **Durability:** same caveat as the rest of the stack — this runs inside the
  JupyterHub singleuser container and stops when that container is culled or
  restarted. Fine for demos and internal testing; not a home for live PII.
- **Retrieval-only fallback still works:** if the model server is down, the
  chatbot automatically falls back to returning the best matching site snippet,
  so the widget never hard-fails.
