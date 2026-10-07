# Ziggy, served forever: `ziggy serve <slug…>` — feed → rendered reels → scheduled posts → reports.
# Keys reach it only as environment variables (POSTPROXY_API_KEY_<SLUG>); the working state
# (~/.ziggy: fonts, renders, posts.jsonl) is the /data volume — mount the host's ~/.ziggy there.
FROM node:20-bookworm-slim

# the shared libraries the HyperFrames renderer's headless Chromium needs
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
      libcairo2 fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# `claude -p` writes the reel summaries (tenant.json → feed.agent); needs ANTHROPIC_API_KEY,
# and a tenant with feed.agent: null never spawns it
RUN npm install --global @anthropic-ai/claude-code && npm cache clean --force

ENV ZIGGY_REPO=/app \
    ZIGGY_HOME=/data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch('http://localhost:'+(process.env.ZIGGY_SERVE_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "skill/index.js"]
# docker run -v $HOME/.ziggy:/data -e POSTPROXY_API_KEY_RAGUSA ziggy serve ragusa alienwatch
