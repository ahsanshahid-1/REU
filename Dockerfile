# Portable container — runs identically on Render, Railway, Fly.io,
# a university VM, or campus Kubernetes. Node 20 LTS.
FROM node:20-slim
WORKDIR /app

# Install dependencies first (better build caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY . .

# Data (SQLite db + uploaded transcripts) lives on a mounted volume
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Drop root for safety
USER node
CMD ["node", "server.js"]
